#!/usr/bin/env python3
"""
test_syn_flood.py
─────────────────
Minimal SYN flood test.  Paste into Mininet CLI:

  mininet> py exec(open('infra/attacks/test_syn_flood.py').read())
"""
import time

TARGET = net.get("h4").IP()
attacker = net.get("h1")

print(f"[SYN FLOOD] h1 → {TARGET}  (10 s)")
attacker.cmd(f"hping3 -S --faster -p 80 -c 10000 {TARGET} &")
time.sleep(10)
attacker.cmd("pkill hping3")

print("[SYN FLOOD] Attack stopped.")
print(f"[SYN FLOOD] Testing connectivity h1 → {TARGET}:")
out = attacker.cmd(f"ping -c 3 -W 1 {TARGET}")
blocked = "0 received" in out or "100% packet loss" in out
print("[SYN FLOOD] BLOCKED ✓" if blocked else "[SYN FLOOD] NOT blocked ✗ — check thresholds/logs")