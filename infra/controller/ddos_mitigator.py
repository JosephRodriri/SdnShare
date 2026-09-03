"""
MIT License
Copyright (c) 2024
"""

import json
import logging
import os
import time
from collections import defaultdict, deque
from enum import Enum, auto
from pathlib import Path
from typing import Optional

import yaml
from ryu.base import app_manager
from ryu.controller import ofp_event
from ryu.controller.handler import CONFIG_DISPATCHER, MAIN_DISPATCHER, set_ev_cls
from ryu.lib import hub
from ryu.lib.packet import ethernet, ether_types, ipv4, packet, tcp
from ryu.ofproto import ofproto_v1_3

log = logging.getLogger("ddos_mitigator")
log.setLevel(logging.DEBUG)

# JSON Lines is deliberately used so events can be appended safely while the
# controller runs and later copied into the directory of a specific run.
MITIGATION_EVENTS_FILE = os.environ.get("MITIGATION_EVENTS_FILE", "")


# CONFIGURACIÓN


# ── FlowStats (UDP/ICMP volumétrico) - CAPA 1
DDOS_THRESH_PPS    = int(os.environ.get("DDOS_THRESH_PPS",        1000))
POLL_INTERVAL      = int(os.environ.get("DDOS_INTERVAL",            2))
BLOCK_IDLE_TIMEOUT = int(os.environ.get("DDOS_BLOCK_TIMEOUT",     120))

# ── SYN Flood 
# IMPORTANTE: threshold MÁS ALTO que v7 para no bloquear HTTP floods
# HTTP flood legítimo (ab -c 50) genera ~50 SYN iniciales.
# SYN flood real (hping3 --flood) genera >10.000 SYN/s.
# Un threshold de 100 diferencia claramente ambos escenarios en laboratorio.
SYN_FLOOD_THRESHOLD = int(os.environ.get("SYN_FLOOD_THRESHOLD",  100))
SYN_FLOOD_WINDOW    = float(os.environ.get("SYN_FLOOD_WINDOW",   1.0))
SYN_CLEANUP_TIMEOUT = int(os.environ.get("SYN_CLEANUP_TIMEOUT",   15))

# ── Período de gracia SYN -> HTTP (NUEVO en v8) 
# Cuando SYN rate supera threshold, esperamos SYN_GRACE_MS milisegundos
# antes de decidir si es SYN_FLOOD o HTTP_CANDIDATE.
# Valor: suficiente para que el primer ACK+HTTP llegue desde el cliente.
# En Mininet (latencia virtual baja): 50-100ms es más que suficiente.
SYN_GRACE_MS        = int(os.environ.get("SYN_GRACE_MS",          100))

# ── Ratio SYN/HTTP para clasificación (NUEVO en v8) 
# Si HTTP_count / SYN_count < SYN_HTTP_RATIO_MIN -> SYN_FLOOD (sin HTTP real)
# Si HTTP_count / SYN_count >= SYN_HTTP_RATIO_MIN -> HTTP_CANDIDATE
SYN_HTTP_RATIO_MIN  = float(os.environ.get("SYN_HTTP_RATIO_MIN",  0.2))

# ── HTTP Flood 
HTTP_FLOOD_THRESHOLD = int(os.environ.get("HTTP_FLOOD_THRESHOLD",  10))
HTTP_FLOOD_WINDOW    = float(os.environ.get("HTTP_FLOOD_WINDOW",   1.0))
HTTP_CLEANUP_TIMEOUT = int(os.environ.get("HTTP_CLEANUP_TIMEOUT",  15))
HTTP_PORTS: set = {
    int(p.strip())
    for p in os.environ.get("HTTP_PORTS", "80,443").split(",")
    if p.strip()
}

# ── Port Scan 
PORT_SCAN_THRESHOLD = int(os.environ.get("PORT_SCAN_THRESHOLD",   20))
PORT_SCAN_WINDOW    = int(os.environ.get("PORT_SCAN_WINDOW",        5))
PS_CLEANUP_TIMEOUT  = int(os.environ.get("PS_CLEANUP_TIMEOUT",    15))

# ── Whitelist 
IP_WHITELIST: set = set(os.environ.get("DDOS_IP_WHITELIST", "").split(",")) - {""}

# ── PacketIn monitor 
PACKETIN_WARN_RATE = int(os.environ.get("PACKETIN_WARN_RATE",   1000))

# ── Detección distribuida por víctima 
VICTIM_WINDOW = float(os.environ.get("VICTIM_WINDOW", 1.0))
VICTIM_SYN_THRESHOLD = int(os.environ.get("VICTIM_SYN_THRESHOLD", 300))
VICTIM_HTTP_THRESHOLD = int(os.environ.get("VICTIM_HTTP_THRESHOLD", 50))
VICTIM_UNIQUE_SRC_THRESHOLD = int(os.environ.get("VICTIM_UNIQUE_SRC_THRESHOLD", 3))
VICTIM_MIN_SOURCE_EVENTS = int(os.environ.get("VICTIM_MIN_SOURCE_EVENTS", 5))
VICTIM_ALERT_COOLDOWN = float(os.environ.get("VICTIM_ALERT_COOLDOWN", 2.0))

# ── OpenFlow priorities 
BLOCK_PRIORITY     = 1000
INTERCEPT_PRIORITY = 500
# SYN debe tener prioridad sobre la inspección HTTP: un SYN dirigido a un
# puerto HTTP sigue alimentando el detector de SYN/port scan.
HTTP_INTERCEPT_PRIORITY = INTERCEPT_PRIORITY - 1
POLICY_TABLE       = 0
FORWARD_TABLE      = 1
BLOCK_TABLE        = POLICY_TABLE
INSPECTED_METADATA = 1
INSPECTED_METADATA_MASK = 0xFFFFFFFFFFFFFFFF

# ── max_len por tipo de intercepción 
SYN_MAXLEN  = 128   # Headers L4 completos: ~54 bytes
HTTP_MAXLEN = 512   # Cabeceras HTTP completas para requests normales del lab

# ── HTTP methods 
HTTP_METHODS = (
    b"GET ", b"POST ", b"HEAD ", b"PUT ",
    b"DELETE ", b"PATCH ", b"OPTIONS ", b"CONNECT ", b"TRACE ",
)

# ── Campos L4 en match de FlowStats para excluir del conteo volumétrico 
# Reglas con estos campos representan tráfico TCP/UDP/ICMP y no deben
# contarse como volumen bruto (FlowStats solo detecta UDP/ICMP flood).
_L4_MATCH_FIELDS = frozenset({
    "ip_proto", "tcp_src", "tcp_dst", "udp_src", "udp_dst",
    "icmpv4_type", "icmpv4_code", "tcp_flags",
})



# ESTADO DE CLASIFICACIÓN POR IP


class IpState(Enum):
    """
    Estado de clasificación de una IP en la máquina de estados.

    OBSERVING:      IP recién vista o recién reiniciada. Acumulando evidencia.
    SYN_CANDIDATE:  SYN rate superó threshold. En período de gracia esperando HTTP.
    HTTP_CANDIDATE: SYN + HTTP observados. Evaluando HTTP flood.
    BLOCKED:        IP bloqueada. Regla DROP instalada en los switches.
    """
    OBSERVING      = auto()
    SYN_CANDIDATE  = auto()
    HTTP_CANDIDATE = auto()
    BLOCKED        = auto()


class IpContext:
    """
    Contexto completo de observación para una IP origen.

    Centraliza todo el estado que en v7 estaba disperso en múltiples dicts
    (_syn_ts, _portscan_ports, _portscan_wstart, _http_counter, _http_wstart).

    Ventajas:
      - Un solo pop(ip) limpia todo el estado de esa IP
      - Fácil de inspeccionar para debugging
      - Añadir nuevos estados no requiere añadir nuevos dicts globales
    """

    __slots__ = (
        "state",
        "syn_ts",           # deque de timestamps SYN (sliding window)
        "syn_candidate_ts", # timestamp en que entró a SYN_CANDIDATE
        "http_ts",          # deque de timestamps HTTP (sliding window)
        "portscan_ports",   # set de puertos únicos contactados
        "portscan_dst_ips", # set de IPs destino únicas (detección subnet scan)
        "portscan_wstart",  # inicio de ventana port scan
        "last_seen",        # último timestamp de actividad
    )

    def __init__(self):
        self.state            = IpState.OBSERVING
        self.syn_ts           = deque()
        self.syn_candidate_ts = None   # cuando entró a SYN_CANDIDATE
        self.http_ts          = deque()
        self.portscan_ports   = set()
        self.portscan_dst_ips = set()  # IPs destino únicas para detección subnet scan
        self.portscan_wstart  = None
        self.last_seen        = time.time()

    @property
    def syn_count(self) -> int:
        return len(self.syn_ts)

    @property
    def http_count(self) -> int:
        return len(self.http_ts)

    @property
    def http_syn_ratio(self) -> float:
        """Ratio HTTP/SYN. Si SYN=0 -> 0.0"""
        return self.http_count / self.syn_count if self.syn_count else 0.0

    def slide_syn(self, now: float) -> int:
        """Aplica sliding window SYN, añade now, devuelve count."""
        cutoff = now - SYN_FLOOD_WINDOW
        while self.syn_ts and self.syn_ts[0] < cutoff:
            self.syn_ts.popleft()
        self.syn_ts.append(now)
        self.last_seen = now
        return len(self.syn_ts)

    def slide_http(self, now: float) -> int:
        """Aplica sliding window HTTP, añade now, devuelve count."""
        cutoff = now - HTTP_FLOOD_WINDOW
        while self.http_ts and self.http_ts[0] < cutoff:
            self.http_ts.popleft()
        self.http_ts.append(now)
        self.last_seen = now
        return len(self.http_ts)

    def grace_expired(self, now: float) -> bool:
        """¿Expiró el período de gracia SYN_GRACE_MS?"""
        if self.syn_candidate_ts is None:
            return False
        return (now - self.syn_candidate_ts) * 1000 >= SYN_GRACE_MS

    def __repr__(self):
        return (
            f"IpContext(state={self.state.name}, "
            f"SYN={self.syn_count}, HTTP={self.http_count}, "
            f"ratio={self.http_syn_ratio:.2f}, "
            f"ports={len(self.portscan_ports)}, "
            f"dst_ips={len(self.portscan_dst_ips)})"
        )



# APLICACIÓN PRINCIPAL


class DDoSMitigator(app_manager.RyuApp):
    """
    Módulo de detección y mitigación DDoS v8 para SDN Spine-Leaf.

    Detecta: SYN Flood, UDP/ICMP Flood, Port Scan, HTTP Flood.
    Novedad: máquina de estados con período de gracia para distinguir
    HTTP Flood de SYN Flood real mediante correlación SYN/HTTP.
    """

    OFP_VERSIONS = [ofproto_v1_3.OFP_VERSION]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # ── Switches registrados 
        self._datapaths: dict = {}
        self._leaf_dpids: set = self._load_leaf_dpids()

        # ── Estado de IPs bloqueadas (compatibilidad con _trigger_mitigation) 
        self._blocked: set = set()
        self._blocked_dpids: dict = {}
        self._blocked_until: dict = {}

        # ── NUEVO v8: Contexto por IP (reemplaza múltiples dicts separados) 
        # { src_ip -> IpContext }
        self._ip_ctx: dict = {}

        # ── FlowStats (heredado, sin cambios) 
        self._prev_pkt: dict  = {}
        self._mac_to_ip: dict = {}
        self._victim_syn: dict = defaultdict(deque)
        self._victim_http: dict = defaultdict(deque)
        self._victim_alert_ts: dict = {}

        # ── Estadísticas 
        self._stats: dict = {
            "total_blocked":    0,
            "syn_flood":        0,
            "port_scan":        0,
            "http_flood":       0,
            "volumetric_flood": 0,
            "distributed_syn_flood": 0,
            "distributed_http_flood": 0,
            "packetin_total":   0,
            "packetin_window":  0,
            "packetin_wstart":  time.time(),
        }

        self._poll_thread    = hub.spawn(self._poll_loop)
        self._cleanup_thread = hub.spawn(self._cleanup_loop)
        self._grace_thread   = hub.spawn(self._grace_check_loop)
        self._stats_thread   = hub.spawn(self._stats_loop)

        self._log_startup()

    def _log_startup(self):
        log.info(
            "[DDoS] ---------------------------------------------------\n"
            "[DDoS]  Mitigator v8 (State Machine + SYN/HTTP Correlation)\n"
            "[DDoS] ---------------------------------------------------\n"
            "[DDoS]  FlowStats (UDP/ICMP): thresh=%d pps | poll=%ds\n"
            "[DDoS]  SYN Flood:  thresh=%d SYN/%.1fs | grace=%dms | ratio_min=%.1f\n"
            "[DDoS]  HTTP Flood: thresh=%d req/%.1fs | puertos=%s\n"
            "[DDoS]  Port Scan:  thresh=%d puertos o dst_ips/%ds\n"
            "[DDoS]  Victim agg:  SYN=%d HTTP=%d srcs=%d window=%.1fs\n"
            "[DDoS]  Block timeout: %ds | Whitelist: %s\n"
            "[DDoS]  Intercept switches: %s\n"
            "[DDoS] ---------------------------------------------------",
            DDOS_THRESH_PPS, POLL_INTERVAL,
            SYN_FLOOD_THRESHOLD, SYN_FLOOD_WINDOW, SYN_GRACE_MS, SYN_HTTP_RATIO_MIN,
            HTTP_FLOOD_THRESHOLD, HTTP_FLOOD_WINDOW, sorted(HTTP_PORTS),
            PORT_SCAN_THRESHOLD, PORT_SCAN_WINDOW,
            VICTIM_SYN_THRESHOLD, VICTIM_HTTP_THRESHOLD,
            VICTIM_UNIQUE_SRC_THRESHOLD, VICTIM_WINDOW,
            BLOCK_IDLE_TIMEOUT,
            sorted(IP_WHITELIST) if IP_WHITELIST else "ninguna",
            sorted(self._leaf_dpids) if self._leaf_dpids else "todos (sin config leaf)",
        )

    @staticmethod
    def _load_leaf_dpids() -> set:
        config_file = os.environ.get("NETWORK_CONFIG_FILE", "network_config.yaml")
        try:
            with open(config_file, "r", encoding="utf-8") as fh:
                config = yaml.safe_load(fh) or {}
        except (OSError, yaml.YAMLError) as exc:
            log.warning(
                "[DDoS] No se pudo leer NETWORK_CONFIG_FILE=%s (%s); "
                "instalando intercepción en todos los switches",
                config_file, exc,
            )
            return set()

        leaves = {
            int(sw["id"])
            for sw in config.get("switches", [])
            if str(sw.get("type", "")).lower() == "leaf" and "id" in sw
        }
        if not leaves:
            log.warning(
                "[DDoS] NETWORK_CONFIG_FILE=%s no define leaf switches; "
                "instalando intercepción en todos los switches",
                config_file,
            )
        return leaves

    def _is_leaf_datapath(self, dpid: int) -> bool:
        return not self._leaf_dpids or dpid in self._leaf_dpids

    
    # REGISTRO DE SWITCHES
    

    @set_ev_cls(ofp_event.EventOFPSwitchFeatures, CONFIG_DISPATCHER)
    def _features_handler(self, ev):
        dp = ev.msg.datapath

        self._datapaths[dp.id] = dp
        log.info("[DDoS] Switch dpid=%-5d registrado (total=%d)", dp.id, len(self._datapaths))

        if not self._is_leaf_datapath(dp.id):
            log.info("[DDoS] dpid=%-5d es spine/no-edge; sin traps PacketIn", dp.id)
            return

        hub.spawn(self._install_intercept_rules_after_setup, dp)

    def _install_intercept_rules_after_setup(self, dp):
        hub.sleep(0.2)
        ofproto = dp.ofproto
        parser  = dp.ofproto_parser

        # ── Regla SYN: tcp_flags=(0x002, 0x012) -> SYN=1, ACK=0 
        syn_act  = [parser.OFPActionOutput(ofproto.OFPP_CONTROLLER, SYN_MAXLEN)]
        syn_inst = [
            parser.OFPInstructionActions(ofproto.OFPIT_APPLY_ACTIONS, syn_act),
            parser.OFPInstructionWriteMetadata(INSPECTED_METADATA,
                                               INSPECTED_METADATA_MASK),
            parser.OFPInstructionGotoTable(FORWARD_TABLE),
        ]
        match_syn = parser.OFPMatch(
            eth_type=ether_types.ETH_TYPE_IP,
            ip_proto=6,
            tcp_flags=(0x002, 0x012),   # SYN puro, no SYN-ACK
        )
        dp.send_msg(parser.OFPFlowMod(
            datapath=dp, table_id=BLOCK_TABLE,
            priority=INTERCEPT_PRIORITY, idle_timeout=0, hard_timeout=0,
            match=match_syn, instructions=syn_inst, command=ofproto.OFPFC_ADD,
        ))

        # ── Reglas HTTP: inspeccionar TCP hacia los puertos HTTP.
        # No se depende de PSH: ese flag es una sugerencia del stack TCP y
        # algunos clientes válidos no lo establecen en el segmento con el GET.
        # Request the complete packet because dc_switch uses the PacketIn data
        # to forward the first packet of a previously unknown flow.
        http_act  = [parser.OFPActionOutput(ofproto.OFPP_CONTROLLER,
                                             ofproto.OFPCML_NO_BUFFER)]
        http_inst = [
            parser.OFPInstructionActions(ofproto.OFPIT_APPLY_ACTIONS, http_act),
            parser.OFPInstructionWriteMetadata(INSPECTED_METADATA,
                                               INSPECTED_METADATA_MASK),
            parser.OFPInstructionGotoTable(FORWARD_TABLE),
        ]
        for port in HTTP_PORTS:
            match_http = parser.OFPMatch(
                eth_type=ether_types.ETH_TYPE_IP,
                ip_proto=6,
                tcp_dst=port,
            )
            dp.send_msg(parser.OFPFlowMod(
                datapath=dp, table_id=BLOCK_TABLE,
                priority=HTTP_INTERCEPT_PRIORITY, idle_timeout=0, hard_timeout=0,
                match=match_http, instructions=http_inst, command=ofproto.OFPFC_ADD,
            ))

        log.info(
            "[DDoS] dpid=%-5d -> SYN trap(prio=%d,max=%d) "
            "HTTP TCP×%d(prio=%d,max=full) instaladas",
            dp.id, INTERCEPT_PRIORITY, SYN_MAXLEN,
            len(HTTP_PORTS), HTTP_INTERCEPT_PRIORITY, HTTP_MAXLEN,
        )

    
    # MODULO A: FLOWSTATS — UDP / ICMP FLOOD
    

    def _poll_loop(self):
        hub.sleep(POLL_INTERVAL * 3)
        log.info("[DDoS-A] Polling loop iniciado (intervalo=%ds)", POLL_INTERVAL)
        while True:
            if not self._datapaths:
                log.debug("[DDoS-A] Polling: sin datapaths registrados")
            else:
                for dp in list(self._datapaths.values()):
                    self._request_flow_stats(dp)
                log.debug("[DDoS-A] Polling: stats solicitados a %d switches",
                          len(self._datapaths))
            hub.sleep(POLL_INTERVAL)

    def _request_flow_stats(self, datapath):
        ofproto = datapath.ofproto
        parser  = datapath.ofproto_parser
        datapath.send_msg(parser.OFPFlowStatsRequest(
            datapath=datapath,
            table_id=ofproto.OFPTT_ALL,
            out_port=ofproto.OFPP_ANY,
            out_group=ofproto.OFPG_ANY,
            match=parser.OFPMatch(),
        ))

    @set_ev_cls(ofp_event.EventOFPFlowStatsReply, MAIN_DISPATCHER)
    def _flow_stats_reply_handler(self, ev):
        dpid    = ev.msg.datapath.id
        body    = ev.msg.body
        current = defaultdict(int)
        skipped = 0
        counted = 0
        total_rules = len(body)

        for stat in body:
            if stat.priority in (BLOCK_PRIORITY, INTERCEPT_PRIORITY):
                continue
            eth_src = stat.match.get("eth_src")
            if not eth_src or eth_src in ("ff:ff:ff:ff:ff:ff", "00:00:00:00:00:00"):
                continue
            is_l4 = self._match_has_l4_fields(stat.match)
            if is_l4:
                skipped += 1
                log.debug(
                    "[DDoS-A] dpid=%-5d FILTRADA (L4): prio=%d pkts=%d match=%s",
                    dpid, stat.priority, stat.packet_count, stat.match,
                )
                continue
            counted += 1
            current[eth_src] += stat.packet_count
            ipv4_src = stat.match.get("ipv4_src")
            if ipv4_src and eth_src not in self._mac_to_ip:
                self._mac_to_ip[eth_src] = ipv4_src

        log.debug(
            "[DDoS-A] dpid=%-5d FlowStats: %d reglas total, "
            "%d contadas (L2), %d filtradas (L4/PRI), %d MACs",
            dpid, total_rules, counted, skipped, len(current),
        )

        for eth_src, pkt_total in current.items():
            key  = (dpid, eth_src)
            prev = self._prev_pkt.get(key)
            if prev is None:
                self._prev_pkt[key] = pkt_total
                log.debug(
                    "[DDoS-A] dpid=%-5d eth=%s baseline=%d (primer muestreo)",
                    dpid, eth_src, pkt_total,
                )
                continue
            delta = pkt_total - prev
            if delta < 0:
                self._prev_pkt[key] = pkt_total
                log.debug(
                    "[DDoS-A] dpid=%-5d eth=%s delta=%d (counter reset)",
                    dpid, eth_src, delta,
                )
                continue
            self._prev_pkt[key] = pkt_total
            if delta == 0:
                continue

            pps    = delta / POLL_INTERVAL
            src_ip = self._mac_to_ip.get(eth_src)
            log.info(
                "[DDoS-A] dpid=%-5d eth=%s ip=%s Δ=%d pps=%.0f "
                "threshold=%.0f %s",
                dpid, eth_src, src_ip or "???", delta, pps,
                DDOS_THRESH_PPS,
                "*** BLOQUEAR ***" if pps >= DDOS_THRESH_PPS else "",
            )
            if not src_ip:
                log.warning(
                    "[DDoS-A] dpid=%-5d eth=%s sin mapping IP — "
                    "no se puede bloquear",
                    dpid, eth_src,
                )
                continue
            if src_ip in self._blocked or src_ip in IP_WHITELIST:
                continue

            if pps >= DDOS_THRESH_PPS:
                self._trigger_mitigation(
                    src_ip, "VOLUMETRIC_FLOOD",
                    f"pps={pps:.0f} (UDP/ICMP FlowStats Δ={delta})",
                    dpid,
                )

    
    # MODULO B+C: PACKETIN — MÁQUINA DE ESTADOS - CAPA 2
    

    @set_ev_cls(ofp_event.EventOFPPacketIn, MAIN_DISPATCHER)
    def _packet_in_handler(self, ev):
        """
        Dispatcher de PacketIn con máquina de estados por IP.

        El flujo de decisión es:
          1. Parse rápido del paquete
          2. Aprender MAC->IP
          3. Obtener (o crear) IpContext para src_ip
          4. Actualizar contexto según tipo de paquete (SYN / HTTP)
          5. Evaluar transiciones de estado
        """
        self._update_packetin_stats()

        msg      = ev.msg
        datapath = msg.datapath
        self._datapaths[datapath.id] = datapath

        pkt = packet.Packet(msg.data)
        eth = pkt.get_protocol(ethernet.ethernet)
        if not eth or eth.ethertype == ether_types.ETH_TYPE_LLDP:
            return

        ip_pkt = pkt.get_protocol(ipv4.ipv4)
        if not ip_pkt:
            return

        src_ip = ip_pkt.src
        dst_ip = ip_pkt.dst

        if eth.src not in self._mac_to_ip:
            self._mac_to_ip[eth.src] = src_ip

        if src_ip in self._blocked or src_ip in IP_WHITELIST:
            return

        tcp_pkt = pkt.get_protocol(tcp.tcp)
        if not tcp_pkt:
            return

        flags    = tcp_pkt.bits
        dst_port = tcp_pkt.dst_port
        is_syn   = bool(flags & 0x02) and not bool(flags & 0x10)

        ctx = self._get_or_create_ctx(src_ip)
        now = time.time()

        # ── Paquete SYN -> actualizar sliding window + evaluar 
        if is_syn:
            syn_count = ctx.slide_syn(now)
            self._update_victim_window(
                self._victim_syn, dst_ip, src_ip, now,
                "DISTRIBUTED_SYN_FLOOD", VICTIM_SYN_THRESHOLD, datapath.id,
            )

            # Port Scan: independiente del estado SYN
            self._update_port_scan(ctx, src_ip, dst_ip, dst_port, now, datapath.id)

            log.debug(
                "[DDoS-B] SYN ip=%-15s state=%-15s count=%-4d http=%-3d ratio=%.2f",
                src_ip, ctx.state.name, syn_count, ctx.http_count, ctx.http_syn_ratio,
            )

            self._evaluate_syn(ctx, src_ip, syn_count, now, datapath.id)

        # ── Paquete TCP hacia puerto HTTP -> DPI
        if dst_port in HTTP_PORTS:
            payload = self._extract_tcp_payload(pkt)
            if payload and self._is_http_request(payload):
                http_count = ctx.slide_http(now)
                self._update_victim_window(
                    self._victim_http, dst_ip, src_ip, now,
                    "DISTRIBUTED_HTTP_FLOOD", VICTIM_HTTP_THRESHOLD, datapath.id,
                )

                log.debug(
                    "[DDoS-C] HTTP ip=%-15s state=%-15s http_count=%-4d syn=%-3d ratio=%.2f",
                    src_ip, ctx.state.name, http_count, ctx.syn_count, ctx.http_syn_ratio,
                )

                self._evaluate_http(ctx, src_ip, http_count, dst_port, now, datapath.id)

    
    # Lógica de transición de estados — SYN
    

    def _evaluate_syn(self, ctx: IpContext, src_ip: str, syn_count: int,
                      now: float, dpid: int):
        """
        Evalúa si el SYN rate de esta IP requiere acción.

        OBSERVING -> SYN_CANDIDATE:
          Cuando syn_count supera el threshold, iniciamos el período de gracia.
          NO bloqueamos inmediatamente — esperamos SYN_GRACE_MS milisegundos
          para ver si llegan requests HTTP.

        SYN_CANDIDATE -> BLOCKED(SYN_FLOOD):
          Solo si el período de gracia expiró Y el ratio HTTP/SYN < SYN_HTTP_RATIO_MIN.
          Esto garantiza que hping3 (SYN sin HTTP) se bloquea, pero ab (SYN + HTTP) no.

        SYN_CANDIDATE -> HTTP_CANDIDATE:
          Ocurre cuando llega un request HTTP en _evaluate_http() mientras la IP
          está en SYN_CANDIDATE. La transición la maneja _evaluate_http.
        """
        if ctx.state == IpState.BLOCKED:
            return

        if syn_count < SYN_FLOOD_THRESHOLD:
            return  # Bajo threshold -> sin acción

        # syn_count >= threshold: actuar según estado
        if ctx.state == IpState.OBSERVING:
            # Primera vez que superamos el threshold: iniciar período de gracia
            ctx.state            = IpState.SYN_CANDIDATE
            ctx.syn_candidate_ts = now
            log.info(
                "[DDoS-B] SYN_CANDIDATE ip=%s syn=%d threshold=%d "
                "-> gracia=%dms (esperando HTTP para clasificar)",
                src_ip, syn_count, SYN_FLOOD_THRESHOLD, SYN_GRACE_MS,
            )

        elif ctx.state == IpState.SYN_CANDIDATE:
            # Ya estamos en SYN_CANDIDATE: ¿expiró la gracia?
            if ctx.grace_expired(now):
                # La gracia expiró. Decidir basándose en el ratio HTTP/SYN
                if ctx.http_syn_ratio < SYN_HTTP_RATIO_MIN:
                    # Pocos HTTP relativos a SYN -> SYN flood real
                    log.info(
                        "[DDoS-B] Gracia expirada ip=%s syn=%d http=%d ratio=%.2f < %.2f "
                        "-> SYN_FLOOD",
                        src_ip, syn_count, ctx.http_count,
                        ctx.http_syn_ratio, SYN_HTTP_RATIO_MIN,
                    )
                    self._trigger_mitigation(
                        src_ip, "SYN_FLOOD",
                        f"syn={syn_count} http={ctx.http_count} "
                        f"ratio={ctx.http_syn_ratio:.2f} (sin correlación HTTP)",
                        dpid,
                    )
                else:
                    # Suficientes HTTP relativos a SYN -> es HTTP flood, no SYN flood
                    # _evaluate_http habrá detectado y bloqueado ya; si no, dejar seguir
                    log.debug(
                        "[DDoS-B] Gracia expirada ip=%s ratio=%.2f >= %.2f -> "
                        "esperando confirmación HTTP_FLOOD",
                        src_ip, ctx.http_syn_ratio, SYN_HTTP_RATIO_MIN,
                    )

        elif ctx.state == IpState.HTTP_CANDIDATE:
            # Ya clasificada como HTTP candidate: mantener y esperar confirmación
            pass

    
    # Lógica de transición de estados — HTTP
    

    def _evaluate_http(self, ctx: IpContext, src_ip: str, http_count: int,
                       dst_port: int, now: float, dpid: int):
        """
        Evalúa si el HTTP request rate requiere acción.

        SYN_CANDIDATE -> HTTP_CANDIDATE:
          Si llega un HTTP request mientras la IP está en SYN_CANDIDATE,
          significa que los SYN sí completaron handshake -> es un cliente HTTP.
          Transicionamos a HTTP_CANDIDATE y evaluamos el threshold HTTP.

        HTTP_CANDIDATE -> BLOCKED(HTTP_FLOOD):
          Cuando http_count >= HTTP_FLOOD_THRESHOLD en la ventana.

        OBSERVING -> BLOCKED(HTTP_FLOOD):
          Si HTTP llega sin SYN previo alto (keep-alive: 1 SYN, muchos HTTP).
          Directamente: si http_count >= threshold -> bloquear.
        """
        if ctx.state == IpState.BLOCKED:
            return

        # SYN_CANDIDATE + HTTP -> transicionar a HTTP_CANDIDATE
        if ctx.state == IpState.SYN_CANDIDATE:
            ctx.state = IpState.HTTP_CANDIDATE
            log.info(
                "[DDoS-C] SYN_CANDIDATE -> HTTP_CANDIDATE ip=%s "
                "(HTTP request recibido, ratio=%.2f) -> evaluando HTTP flood",
                src_ip, ctx.http_syn_ratio,
            )

        # En cualquier estado con threshold superado -> HTTP_FLOOD
        if http_count >= HTTP_FLOOD_THRESHOLD:
            self._trigger_mitigation(
                src_ip, "HTTP_FLOOD",
                f"http_req={http_count} en ventana={HTTP_FLOOD_WINDOW}s "
                f"puerto={dst_port} syn_correlacionados={ctx.syn_count}",
                dpid,
            )

    
    # Detección distribuida por víctima
    

    def _update_victim_window(self, store: dict, dst_ip: str, src_ip: str,
                              now: float, attack_type: str, threshold: int,
                              dpid: int):
        if src_ip in IP_WHITELIST or dst_ip in IP_WHITELIST:
            return

        window = store[dst_ip]
        cutoff = now - VICTIM_WINDOW
        while window and window[0][0] < cutoff:
            window.popleft()
        window.append((now, src_ip))

        if len(window) < threshold:
            return

        source_counts = defaultdict(int)
        for _, observed_src in window:
            source_counts[observed_src] += 1

        if len(source_counts) < VICTIM_UNIQUE_SRC_THRESHOLD:
            return

        cooldown_key = (attack_type, dst_ip)
        last_alert = self._victim_alert_ts.get(cooldown_key, 0)
        if (now - last_alert) < VICTIM_ALERT_COOLDOWN:
            return
        self._victim_alert_ts[cooldown_key] = now

        contributors = [
            ip for ip, count in source_counts.items()
            if count >= VICTIM_MIN_SOURCE_EVENTS
            and ip not in self._blocked
            and ip not in IP_WHITELIST
        ]

        log.warning(
            "[DDoS] Ataque distribuido candidato tipo=%s victima=%s total=%d "
            "fuentes=%d contributors=%s",
            attack_type, dst_ip, len(window), len(source_counts), contributors,
        )

        for attacker_ip in contributors:
            self._trigger_mitigation(
                attacker_ip, attack_type,
                f"victima={dst_ip} eventos_victima={len(window)} "
                f"fuentes={len(source_counts)} aporte_src={source_counts[attacker_ip]}",
                dpid,
            )

    
    # Port Scan (independiente de la FSM SYN/HTTP)
    

    def _update_port_scan(self, ctx: IpContext, src_ip: str, dst_ip: str,
                          dst_port: int, now: float, dpid: int):
        """
        Detecta Port Scan / Subnet Scan: dos vectores de detección.

        Vectores de detección (cualquiera activa el bloqueo):
          1. Subnet scan: mismo puerto, muchas IPs destino únicas
             Ej: nmap -sS -p 80 10.1.1.0/24 → 254 dst_ips en 5s
          2. Port scan clásico: mismo host, muchos puertos únicos
             Ej: nmap -sS -p 1-100 10.1.1.4 → 100 puertos en 5s
        """
        if ctx.state == IpState.BLOCKED:
            return

        wstart = ctx.portscan_wstart
        if wstart is None or (now - wstart) > PORT_SCAN_WINDOW:
            if wstart is not None:
                log.debug(
                    "[DDoS-B] PortScan ventana reset ip=%s "
                    "(%d puertos, %d dst_ips en %.1fs)",
                    src_ip, len(ctx.portscan_ports),
                    len(ctx.portscan_dst_ips), now - wstart,
                )
            ctx.portscan_wstart  = now
            ctx.portscan_ports   = set()
            ctx.portscan_dst_ips = set()

        ctx.portscan_ports.add(dst_port)
        ctx.portscan_dst_ips.add(dst_ip)
        port_count   = len(ctx.portscan_ports)
        dst_ip_count = len(ctx.portscan_dst_ips)

        log.debug(
            "[DDoS-B] PortScan ip=%-15s puertos=%-4d dst_ips=%-4d "
            "threshold=%d ventana=%.1fs",
            src_ip, port_count, dst_ip_count,
            PORT_SCAN_THRESHOLD, now - ctx.portscan_wstart,
        )

        # Subnet scan: muchas IPs destino en la misma ventana
        if dst_ip_count >= PORT_SCAN_THRESHOLD:
            self._trigger_mitigation(
                src_ip, "PORT_SCAN",
                f"unique_dst_ips={dst_ip_count} en {PORT_SCAN_WINDOW}s "
                f"(puertos={port_count})",
                dpid,
            )
        # Port scan clásico: muchos puertos en un solo host
        elif port_count >= PORT_SCAN_THRESHOLD:
            self._trigger_mitigation(
                src_ip, "PORT_SCAN",
                f"unique_ports={port_count} en {PORT_SCAN_WINDOW}s "
                f"(dst_ips={dst_ip_count})",
                dpid,
            )

    
    # VERIFICACIÓN PERIÓDICA DEL PERÍODO DE GRACIA
    

    def _grace_check_loop(self):
        """
        Hilo que verifica periódicamente las IPs en estado SYN_CANDIDATE
        para decidir si el período de gracia expiró sin HTTP.

        Esto garantiza que la decisión se toma aunque no lleguen más SYN
        después de iniciar la gracia (ej: hping3 que para de enviar).

        Se ejecuta cada SYN_GRACE_MS * 2 milisegundos.
        """
        check_interval = (SYN_GRACE_MS * 2) / 1000.0
        while True:
            hub.sleep(check_interval)
            self._check_grace_expirations()

    def _check_grace_expirations(self):
        """Evalúa todas las IPs en SYN_CANDIDATE con gracia expirada."""
        now = time.time()
        for src_ip, ctx in list(self._ip_ctx.items()):
            if ctx.state != IpState.SYN_CANDIDATE:
                continue
            if not ctx.grace_expired(now):
                continue

            # Gracia expirada: decidir
            if ctx.http_syn_ratio < SYN_HTTP_RATIO_MIN:
                log.info(
                    "[DDoS] Grace check ip=%s syn=%d http=%d ratio=%.2f -> SYN_FLOOD",
                    src_ip, ctx.syn_count, ctx.http_count, ctx.http_syn_ratio,
                )
                # Buscar cualquier dpid conocido para la llamada
                dpid = next(iter(self._datapaths), 0)
                self._trigger_mitigation(
                    src_ip, "SYN_FLOOD",
                    f"syn={ctx.syn_count} http={ctx.http_count} "
                    f"ratio={ctx.http_syn_ratio:.2f} (gracia expirada, sin HTTP)",
                    dpid,
                )
            else:
                log.debug(
                    "[DDoS] Grace check ip=%s ratio=%.2f -> transición a HTTP_CANDIDATE",
                    src_ip, ctx.http_syn_ratio,
                )
                ctx.state = IpState.HTTP_CANDIDATE

    
    # HELPERS
    

    def _get_or_create_ctx(self, src_ip: str) -> IpContext:
        """Retorna el IpContext existente o crea uno nuevo."""
        if src_ip not in self._ip_ctx:
            self._ip_ctx[src_ip] = IpContext()
        return self._ip_ctx[src_ip]

    @staticmethod
    def _extract_tcp_payload(pkt: packet.Packet) -> Optional[bytes]:
        """
        Extrae payload raw TCP iterando sobre pkt.protocols.
        Más robusto que pkt[-1] cuando el stack está fragmentado.
        """
        for proto in pkt.protocols:
            if isinstance(proto, (bytes, bytearray)):
                data = bytes(proto)
                return data if data else None
        return None

    @staticmethod
    def _is_http_request(payload: bytes) -> bool:
        """
        Valida que el payload sea un request HTTP real.
        Requiere: verbo HTTP conocido + indicador de protocolo (HTTP/ o CRLF).
        """
        if not any(payload.startswith(m) for m in HTTP_METHODS):
            return False
        return b"HTTP/" in payload or b"\r\n" in payload

    @staticmethod
    def _match_has_l4_fields(match) -> bool:
        """
        Detecta si un match de FlowStats contiene campos de capa 4.

        Las reglas L2 de dc_switch (in_port, eth_src, eth_dst) NO contienen
        campos L4 y su packet_count incluye todo el tráfico (TCP, UDP, etc).
        Solo esas reglas deben contribuir al conteo volumétrico.

        Las reglas L4 (con ip_proto, tcp_dst, udp_src, etc) representan
        tráfico filtrado por protocolo y NO deben contarse como volumen.
        """
        match_str = str(match)
        return any(f in match_str for f in _L4_MATCH_FIELDS)

    def _update_packetin_stats(self):
        """Monitor de tasa PacketIn. Alerta si supera PACKETIN_WARN_RATE."""
        now = time.time()
        self._stats["packetin_total"]  += 1
        self._stats["packetin_window"] += 1
        elapsed = now - self._stats["packetin_wstart"]
        if elapsed >= 1.0:
            rate = self._stats["packetin_window"] / elapsed
            if rate >= PACKETIN_WARN_RATE:
                log.warning(
                    "[DDoS] ⚠ PacketIn rate=%.0f/s supera límite=%d — "
                    "riesgo de saturación del controller",
                    rate, PACKETIN_WARN_RATE,
                )
            self._stats["packetin_window"] = 0
            self._stats["packetin_wstart"] = now

    
    # MODULO D: MITIGATION ENGINE
    

    def _trigger_mitigation(self, src_ip: str, attack_type: str,
                             detail: str, src_dpid: int):
        """
        Ejecuta la mitigación: instala DROP en todos los switches.
        Actualiza el IpContext a BLOCKED y limpia sus estructuras de conteo.
        """
        if src_ip in self._blocked:
            return

        if not self._datapaths:
            log.error("[DDoS] Sin datapaths — no se puede bloquear %s", src_ip)
            return

        self._blocked.add(src_ip)
        self._blocked_until[src_ip] = time.time() + BLOCK_IDLE_TIMEOUT
        self._stats["total_blocked"] += 1
        self._stats[attack_type.lower()] = \
            self._stats.get(attack_type.lower(), 0) + 1

        # Actualizar el IpContext a BLOCKED
        ctx = self._ip_ctx.get(src_ip)
        if ctx:
            ctx.state = IpState.BLOCKED

        block_ts   = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        expire_ts  = time.strftime(
            "%Y-%m-%dT%H:%M:%SZ",
            time.gmtime(time.time() + BLOCK_IDLE_TIMEOUT),
        )

        log.warning(
            "[DDoS] ══ ATAQUE DETECTADO ══ ts=%s tipo=%s ip=%s %s dpid=%d",
            block_ts, attack_type, src_ip, detail, src_dpid,
        )

        installed_on = []
        for dpid, datapath in self._datapaths.items():
            self._install_block_rule(datapath, src_ip)
            installed_on.append(dpid)
        self._blocked_dpids[src_ip] = set(installed_on)

        log.warning(
            "[DDoS] ══ BLOQUEADO ══ ip=%s switches=%s expira=%s (idle=%ds)",
            src_ip, installed_on, expire_ts, BLOCK_IDLE_TIMEOUT,
        )

        print(
            f"DDOS_EVENT"
            f" timestamp={block_ts}"
            f" src_ip={src_ip}"
            f" attack_type={attack_type}"
            f" detail=\"{detail}\""
            f" dpid_origen={src_dpid}"
            f" dpids_bloqueados={installed_on}"
            f" block_timeout={BLOCK_IDLE_TIMEOUT}",
            flush=True,
        )
        self._write_mitigation_event({
            "event_type": "mitigation_applied",
            "timestamp": block_ts,
            "src_ip": src_ip,
            "attack_type": attack_type,
            "detail": detail,
            "dpid_origen": src_dpid,
            "dpids_bloqueados": installed_on,
            "block_timeout": BLOCK_IDLE_TIMEOUT,
            "expires_at": expire_ts,
        })

    def _write_mitigation_event(self, event: dict) -> None:
        """Append one durable mitigation event when persistence is enabled."""
        if not MITIGATION_EVENTS_FILE:
            return
        try:
            event_file = Path(MITIGATION_EVENTS_FILE)
            event_file.parent.mkdir(parents=True, exist_ok=True)
            with event_file.open("a", encoding="utf-8") as output:
                json.dump(event, output, sort_keys=True)
                output.write("\n")
        except OSError:
            log.exception("No se pudo persistir el evento de mitigación")

    def _install_block_rule(self, datapath, src_ip: str):
        """Instala regla DROP priority=1000 para la IP atacante."""
        ofproto = datapath.ofproto
        parser  = datapath.ofproto_parser
        match = parser.OFPMatch(
            eth_type=ether_types.ETH_TYPE_IP,
            ipv4_src=src_ip,
        )
        datapath.send_msg(parser.OFPFlowMod(
            datapath=datapath,
            table_id=BLOCK_TABLE,
            priority=BLOCK_PRIORITY,
            idle_timeout=BLOCK_IDLE_TIMEOUT,
            # A hard timeout prevents stale controller state when a switch
            # reconnects or an attacker keeps matching the DROP rule forever.
            hard_timeout=BLOCK_IDLE_TIMEOUT,
            match=match,
            instructions=[],
            command=ofproto.OFPFC_ADD,
            flags=ofproto.OFPFF_SEND_FLOW_REM,
        ))

    
    # EXPIRACIÓN DE BLOQUEOS
    

    @set_ev_cls(ofp_event.EventOFPFlowRemoved, MAIN_DISPATCHER)
    def _flow_removed_handler(self, ev):
        """Procesa expiración de regla DROP y limpia el estado de la IP."""
        msg   = ev.msg
        match = msg.match

        if msg.priority != BLOCK_PRIORITY:
            return

        src_ip = match.get("ipv4_src")
        if not src_ip or src_ip not in self._blocked:
            return

        remaining = self._blocked_dpids.get(src_ip)
        if remaining is not None:
            remaining.discard(msg.datapath.id)
            if remaining:
                log.debug(
                    "[DDoS] Bloqueo expirado parcialmente: ip=%s dpid=%d "
                    "restantes=%s",
                    src_ip, msg.datapath.id, sorted(remaining),
                )
                return
            self._blocked_dpids.pop(src_ip, None)

        self._blocked.discard(src_ip)
        self._ip_ctx.pop(src_ip, None)   # limpiar todo el contexto
        self._blocked_until.pop(src_ip, None)

        log.info(
            "[DDoS] Bloqueo expirado: ip=%s pkts=%d bytes=%d -> monitoreo reiniciado",
            src_ip, msg.packet_count, msg.byte_count,
        )
        self._write_mitigation_event({
            "event_type": "mitigation_expired",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "src_ip": src_ip,
            "dpid": msg.datapath.id,
            "packets_dropped": msg.packet_count,
            "bytes_dropped": msg.byte_count,
        })

    
    # LIMPIEZA PERIÓDICA
    

    def _cleanup_loop(self):
        while True:
            hub.sleep(PORT_SCAN_WINDOW)
            self._cleanup_stale_contexts()

    def _cleanup_stale_contexts(self):
        """Elimina IpContext de IPs inactivas (no bloqueadas)."""
        now     = time.time()
        expired_blocks = [
            ip for ip, deadline in self._blocked_until.items()
            if now >= deadline
        ]
        for ip in expired_blocks:
            # Fallback for switches that disconnected before sending
            # OFPFlowRemoved.  The hard timeout above guarantees that the
            # dataplane rule has the same maximum lifetime.
            self._blocked.discard(ip)
            self._blocked_dpids.pop(ip, None)
            self._blocked_until.pop(ip, None)
            self._ip_ctx.pop(ip, None)
            log.info("[DDoS] Bloqueo expirado por limpieza: ip=%s", ip)

        stale   = [
            ip for ip, ctx in self._ip_ctx.items()
            if ctx.state != IpState.BLOCKED
            and (now - ctx.last_seen) > max(SYN_CLEANUP_TIMEOUT,
                                             HTTP_CLEANUP_TIMEOUT,
                                             PS_CLEANUP_TIMEOUT)
        ]
        for ip in stale:
            self._ip_ctx.pop(ip, None)

        if stale:
            log.debug("[DDoS] Limpieza: %d IpContext eliminados", len(stale))

    
    # ESTADÍSTICAS
    

    def _stats_loop(self):
        while True:
            hub.sleep(60)
            self._log_stats()

    def _log_stats(self):
        s    = self._stats
        # Contar IPs por estado
        state_counts = defaultdict(int)
        for ctx in self._ip_ctx.values():
            state_counts[ctx.state.name] += 1

        log.info(
            "[DDoS] ── Estadísticas -----------------------------\n"
            "[DDoS]  IPs bloqueadas ahora:   %d\n"
            "[DDoS]  Bloqueos totales:       %d\n"
            "[DDoS]    SYN Flood:            %d\n"
            "[DDoS]    Port Scan:            %d\n"
            "[DDoS]    HTTP Flood:           %d\n"
            "[DDoS]    Volumetric:           %d\n"
            "[DDoS]    Dist SYN Flood:       %d\n"
            "[DDoS]    Dist HTTP Flood:      %d\n"
            "[DDoS]  Estados activos:        %s\n"
            "[DDoS]  FlowStats tracking:     %d MACs\n"
            "[DDoS]  MAC->IP cache:          %d entradas\n"
            "[DDoS]  PacketIn totales:       %d\n"
            "[DDoS]  Switches:               %d -> %s\n"
            "[DDoS] ------------------------------------------------",
            len(self._blocked),
            s["total_blocked"],
            s.get("syn_flood", 0),
            s.get("port_scan", 0),
            s.get("http_flood", 0),
            s.get("volumetric_flood", 0),
            s.get("distributed_syn_flood", 0),
            s.get("distributed_http_flood", 0),
            dict(state_counts),
            len(self._prev_pkt),
            len(self._mac_to_ip),
            s["packetin_total"],
            len(self._datapaths), sorted(self._datapaths.keys()),
        )
