#!/usr/bin/env python3
import time

h2 = net.get("h2")
h4 = net.get("h4")

TARGET = h4.IP()

print(f"\n[HTTPFlood] h2 -> http://{TARGET}/")

# Servidor HTTP
print("[HTTPFlood] Iniciando servidor HTTP...")
h4.cmd(
    "python3 -m http.server 80 > /dev/null 2>&1 &"
)

time.sleep(3)

print("[HTTPFlood] Lanzando flood HTTP...")

# Flood más agresivo
for _ in range(500):
    h2.cmd(
        f"curl -s http://{TARGET}/ > /dev/null 2>&1 &"
    )

print("[HTTPFlood] Esperando detección y mitigación...")

WAIT_SECONDS = 20

for i in range(WAIT_SECONDS):
    print(f"[HTTPFlood] {i+1}/{WAIT_SECONDS}s")
    time.sleep(1)

print("[HTTPFlood] Verificando conectividad...")

blocked = False

for attempt in range(5):

    out = h2.cmd(
        f"ping -c 2 -W 1 {TARGET}"
    )

    print(f"\n[HTTPFlood] Intento {attempt+1}")
    print(out)

    if (
        "0 received" in out or
        "100% packet loss" in out
    ):
        blocked = True
        break

    time.sleep(2)

print(
    f"\n[HTTPFlood] {' BLOQUEADO' if blocked else 'x NO bloqueado'}"
)

print("[HTTPFlood] Limpiando procesos...")

h2.cmd("pkill curl 2>/dev/null")
h4.cmd("pkill python3 2>/dev/null")