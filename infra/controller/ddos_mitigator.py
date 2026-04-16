"""
MIT License
Copyright (c) 2024

DDoS Detection and Mitigation Module — Phase 1
Integrates with the existing Spine-Leaf SDN lab.

Detection strategy: threshold-based (packets/sec per source IP).
Mitigation: install DROP flow rules on all leaf switches for attacker IP.

Supported attack types detected:
  - SYN flood   (TCP, flags=SYN)
  - UDP flood
  - ICMP flood

Usage (in docker-compose.yaml command line):
  "infra/controller/dc_switch.py infra/controller/ddos_mitigator.py --observe-links"
"""

import logging
import os
import time
from collections import defaultdict

from ryu.base import app_manager
from ryu.controller import ofp_event
from ryu.controller.handler import MAIN_DISPATCHER, set_ev_cls
from ryu.lib import hub
from ryu.lib.packet import arp, ethernet, ether_types, icmp, ipv4, packet, tcp, udp
from ryu.ofproto import ofproto_v1_3

# ── Tunable thresholds ────────────────────────────────────────────────────────
# Packets per second from a single source IP that trigger a block.
# Lower these for a faster demo; raise them to avoid false positives.
THRESHOLD_SYN_PPS  = int(os.environ.get("DDOS_THRESH_SYN",  100))   # SYN flood
THRESHOLD_UDP_PPS  = int(os.environ.get("DDOS_THRESH_UDP",  200))   # UDP flood
THRESHOLD_ICMP_PPS = int(os.environ.get("DDOS_THRESH_ICMP", 50))    # ICMP flood

# How often (seconds) the detection loop runs
DETECTION_INTERVAL = int(os.environ.get("DDOS_INTERVAL", 2))

# How long (seconds) a block stays active (0 = permanent until restart)
BLOCK_IDLE_TIMEOUT = int(os.environ.get("DDOS_BLOCK_TIMEOUT", 120))

# OpenFlow priority for DROP rules — must beat normal forwarding rules
BLOCK_PRIORITY = 1000

# Flow table to install block rules on leaf switches (same as dc_switch tables)
BLOCK_TABLE = 0

# ── Logging ───────────────────────────────────────────────────────────────────
log = logging.getLogger("ddos_mitigator")
log.setLevel(logging.INFO)


class DDoSMitigator(app_manager.RyuApp):
    """
    Passive DDoS detection and active mitigation for the Spine-Leaf SDN lab.

    This app runs alongside dc_switch.py. It does NOT forward packets itself —
    it only listens to PacketIn events already delivered to the controller,
    counts traffic per source IP, and installs DROP rules when thresholds
    are exceeded.
    """

    OFP_VERSIONS = [ofproto_v1_3.OFP_VERSION]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # { src_ip: { "syn": count, "udp": count, "icmp": count } }
        self._counters: dict[str, dict[str, int]] = defaultdict(
            lambda: {"syn": 0, "udp": 0, "icmp": 0}
        )

        # Set of IPs currently blocked  { src_ip }
        self._blocked: set[str] = set()

        # Map datapath_id → datapath object (for installing rules later)
        self._datapaths: dict[int, object] = {}

        # Leaf switch IDs — populated lazily from _datapaths
        # We block on ALL registered datapaths (spine + leaf) to be safe.
        # In practice leaf switches are the entry point for host traffic.
        self._leaf_dpids: set[int] = set()

        # Detection loop
        self._detect_thread = hub.spawn(self._detection_loop)

        log.info(
            "[DDoS] Mitigator started | thresholds: SYN=%d UDP=%d ICMP=%d pps "
            "| interval=%ds | block_timeout=%ds",
            THRESHOLD_SYN_PPS,
            THRESHOLD_UDP_PPS,
            THRESHOLD_ICMP_PPS,
            DETECTION_INTERVAL,
            BLOCK_IDLE_TIMEOUT,
        )

    # ── Datapath registry ─────────────────────────────────────────────────────

    @set_ev_cls(ofp_event.EventOFPStateChange, [
        MAIN_DISPATCHER,
    ])
    def _state_change_handler(self, ev):
        datapath = ev.datapath
        if ev.state == MAIN_DISPATCHER:
            self._datapaths[datapath.id] = datapath
            log.info("[DDoS] Registered datapath dpid=%d", datapath.id)

    # ── Packet inspection ─────────────────────────────────────────────────────

    @set_ev_cls(ofp_event.EventOFPPacketIn, MAIN_DISPATCHER)
    def _packet_in_handler(self, ev):
        """Inspect every packet arriving at the controller and update counters."""
        msg = ev.msg
        datapath = msg.datapath

        # Keep datapath registry up to date
        self._datapaths[datapath.id] = datapath

        pkt = packet.Packet(msg.data)
        eth = pkt.get_protocol(ethernet.ethernet)

        if not eth or eth.ethertype == ether_types.ETH_TYPE_LLDP:
            return

        ip_pkt = pkt.get_protocol(ipv4.ipv4)
        if not ip_pkt:
            return  # ARP and other non-IP traffic ignored

        src_ip = ip_pkt.src

        # Skip already-blocked sources (rules should stop them at the switch,
        # but controller may still receive buffered packets briefly)
        if src_ip in self._blocked:
            return

        tcp_pkt  = pkt.get_protocol(tcp.tcp)
        udp_pkt  = pkt.get_protocol(udp.udp)
        icmp_pkt = pkt.get_protocol(icmp.icmp)

        if tcp_pkt:
            # SYN flag = 0x02
            if tcp_pkt.bits & 0x02:
                self._counters[src_ip]["syn"] += 1
        elif udp_pkt:
            self._counters[src_ip]["udp"] += 1
        elif icmp_pkt:
            self._counters[src_ip]["icmp"] += 1

    # ── Detection loop ────────────────────────────────────────────────────────

    def _detection_loop(self):
        """
        Runs every DETECTION_INTERVAL seconds.
        Converts raw counters to pps, compares against thresholds,
        triggers mitigation when exceeded, then resets counters.
        """
        while True:
            hub.sleep(DETECTION_INTERVAL)
            self._analyze()

    def _analyze(self):
        """Snapshot current counters, compute pps, act on violations."""
        snapshot = dict(self._counters)
        self._counters.clear()

        for src_ip, counts in snapshot.items():
            if src_ip in self._blocked:
                continue

            syn_pps  = counts["syn"]  / DETECTION_INTERVAL
            udp_pps  = counts["udp"]  / DETECTION_INTERVAL
            icmp_pps = counts["icmp"] / DETECTION_INTERVAL

            attack_type = None
            pps_value   = 0

            if syn_pps >= THRESHOLD_SYN_PPS:
                attack_type = "SYN_FLOOD"
                pps_value   = syn_pps
            elif udp_pps >= THRESHOLD_UDP_PPS:
                attack_type = "UDP_FLOOD"
                pps_value   = udp_pps
            elif icmp_pps >= THRESHOLD_ICMP_PPS:
                attack_type = "ICMP_FLOOD"
                pps_value   = icmp_pps

            if attack_type:
                self._trigger_mitigation(src_ip, attack_type, pps_value)

    # ── Mitigation ────────────────────────────────────────────────────────────

    def _trigger_mitigation(self, src_ip: str, attack_type: str, pps: float):
        """Log the attack and install DROP rules on all known datapaths."""
        self._blocked.add(src_ip)

        log.warning(
            "[DDoS] *** ATTACK DETECTED *** type=%s src_ip=%s pps=%.1f",
            attack_type,
            src_ip,
            pps,
        )

        installed_on = []
        for dpid, datapath in self._datapaths.items():
            self._install_block_rule(datapath, src_ip)
            installed_on.append(dpid)

        log.warning(
            "[DDoS] *** BLOCKED *** src_ip=%s | DROP rules installed on dpids=%s",
            src_ip,
            installed_on,
        )

        # Emit a structured event line for easy grepping
        self._log_event(src_ip, attack_type, pps, installed_on)

    def _install_block_rule(self, datapath, src_ip: str):
        """
        Install a high-priority DROP flow entry matching the attacker's IP
        on the given switch.  idle_timeout lets it expire automatically.
        """
        ofproto = datapath.ofproto
        parser  = datapath.ofproto_parser

        match = parser.OFPMatch(
            eth_type=ether_types.ETH_TYPE_IP,
            ipv4_src=src_ip,
        )

        # Empty instruction list = DROP
        msg = parser.OFPFlowMod(
            datapath=datapath,
            table_id=BLOCK_TABLE,
            priority=BLOCK_PRIORITY,
            idle_timeout=BLOCK_IDLE_TIMEOUT,
            hard_timeout=0,
            match=match,
            instructions=[],  # DROP
            command=ofproto.OFPFC_ADD,
            flags=ofproto.OFPFF_SEND_FLOW_REM,
        )
        datapath.send_msg(msg)

    # ── Cleanup on rule expiry ────────────────────────────────────────────────

    @set_ev_cls(ofp_event.EventOFPFlowRemoved, MAIN_DISPATCHER)
    def _flow_removed_handler(self, ev):
        """
        When a block rule expires (idle_timeout), remove the IP from the
        blocked set so it can be re-evaluated.
        """
        msg    = ev.msg
        match  = msg.match

        if msg.priority != BLOCK_PRIORITY:
            return

        src_ip = match.get("ipv4_src")
        if src_ip and src_ip in self._blocked:
            self._blocked.discard(src_ip)
            log.info(
                "[DDoS] Block expired for src_ip=%s — monitoring resumed", src_ip
            )

    # ── Structured log ───────────────────────────────────────────────────────

    @staticmethod
    def _log_event(src_ip: str, attack_type: str, pps: float, dpids: list):
        """Write a parseable event line to stdout."""
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        print(
            f"DDOS_EVENT timestamp={ts} src_ip={src_ip} "
            f"attack_type={attack_type} pps={pps:.1f} "
            f"action=BLOCKED dpids={dpids}",
            flush=True,
        )