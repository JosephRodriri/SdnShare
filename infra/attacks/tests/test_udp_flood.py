#!/usr/bin/env python3
import time

h2 = net.get("h2")
h4 = net.get("h4")

TARGET = h4.IP()

print(f"\n[UDPFlood] h2 -> {TARGET}")

print("[UDPFlood] Lanzando UDP flood...")

h2.cmd(
    f"hping3 --udp --flood -p 53 {TARGET} > /dev/null 2>&1 &"
)

time.sleep(8)

print("[UDPFlood] Verificando mitigación...")

out = h2.cmd(f"ping -c 3 -W 1 {TARGET}")

blocked = (
    "0 received" in out or
    "100% packet loss" in out
)

print(
    f"[UDPFlood] {' BLOQUEADO' if blocked else 'x NO bloqueado'}"
)

h2.cmd("pkill hping3")

if not blocked:
    raise SystemExit("El mitigador no bloqueó el UDP flood")
