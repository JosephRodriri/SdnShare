#!/usr/bin/env python3
import time

h1 = net.get("h1")
h4 = net.get("h4")

TARGET = h4.IP()

print(f"\n[SYNFlood] h1 -> {TARGET}")

print("[SYNFlood] Lanzando SYN flood...")

h1.cmd(
    f"hping3 -S --flood -p 80 {TARGET} > /dev/null 2>&1 &"
)

time.sleep(8)

print("[SYNFlood] Verificando mitigación...")

out = h1.cmd(f"ping -c 3 -W 1 {TARGET}")

blocked = (
    "0 received" in out or
    "100% packet loss" in out
)

print(
    f"[SYNFlood] {' BLOQUEADO' if blocked else 'x NO bloqueado'}"
)

h1.cmd("pkill hping3")