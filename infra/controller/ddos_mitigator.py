"""
MIT License
Copyright (c) 2024

ddos_mitigator.py  —  v4  (FlowStats polling)
══════════════════════════════════════════════

POR QUÉ FALLARON LAS VERSIONES ANTERIORES
──────────────────────────────────────────
v1/v2  El controller solo recibe el primer PacketIn por flujo.
       dc_switch instala reglas exactas (eth_src+eth_dst) que absorben
       todo el tráfico siguiente. Resultado: SYN/UDP siempre = 0 pps.

v3     Las mirror rules con OFPP_NORMAL rompen el forwarding en OVS/Mininet.
       OFPP_NORMAL no "continúa el pipeline" en OVS — envía al bridge Linux,
       saltea las reglas de dc_switch. Resultado: forwarding roto, todos los
       hosts generan ICMP masivo → falsos positivos en cascada.

ARQUITECTURA v4: FLOWSTATS + APRENDIZAJE PASIVO
─────────────────────────────────────────────────
  1. APRENDIZAJE PASIVO (PacketIn existentes)
     Los PacketIn que ya genera dc_switch (table-miss del primer paquete
     de cada flujo) se usan solo para aprender la tabla MAC→IP.
     El mitigador NO forwardea nada, NO instala reglas adicionales.

  2. FLOWSTATS POLLING
     Cada POLL_INTERVAL segundos pedimos a cada switch sus contadores
     de flujo (OFPFlowStatsRequest). dc_switch instala reglas con
     match(in_port, eth_src, eth_dst) — el campo eth_src está en el match.
     Sumamos packet_count de todas las reglas con el mismo eth_src.
     Calculamos delta respecto al ciclo anterior → pps.

  3. DETECCIÓN
     Si pps > THRESHOLD_PPS para una IP → ATAQUE. Instalamos DROP.

  4. BLOQUEO
     Regla DROP prioridad 1000, match(ipv4_src=IP_atacante), idle_timeout.
     Prioridad 1000 > forwarding (100) → gana siempre.

VENTAJAS SOBRE VERSIONES ANTERIORES:
  ✓ Cero reglas mirror adicionales
  ✓ Cero OFPP_NORMAL → forwarding de dc_switch intacto
  ✓ Cero saturación de PacketIn
  ✓ Vemos el tráfico REAL del dataplane (no filtrado por controller)
  ✓ Compatible con SpineLeaf1, SpineLeaf2, SpineLeaf3

THRESHOLD:
  FlowStats cuenta paquetes reales en el dataplane.
  hping3 --flood genera ~10.000-100.000 pps en Mininet.
  Tráfico legítimo (ping, iperf): < 500 pps.
  Default: 1000 pps. Ajusta con DDOS_THRESH_PPS en docker-compose.yaml.
"""

import logging
import os
import time
from collections import defaultdict

from ryu.base import app_manager
from ryu.controller import ofp_event
from ryu.controller.handler import CONFIG_DISPATCHER, MAIN_DISPATCHER, set_ev_cls
from ryu.lib import hub
from ryu.lib.packet import ethernet, ether_types, ipv4, packet
from ryu.ofproto import ofproto_v1_3

log = logging.getLogger("ddos_mitigator")
log.setLevel(logging.DEBUG)

# ── Configuración via variables de entorno ────────────────────────────────────

# Paquetes/segundo por IP origen para disparar bloqueo.
# FlowStats ve el tráfico real del dataplane.
# hping3 --flood: ~10k-100k pps. Tráfico legítimo: <500 pps.
THRESHOLD_PPS      = int(os.environ.get("DDOS_THRESH_PPS",     50))
POLL_INTERVAL      = int(os.environ.get("DDOS_INTERVAL",          2))
BLOCK_IDLE_TIMEOUT = int(os.environ.get("DDOS_BLOCK_TIMEOUT",    120))

BLOCK_PRIORITY = 1000
BLOCK_TABLE    = 0

# IPs que nunca bloquear (separadas por coma en la variable de entorno)
# Ejemplo: DDOS_IP_WHITELIST=10.1.1.100,10.1.1.101
IP_WHITELIST: set = set(
    os.environ.get("DDOS_IP_WHITELIST", "").split(",")
) - {""}


class DDoSMitigator(app_manager.RyuApp):
    """
    Detección DDoS por polling de FlowStats.

    NO instala reglas mirror. NO usa OFPP_NORMAL.
    NO interfiere con dc_switch. NO genera PacketIn adicionales.
    """

    OFP_VERSIONS = [ofproto_v1_3.OFP_VERSION]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # dpid → datapath
        self._datapaths: dict = {}

        # IPs actualmente bloqueadas
        self._blocked: set = set()

        # Contadores de paquetes previos por (dpid, eth_src)
        self._prev_pkt: dict = {}

        # Tabla MAC→IP aprendida pasivamente de PacketIn
        self._mac_to_ip: dict = {}

        # Estadísticas de diagnóstico
        self._cycles: int = 0

        self._poll_thread = hub.spawn(self._poll_loop)

        log.info(
            "[DDoS] ══ Mitigator v4 (flowstats) iniciado ══ "
            "threshold=%d pps | poll=%ds | block_timeout=%ds | ip_whitelist=%s",
            THRESHOLD_PPS, POLL_INTERVAL, BLOCK_IDLE_TIMEOUT,
            IP_WHITELIST or "ninguna",
        )

    # ── Registro de datapaths 
    @set_ev_cls(ofp_event.EventOFPSwitchFeatures, CONFIG_DISPATCHER)
    def _features_handler(self, ev):
        dp = ev.msg.datapath
        self._datapaths[dp.id] = dp
        log.info("[DDoS] Switch registrado dpid=%d (total=%d)",
                 dp.id, len(self._datapaths))

    # ── Aprendizaje pasivo MAC -> IP 

    @set_ev_cls(ofp_event.EventOFPPacketIn, MAIN_DISPATCHER)
    def _packet_in_handler(self, ev):
        """
        Solo aprende MAC→IP de los PacketIn que ya genera dc_switch.
        No forwardea, no instala reglas, no interfiere.
        """
        pkt = packet.Packet(ev.msg.data)
        eth = pkt.get_protocol(ethernet.ethernet)

        if not eth or eth.ethertype == ether_types.ETH_TYPE_LLDP:
            return

        ip_pkt = pkt.get_protocol(ipv4.ipv4)
        if not ip_pkt:
            return

        src_mac = eth.src
        src_ip  = ip_pkt.src

        if src_mac not in self._mac_to_ip:
            self._mac_to_ip[src_mac] = src_ip
            log.debug("[DDoS] Aprendido MAC=%s → IP=%s", src_mac, src_ip)

    # ── FlowStats polling 

    def _poll_loop(self):
        """Solicita FlowStats a todos los switches cada POLL_INTERVAL segundos."""
        # Esperar ciclos iniciales para que dc_switch instale sus reglas
        hub.sleep(POLL_INTERVAL * 3)
        while True:
            self._cycles += 1
            for dp in list(self._datapaths.values()):
                self._request_flow_stats(dp)
            hub.sleep(POLL_INTERVAL)

    def _request_flow_stats(self, datapath):
        ofproto = datapath.ofproto
        parser  = datapath.ofproto_parser
        req = parser.OFPFlowStatsRequest(
            datapath=datapath,
            table_id=ofproto.OFPTT_ALL,
            out_port=ofproto.OFPP_ANY,
            out_group=ofproto.OFPG_ANY,
            match=parser.OFPMatch(),
        )
        datapath.send_msg(req)

    @set_ev_cls(ofp_event.EventOFPFlowStatsReply, MAIN_DISPATCHER)
    def _flow_stats_reply_handler(self, ev):
        """
        Procesa FlowStats de un switch.

        dc_switch instala reglas con match(in_port, eth_src, eth_dst).
        Suma packet_count por eth_src → calcula pps → detecta ataques.
        """
        dpid = ev.msg.datapath.id
        body = ev.msg.body

        # Acumular packet_count por eth_src
        current: dict = defaultdict(int)

        for stat in body:
            # Ignorar reglas de bloqueo propias
            if stat.priority == BLOCK_PRIORITY:
                continue

            eth_src = stat.match.get("eth_src")
            if not eth_src:
                continue

            if eth_src in ("ff:ff:ff:ff:ff:ff", "00:00:00:00:00:00"):
                continue

            current[eth_src] += stat.packet_count

            # Aprender IP desde el match si está disponible
            ipv4_src = stat.match.get("ipv4_src")
            if ipv4_src and eth_src not in self._mac_to_ip:
                self._mac_to_ip[eth_src] = ipv4_src
                log.debug("[DDoS] IP desde FlowStats: %s → %s", eth_src, ipv4_src)

        # Calcular tasa y detectar ataques
        for eth_src, pkt_total in current.items():
            key  = (dpid, eth_src)
            prev = self._prev_pkt.get(key)

            if prev is None:
                # Primer ciclo: solo guardar baseline
                self._prev_pkt[key] = pkt_total
                continue

            delta = pkt_total - prev

            # Contador reseteado (regla reinstalada por dc_switch)
            if delta < 0:
                self._prev_pkt[key] = pkt_total
                continue

            self._prev_pkt[key] = pkt_total

            if delta == 0:
                continue

            pps    = delta / POLL_INTERVAL
            src_ip = self._mac_to_ip.get(eth_src)

            if src_ip:
                log.debug(
                    "[DDoS] dpid=%d ip=%-12s mac=%s Δ=%6d pps=%7.0f",
                    dpid, src_ip, eth_src, delta, pps,
                )
            else:
                log.debug(
                    "[DDoS] dpid=%d mac=%s ip=? Δ=%d pps=%.0f (IP aún no aprendida)",
                    dpid, eth_src, delta, pps,
                )

            if not src_ip:
                continue
            if src_ip in self._blocked:
                continue
            if src_ip in IP_WHITELIST:
                continue

            if pps >= THRESHOLD_PPS:
                self._trigger_mitigation(src_ip, eth_src, pps, dpid)

    # ── Mitigación ────────────────────────────────────────────────────────────

    def _trigger_mitigation(self, src_ip: str, eth_src: str, pps: float, dpid: int):
        self._blocked.add(src_ip)

        log.warning(
            "[DDoS] *** ATAQUE DETECTADO *** src_ip=%s mac=%s pps=%.0f (dpid=%d)",
            src_ip, eth_src, pps, dpid,
        )

        installed_on = []
        for d_id, datapath in self._datapaths.items():
            self._install_block_rule(datapath, src_ip)
            installed_on.append(d_id)

        log.warning(
            "[DDoS] *** BLOQUEADO *** src_ip=%s | DROP en dpids=%s",
            src_ip, installed_on,
        )

        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        print(
            f"DDOS_EVENT timestamp={ts} src_ip={src_ip} mac={eth_src} "
            f"pps={pps:.0f} action=BLOCKED dpids={installed_on}",
            flush=True,
        )

    def _install_block_rule(self, datapath, src_ip: str):
        """Instala regla DROP prioridad 1000 para la IP atacante."""
        ofproto = datapath.ofproto
        parser  = datapath.ofproto_parser

        match = parser.OFPMatch(
            eth_type=ether_types.ETH_TYPE_IP,
            ipv4_src=src_ip,
        )
        msg = parser.OFPFlowMod(
            datapath=datapath,
            table_id=BLOCK_TABLE,
            priority=BLOCK_PRIORITY,
            idle_timeout=BLOCK_IDLE_TIMEOUT,
            hard_timeout=0,
            match=match,
            instructions=[],   # DROP
            command=ofproto.OFPFC_ADD,
            flags=ofproto.OFPFF_SEND_FLOW_REM,
        )
        datapath.send_msg(msg)

    # ── Expiración del bloqueo ────────────────────────────────────────────────


    @set_ev_cls(ofp_event.EventOFPFlowRemoved, MAIN_DISPATCHER)
    def _flow_removed_handler(self, ev):
        msg   = ev.msg
        match = msg.match

        if msg.priority != BLOCK_PRIORITY:
            return

        src_ip = match.get("ipv4_src")
        if src_ip and src_ip in self._blocked:
            self._blocked.discard(src_ip)
            log.info("[DDoS] Bloqueo expirado para %s", src_ip)