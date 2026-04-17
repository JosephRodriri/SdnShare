"""
MIT License
Copyright (c) 2024

ddos_mitigator.py  —  v3  (mirror-based detection)
════════════════════════════════════════════════════
PROBLEMA RAÍZ (v1/v2):
  dc_switch.py instala reglas match(eth_src, eth_dst) → forward.
  Esas reglas capturan TODO el flood subsiguiente en el switch.
  El controller recibe 1 PacketIn por flujo, no los miles de paquetes del flood.
  Resultado: SYN/UDP siempre = 0.0 pps.

SOLUCIÓN (v3):
  Al conectarse cada switch, instalamos reglas de "mirror" de prioridad
  media (50) que:
    • Hacen CONTINUE al pipeline normal (GotoTable / forwarding no se rompe)
    • Además envían una COPIA al controller via OFPP_CONTROLLER

  Esto garantiza que el mitigador reciba una muestra de TODOS los paquetes
  TCP SYN, UDP e ICMP, aunque dc_switch ya tenga reglas de forwarding.

  Las reglas de bloqueo tienen prioridad 1000 (mayor que forwarding ~100)
  por lo que el DROP sigue funcionando correctamente.

COMPATIBILIDAD:
  Funciona con SpineLeaf1, SpineLeaf2 y SpineLeaf3 sin modificarlos.
  Solo requiere cargarse junto a dc_switch.py:

    command: >
      infra/controller/dc_switch.py
      infra/controller/ddos_mitigator.py
      --observe-links
"""

import logging
import os
import time
from collections import defaultdict

from ryu.base import app_manager
from ryu.controller import ofp_event
from ryu.controller.handler import CONFIG_DISPATCHER, MAIN_DISPATCHER, set_ev_cls
from ryu.lib import hub
from ryu.lib.packet import ethernet, ether_types, icmp, ipv4, packet, tcp, udp
from ryu.ofproto import ofproto_v1_3

# ── Thresholds (paquetes/segundo por IP origen) ───────────────────────────────
THRESHOLD_SYN_PPS  = int(os.environ.get("DDOS_THRESH_SYN",  50))
THRESHOLD_UDP_PPS  = int(os.environ.get("DDOS_THRESH_UDP",  100))
THRESHOLD_ICMP_PPS = int(os.environ.get("DDOS_THRESH_ICMP", 30))

DETECTION_INTERVAL = int(os.environ.get("DDOS_INTERVAL",       2))
BLOCK_IDLE_TIMEOUT = int(os.environ.get("DDOS_BLOCK_TIMEOUT", 120))

# ── Prioridades OpenFlow ──────────────────────────────────────────────────────
#
#  1000  →  DROP (bloqueo de atacante)       ← más alta, gana siempre
#   100  →  forwarding normal (dc_switch)
#    50  →  MIRROR al controller (este módulo) ← debajo del forwarding
#     0  →  table-miss
#
# Las reglas mirror tienen prioridad 50: DEBAJO del forwarding (100).
# Esto significa que cuando dc_switch ya instaló una regla de forwarding
# para un flujo específico (match exacto eth_src+eth_dst), esa regla
# tiene prioridad 100 y el paquete se forwardea normalmente.
#
# PERO las reglas mirror usan match más GENÉRICO (solo ip_proto),
# por lo que tienen prioridad diferente y NO compiten con las de forwarding.
# En OpenFlow 1.3 con múltiples tablas, usamos la tabla 0 con match genérico.
#
# ESTRATEGIA CORRECTA:
# Instalamos en tabla 0, prioridad 50, match=(eth_type=IP, ip_proto=TCP/UDP/ICMP).
# Acción: enviar copia al controller (OFPP_CONTROLLER).
# Esta entrada NO tiene GotoTable — solo envía al controller.
# Las reglas de forwarding exactas (prioridad 100) también aplican y forwardean.
# En OpenFlow, múltiples entradas pueden aplicarse si están en tablas distintas,
# pero en la misma tabla gana la de mayor prioridad.
#
# POR LO TANTO: usamos un enfoque diferente.
# Instalamos las reglas mirror en una tabla separada (tabla 2) si el switch
# la soporta, o bien usamos el mecanismo de PACKET_IN via estadísticas de flujo.
#
# ENFOQUE FINAL SIMPLIFICADO:
# Usamos Flow Stats (poll) en lugar de PacketIn para contar tráfico.
# Instalamos reglas de contador (match TCP SYN, UDP, ICMP) con prioridad 200
# (entre forwarding=100 y block=1000). OpenFlow ejecuta la primera regla
# que hace match — si es la de contador, aplica la acción (NORMAL/forward)
# Y envía copia al controller.
# Con OVS podemos usar la acción OUTPUT:CONTROLLER con max_len=0 para
# enviar solo el header sin el payload (eficiente).

MIRROR_PRIORITY = 200   # Entre forwarding (100) y bloqueo (1000)
BLOCK_PRIORITY  = 1000
BLOCK_TABLE     = 0
MIRROR_TABLE    = 0

# Rate limiting de PacketIn mirror: solo enviar 1 de cada N paquetes al controller
# para no saturar el canal controller-switch con el flood.
# OVS soporta esto con max_len en OFPP_CONTROLLER.
# 0 = sin datos del paquete (solo notificación), suficiente para contar.
MIRROR_MAX_LEN = 0   # bytes del paquete a enviar al controller (0 = solo header)

# ── Logger ────────────────────────────────────────────────────────────────────
log = logging.getLogger("ddos_mitigator")
log.setLevel(logging.DEBUG)


class DDoSMitigator(app_manager.RyuApp):
    """
    Detección por threshold con mirror de tráfico + mitigación OpenFlow.

    Al arrancar cada switch, instala reglas de mirror de prioridad 200 que
    envían una copia de cada paquete TCP-SYN, UDP e ICMP al controller,
    independientemente de las reglas de forwarding de dc_switch.py.

    El bloqueo se hace con reglas DROP de prioridad 1000.
    """

    OFP_VERSIONS = [ofproto_v1_3.OFP_VERSION]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # Contadores { ip: {syn, udp, icmp} }
        self._counters: dict = defaultdict(lambda: {"syn": 0, "udp": 0, "icmp": 0})

        # IPs bloqueadas actualmente
        self._blocked: set = set()

        # dpid → datapath
        self._datapaths: dict = {}

        # Total PacketIn recibidos
        self._pkt_in_total: int = 0

        self._detect_thread = hub.spawn(self._detection_loop)

        log.info(
            "[DDoS] ══ Mitigator v3 (mirror) iniciado ══ "
            "thresholds SYN=%d UDP=%d ICMP=%d pps | ventana=%ds | block_timeout=%ds",
            THRESHOLD_SYN_PPS, THRESHOLD_UDP_PPS, THRESHOLD_ICMP_PPS,
            DETECTION_INTERVAL, BLOCK_IDLE_TIMEOUT,
        )

    # ── Registro de switches e instalación de mirror rules ───────────────────

    @set_ev_cls(ofp_event.EventOFPSwitchFeatures, CONFIG_DISPATCHER)
    def _features_handler(self, ev):
        """
        Cuando un switch se conecta, instala reglas mirror para TCP/UDP/ICMP.
        Estas reglas tienen prioridad 200, entre las de forwarding (100) y
        las de bloqueo (1000).

        La acción es: OUTPUT → CONTROLLER (con max_len=0, solo header) Y
        luego continuar el pipeline normal via GotoTable o acción OUTPUT normal.

        IMPORTANTE: En OpenFlow con una sola tabla (SpineLeaf1/dc_switch.py),
        la acción debe ser APPLY_ACTIONS con OUTPUT:CONTROLLER, lo que hace
        que el paquete también siga siendo procesado por reglas de menor
        prioridad. En OVS, una regla con OUTPUT:CONTROLLER también hace
        OUTPUT:NORMAL si no hay acción de drop explícita.

        SOLUCIÓN ROBUSTA: usamos dos acciones en la misma instrucción:
          1. OUTPUT → CONTROLLER (copia al mitigador)
          2. OUTPUT → NORMAL     (forwarding normal del switch)
        Esto garantiza que el paquete siempre llega a destino Y el controller
        lo ve para contar.
        """
        dp      = ev.msg.datapath
        ofproto = dp.ofproto
        parser  = dp.ofproto_parser

        self._datapaths[dp.id] = dp
        log.info("[DDoS] Switch conectado dpid=%d — instalando mirror rules", dp.id)

        # Instalar regla mirror para TCP SYN
        self._install_mirror_rule(dp, ip_proto=6,   label="TCP-SYN", syn_only=True)
        # Instalar regla mirror para UDP
        self._install_mirror_rule(dp, ip_proto=17,  label="UDP",     syn_only=False)
        # Instalar regla mirror para ICMP
        self._install_mirror_rule(dp, ip_proto=1,   label="ICMP",    syn_only=False)

        log.info("[DDoS] Mirror rules instaladas en dpid=%d (prioridad=%d)", dp.id, MIRROR_PRIORITY)

    def _install_mirror_rule(self, datapath, ip_proto: int, label: str, syn_only: bool):
        """
        Instala una regla que hace mirror de paquetes al controller
        mientras sigue forwardeando normalmente.

        Acciones:
          - OUTPUT(CONTROLLER, max_len=0) : envía copia al controller
          - OUTPUT(NORMAL)                : forwarding normal del switch
        """
        ofproto = datapath.ofproto
        parser  = datapath.ofproto_parser

        if ip_proto == 6:  # TCP
            match = parser.OFPMatch(
                eth_type=ether_types.ETH_TYPE_IP,
                ip_proto=6,
                # tcp_flags=0x002 filtraría solo SYN, pero OVS lo soporta
                # solo en versiones recientes. Usamos match TCP genérico
                # y filtramos el flag SYN en el handler Python.
            )
        elif ip_proto == 17:  # UDP
            match = parser.OFPMatch(
                eth_type=ether_types.ETH_TYPE_IP,
                ip_proto=17,
            )
        else:  # ICMP (ip_proto=1)
            match = parser.OFPMatch(
                eth_type=ether_types.ETH_TYPE_IP,
                ip_proto=1,
            )

        actions = [
            # Copia al controller (solo los primeros MIRROR_MAX_LEN bytes)
            parser.OFPActionOutput(ofproto.OFPP_CONTROLLER, MIRROR_MAX_LEN),
            # Forwarding normal — respeta las reglas de dc_switch
            parser.OFPActionOutput(ofproto.OFPP_NORMAL),
        ]
        inst = [parser.OFPInstructionActions(ofproto.OFPIT_APPLY_ACTIONS, actions)]

        msg = parser.OFPFlowMod(
            datapath=datapath,
            table_id=MIRROR_TABLE,
            priority=MIRROR_PRIORITY,
            idle_timeout=0,   # permanente
            hard_timeout=0,
            match=match,
            instructions=inst,
            command=ofproto.OFPFC_ADD,
            flags=0,
        )
        datapath.send_msg(msg)
        log.debug("[DDoS] Mirror rule instalada: dpid=%d proto=%s prio=%d",
                  datapath.id, label, MIRROR_PRIORITY)

    # ── Inspección de PacketIn ────────────────────────────────────────────────

    @set_ev_cls(ofp_event.EventOFPPacketIn, MAIN_DISPATCHER)
    def _packet_in_handler(self, ev):
        """
        Recibe los PacketIn generados por las mirror rules y los de dc_switch.
        Solo cuenta — no forwardea nada.
        """
        self._pkt_in_total += 1

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
        if src_ip in self._blocked:
            return

        tcp_pkt  = pkt.get_protocol(tcp.tcp)
        udp_pkt  = pkt.get_protocol(udp.udp)
        icmp_pkt = pkt.get_protocol(icmp.icmp)

        if tcp_pkt:
            if tcp_pkt.bits & 0x02:  # SYN flag
                self._counters[src_ip]["syn"] += 1
        elif udp_pkt:
            self._counters[src_ip]["udp"] += 1
        elif icmp_pkt:
            self._counters[src_ip]["icmp"] += 1

    # ── Loop de detección ─────────────────────────────────────────────────────

    def _detection_loop(self):
        while True:
            hub.sleep(DETECTION_INTERVAL)
            self._analyze()

    def _analyze(self):
        snapshot = dict(self._counters)
        self._counters.clear()

        if snapshot:
            log.debug(
                "[DDoS] Ciclo: %d IPs | %d PacketIn totales | switches=%s",
                len(snapshot), self._pkt_in_total, list(self._datapaths.keys()),
            )

        for src_ip, counts in snapshot.items():
            if src_ip in self._blocked:
                continue

            syn_pps  = counts["syn"]  / DETECTION_INTERVAL
            udp_pps  = counts["udp"]  / DETECTION_INTERVAL
            icmp_pps = counts["icmp"] / DETECTION_INTERVAL

            if any(v > 0 for v in [syn_pps, udp_pps, icmp_pps]):
                log.debug(
                    "[DDoS] %s → SYN=%.1f UDP=%.1f ICMP=%.1f pps",
                    src_ip, syn_pps, udp_pps, icmp_pps,
                )

            attack_type = pps_value = None

            if syn_pps >= THRESHOLD_SYN_PPS:
                attack_type, pps_value = "SYN_FLOOD", syn_pps
            elif udp_pps >= THRESHOLD_UDP_PPS:
                attack_type, pps_value = "UDP_FLOOD", udp_pps
            elif icmp_pps >= THRESHOLD_ICMP_PPS:
                attack_type, pps_value = "ICMP_FLOOD", icmp_pps

            if attack_type:
                self._trigger_mitigation(src_ip, attack_type, pps_value)

    # ── Mitigación ────────────────────────────────────────────────────────────

    def _trigger_mitigation(self, src_ip: str, attack_type: str, pps: float):
        self._blocked.add(src_ip)

        if not self._datapaths:
            log.error("[DDoS] Sin datapaths — no se puede bloquear %s", src_ip)
            return

        log.warning(
            "[DDoS] *** ATAQUE DETECTADO *** tipo=%s src_ip=%s pps=%.1f",
            attack_type, src_ip, pps,
        )

        installed_on = []
        for dpid, datapath in self._datapaths.items():
            self._install_block_rule(datapath, src_ip)
            installed_on.append(dpid)

        log.warning(
            "[DDoS] *** BLOQUEADO *** src_ip=%s | DROP en dpids=%s",
            src_ip, installed_on,
        )

        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        print(
            f"DDOS_EVENT timestamp={ts} src_ip={src_ip} "
            f"attack_type={attack_type} pps={pps:.1f} "
            f"action=BLOCKED dpids={installed_on}",
            flush=True,
        )

    def _install_block_rule(self, datapath, src_ip: str):
        """
        Regla DROP de prioridad 1000 — supera mirror (200) y forwarding (100).
        idle_timeout permite expiración automática.
        """
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