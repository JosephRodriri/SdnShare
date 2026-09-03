#!/usr/bin/env python3
import time

# Un solo proceso hping3 puede no llegar a 1000 pps en un entorno Docker.
# Los procesos comparten IP/MAC, por lo que FlowStats agrega su tráfico en el
# mismo contador y el mitigador evalúa la tasa total de la fuente.
FLOOD_PROCESSES = 4
# Se esperan dos sondeos de FlowStats: baseline y evaluación del delta.
DETECTION_WAIT_SECONDS = 8

h3 = net.get("h3")
h4 = net.get("h4")

TARGET = h4.IP()

print(f"\n[ICMPFlood] h3 -> {TARGET}")

print(
    f"[ICMPFlood] Lanzando {FLOOD_PROCESSES} ICMP floods "
    "(>1000 pps agregados esperado)..."
)
blocked = False

try:
    h3.cmd(
        "for i in $(seq 1 " + str(FLOOD_PROCESSES) + "); do "
        f"hping3 --icmp --flood {TARGET} > /dev/null 2>&1 & "
        "done"
    )

    # Con un sondeo de 2 s, el bloqueo debe llegar tras baseline + siguiente delta.
    time.sleep(DETECTION_WAIT_SECONDS)

    # La regla DROP persiste tras detener el flood. Así el ping valida la
    # mitigación y no una pérdida causada sólo por congestión.
    h3.cmd("pkill hping3")
    print("[ICMPFlood] Verificando mitigación...")

    out = h3.cmd(f"ping -c 3 -W 1 {TARGET}")

    blocked = (
        "0 received" in out or
        "100% packet loss" in out
    )

    print(
        f"[ICMPFlood] {' BLOQUEADO' if blocked else 'x NO bloqueado'}"
    )
finally:
    h3.cmd("pkill hping3")

if not blocked:
    raise SystemExit("El mitigador no bloqueó el ICMP flood")
