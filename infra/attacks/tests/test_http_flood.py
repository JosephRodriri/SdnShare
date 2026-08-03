#!/usr/bin/env python3
import time

h2 = net.get("h2")
h4 = net.get("h4")

TARGET = h4.IP()

print(f"\n[HTTPFlood] h2 -> http://{TARGET}/")

# Servidor HTTP
print("[HTTPFlood] Iniciando servidor HTTP...")
h4.cmd("pkill -f 'python3 -m http.server 80' 2>/dev/null || true")
h4.cmd(
    "python3 -m http.server 80 > /tmp/http_flood_server.log 2>&1 &"
)

time.sleep(1)

print("[HTTPFlood] Lanzando flood HTTP...")

# 30 GET concurrentes superan HTTP_FLOOD_THRESHOLD=10 req/s, pero quedan
# muy por debajo de SYN_FLOOD_THRESHOLD=100 SYN/s.
h2.cmd(
    f"for i in $(seq 1 30); do "
    f"curl -sS --http1.0 --max-time 2 http://{TARGET}/ > /dev/null & "
    "done; wait"
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
h4.cmd("pkill -f 'python3 -m http.server 80' 2>/dev/null || true")

if not blocked:
    raise SystemExit("El mitigador no bloqueó el HTTP flood")
