#!/usr/bin/env python3
import time

h3 = net.get("h3")
h4 = net.get("h4")

TARGET = h4.IP()

print(f"\n[ICMPFlood] h3 -> {TARGET}")

print("[ICMPFlood] Lanzando ICMP flood...")

h3.cmd(
    f"hping3 --icmp --flood {TARGET} > /dev/null 2>&1 &"
)

time.sleep(8)

print("[ICMPFlood] Verificando mitigación...")

out = h3.cmd(f"ping -c 3 -W 1 {TARGET}")

blocked = (
    "0 received" in out or
    "100% packet loss" in out
)

print(
    f"[ICMPFlood] {' BLOQUEADO' if blocked else 'x NO bloqueado'}"
)

h3.cmd("pkill hping3")

if not blocked:
    raise SystemExit("El mitigador no bloqueó el ICMP flood")
