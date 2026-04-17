#!/usr/bin/env python3
"""
ddos_demo.py  —  v3
────────────────────
Demo DDoS para el lab Spine-Leaf. Compatible con mitigador v3 (mirror-based).

Ejecutar desde la CLI de Mininet:
  mininet> py exec(open('infra/attacks/ddos_demo.py').read())

Requiere: hping3 instalado en el contenedor Mininet.
  docker compose exec mininet apt-get install -y hping3
"""

import time
import subprocess

# ── Helpers (definidos globalmente para evitar errores de scope en exec()) ────

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

def _hping3_available(host):
    return bool(host.cmd("which hping3").strip())

def _stop_all(host):
    host.cmd("pkill hping3 2>/dev/null; pkill ping 2>/dev/null; true")

def _check_blocked(host, target_ip):
    out = host.cmd(f"ping -c 4 -W 1 {target_ip}")
    blocked = "0 received" in out or "100% packet loss" in out
    status = "✓ BLOQUEADO" if blocked else "✗ NO bloqueado (revisa logs del controller)"
    print(f"  {status} — {host.name} → {target_ip}")
    return blocked

# ── Setup ─────────────────────────────────────────────────────────────────────

h1 = net.get("h1")
h2 = net.get("h2")
h3 = net.get("h3")
h4 = net.get("h4")
h5 = net.get("h5")
h6 = net.get("h6")
TARGET_IP = h4.IP()

hping3_ok = _hping3_available(h1)

# ── Verificar herramientas ────────────────────────────────────────────────────

_banner("Verificación de herramientas")
if hping3_ok:
    print("  ✓ hping3 disponible")
else:
    print("  ✗ hping3 NO disponible")
    print("    Instalar: docker compose exec mininet apt-get install -y hping3")
    print("    Reconstruir permanente: edita infra/docker/Dockerfile.mininet")
    print("    Usando ping -f como fallback para ICMP flood únicamente.")

# ── PASO 1: Baseline ──────────────────────────────────────────────────────────

_banner("PASO 1: Conectividad base")
net.pingAll()

# ── PASO 2: SYN Flood ────────────────────────────────────────────────────────

_banner("PASO 2: SYN Flood  h1 → h4")
if hping3_ok:
    print(f"  Lanzando: hping3 -S --flood -p 80 {TARGET_IP}")
    print("  (--flood = máxima velocidad, sin esperar respuestas)")
    h1.cmd(f"hping3 -S --flood -p 80 {TARGET_IP} > /dev/null 2>&1 &")
    h2.cmd(f"hping3 -S --flood -p 80 {TARGET_IP} > /dev/null 2>&1 &")
    print("  h1 y h2 atacando durante 10 s ...")
    time.sleep(10)
    _stop_all(h1)
    _stop_all(h2)
    print("  Flood detenido. Esperando 3 s para último ciclo de detección...")
    time.sleep(3)
    print()
    print("  Verificando bloqueos:")
    _check_blocked(h1, TARGET_IP)
    _check_blocked(h2, TARGET_IP)
else:
    print("  Omitido (hping3 no disponible)")

# ── PASO 3: Inocente no bloqueado ────────────────────────────────────────────

_banner("PASO 3: Verificar host inocente h6")
out6 = h6.cmd(f"ping -c 3 -W 1 {TARGET_IP}")
if "0 received" in out6 or "100% packet loss" in out6:
    print("  ✗ h6 bloqueado — posible falso positivo, baja thresholds")
else:
    print("  ✓ h6 puede llegar a h4 — solo los atacantes fueron bloqueados")

# ── PASO 4: UDP Flood ────────────────────────────────────────────────────────

_banner("PASO 4: UDP Flood  h3 → h4")
if hping3_ok:
    print(f"  Lanzando: hping3 --udp --flood -p 53 {TARGET_IP}")
    h3.cmd(f"hping3 --udp --flood -p 53 {TARGET_IP} > /dev/null 2>&1 &")
    print("  h3 atacando durante 10 s ...")
    time.sleep(10)
    _stop_all(h3)
    time.sleep(3)
    print()
    print("  Verificando bloqueo:")
    _check_blocked(h3, TARGET_IP)
else:
    print("  Omitido (hping3 no disponible)")

# ── PASO 5: ICMP Flood ───────────────────────────────────────────────────────

_banner("PASO 5: ICMP Flood  h5 → h4")
if hping3_ok:
    h5.cmd(f"hping3 --icmp --flood {TARGET_IP} > /dev/null 2>&1 &")
    print(f"  hping3 --icmp --flood {TARGET_IP}")
else:
    h5.cmd(f"ping -f {TARGET_IP} > /dev/null 2>&1 &")
    print(f"  ping -f {TARGET_IP} (fallback)")
print("  h5 atacando durante 10 s ...")
time.sleep(10)
_stop_all(h5)
time.sleep(3)
print()
print("  Verificando bloqueo:")
_check_blocked(h5, TARGET_IP)

# ── Resumen ───────────────────────────────────────────────────────────────────

_banner("DEMO COMPLETA")
print("""
  Comandos para verificar evidencia:
  ────────────────────────────────────────────────────────────
  # Eventos DDoS en los logs:
  docker compose logs controller | grep -E "ATAQUE|BLOQUEADO|DDOS_EVENT"

  # Reglas DROP instaladas (busca priority=1000, instructions=[]):
  http://localhost:8080/home  →  selecciona switch  →  Flow Table

  # Los bloqueos expiran en BLOCK_IDLE_TIMEOUT segundos (default 120 s)
  # Para desbloquear manualmente: make restart
""")