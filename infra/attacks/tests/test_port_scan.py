#!/usr/bin/env python3
import time

h1 = net.get("h1")
h4 = net.get("h4")

TARGET = h4.IP()

print(f"\n[PortScan] h1 -> {TARGET}")

print("[PortScan] Ejecutando escaneo SYN...")

# Lanzar escaneo
h1.cmd(
    f"nmap -sS -p 1-1024 {TARGET} > /dev/null 2>&1 &"
)

# Esperar detección + instalación OpenFlow
WAIT_SECONDS = 20

for i in range(WAIT_SECONDS):
    print(f"[PortScan] Esperando mitigación... {i+1}/{WAIT_SECONDS}s")
    time.sleep(1)

print("[PortScan] Verificando bloqueo...")

blocked = False

# Intentar varias veces porque OpenFlow puede tardar
for attempt in range(5):

    out = h1.cmd(f"ping -c 2 -W 1 {TARGET}")

    print(f"\n[PortScan] Intento {attempt+1}")
    print(out)

    if (
        "0 received" in out or
        "100% packet loss" in out
    ):
        blocked = True
        break

    time.sleep(2)

print(
    f"\n[PortScan] {' BLOQUEADO' if blocked else 'x NO bloqueado'}"
)

# Limpiar procesos nmap
h1.cmd("pkill nmap 2>/dev/null")