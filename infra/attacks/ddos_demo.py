#!/usr/bin/env python3
"""
ddos_demo.py  —  v4
────────────────────
Compatible con mitigador v4 (FlowStats polling).

Cambios vs v3:
  • Sin verificación de hping3 al inicio (ya se sabe que está instalado)
  • Tiempos de ataque más largos para dar ciclos de FlowStats suficientes
  • Espera post-ataque de un ciclo completo de polling antes de verificar

Ejecutar desde la CLI de Mininet:
  mininet> py exec(open('infra/attacks/ddos_demo.py').read())
"""

import time

# ── Helpers ───────────────────────────────────────────────────────────────────

def _banner(msg):
    print("\n" + "═" * 60)
    print(f"  {msg}")
    print("═" * 60)

def _run(host, cmd, background=False):
    if background:
        host.cmd(cmd + " &")
        print(f"  [{host.name}] (bg) {cmd}")
        return ""
    out = host.cmd(cmd)
    trimmed = out.strip()[:300] if out.strip() else "(sin salida)"
    print(f"  [{host.name}] {cmd}")
    print(f"    → {trimmed}")
    return out

def _stop_all(host):
    host.cmd("pkill hping3 2>/dev/null; pkill ping 2>/dev/null; true")

def _check_blocked(host, target_ip):
    out = host.cmd(f"ping -c 4 -W 1 {target_ip}")
    blocked = "0 received" in out or "100% packet loss" in out
    icon = "✓ BLOQUEADO" if blocked else "✗ NO bloqueado"
    print(f"  {icon} — {host.name} → {target_ip}")
    return blocked

def _check_reachable(host, target_ip):
    out = host.cmd(f"ping -c 3 -W 1 {target_ip}")
    ok = "0 received" not in out and "100% packet loss" not in out
    icon = "✓ Conectado" if ok else "✗ Sin conectividad"
    print(f"  {icon} — {host.name} → {target_ip}")
    return ok

# ── Hosts ─────────────────────────────────────────────────────────────────────

h1 = net.get("h1"); h2 = net.get("h2"); h3 = net.get("h3")
h4 = net.get("h4"); h5 = net.get("h5"); h6 = net.get("h6")
TARGET_IP = h4.IP()

# ── PASO 1: Baseline ──────────────────────────────────────────────────────────

_banner("PASO 1: Conectividad base (pingall)")
net.pingAll()
print()
print("  Importante: pingall hace que el mitigador aprenda las MACs→IPs")
print("  de todos los hosts. Sin este paso el mitigador no puede mapear")
print("  los contadores de FlowStats a IPs.")

# ── PASO 2: SYN Flood ────────────────────────────────────────────────────────

_banner("PASO 2: SYN Flood  h1 + h2 → h4")
print(f"  hping3 --flood -S -p 80 {TARGET_IP}")
print("  (--flood = sin rate limit; ataque durante 15 s)")
h1.cmd(f"hping3 -S --flood -p 80 {TARGET_IP} > /dev/null 2>&1 &")
h2.cmd(f"hping3 -S --flood -p 80 {TARGET_IP} > /dev/null 2>&1 &")
print("  Atacando 15 s... (observa: docker compose logs -f controller | grep DDoS)")
time.sleep(15)
_stop_all(h1); _stop_all(h2)
print("  Flood detenido. Esperando ciclo de FlowStats (6 s)...")
time.sleep(6)
_check_blocked(h1, TARGET_IP)
_check_blocked(h2, TARGET_IP)

# ── PASO 3: Host inocente ────────────────────────────────────────────────────

_banner("PASO 3: Verificar host inocente h6 → h4")
_check_reachable(h6, TARGET_IP)

# ── PASO 4: UDP Flood ────────────────────────────────────────────────────────

_banner("PASO 4: UDP Flood  h3 → h4")
print(f"  hping3 --udp --flood -p 53 {TARGET_IP}")
h3.cmd(f"hping3 --udp --flood -p 53 {TARGET_IP} > /dev/null 2>&1 &")
print("  Atacando 15 s...")
time.sleep(15)
_stop_all(h3)
time.sleep(6)
_check_blocked(h3, TARGET_IP)

# ── PASO 5: ICMP Flood ───────────────────────────────────────────────────────

_banner("PASO 5: ICMP Flood  h5 → h4")
print(f"  hping3 --icmp --flood {TARGET_IP}")
h5.cmd(f"hping3 --icmp --flood {TARGET_IP} > /dev/null 2>&1 &")
print("  Atacando 15 s...")
time.sleep(15)
_stop_all(h5)
time.sleep(6)
_check_blocked(h5, TARGET_IP)

# ── Resumen ───────────────────────────────────────────────────────────────────

_banner("DEMO COMPLETA")
print("""
  Evidencia:
  ─────────────────────────────────────────────────────────
  docker compose logs controller | grep -E "ATAQUE|BLOQUEADO|DDOS_EVENT"
  http://localhost:8080/home  → Flow Table → busca priority=1000
""")