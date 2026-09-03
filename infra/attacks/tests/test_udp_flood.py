#!/usr/bin/env python3
import time

# Un solo proceso hping3 puede no llegar a 1000 pps en un entorno Docker.
# Los procesos comparten IP/MAC, por lo que FlowStats agrega su tráfico en el
# mismo contador y el mitigador evalúa la tasa total de la fuente.
FLOOD_PROCESSES = 4
# Se esperan dos sondeos: el primero establece el baseline y el segundo detecta
# el delta. El margen adicional evita falsos negativos por el arranque del flujo.
# 12s: margen extra para VMs lentas donde los hping3 tardan en arrancar.
DETECTION_WAIT_SECONDS = 12

h2 = net.get("h2")
h4 = net.get("h4")

TARGET = h4.IP()

print(f"\n[UDPFlood] h2 -> {TARGET}")

print(
    f"[UDPFlood] Lanzando {FLOOD_PROCESSES} UDP floods "
    "(>1000 pps agregados esperado)..."
)
blocked = False

try:
    h2.cmd(
        "for i in $(seq 1 " + str(FLOOD_PROCESSES) + "); do "
        f"hping3 --udp --flood -p 53 {TARGET} > /dev/null 2>&1 & "
        "done"
    )

    # Con un sondeo de 2 s, el bloqueo debe llegar tras baseline + siguiente delta.
    time.sleep(DETECTION_WAIT_SECONDS)

    # La regla DROP persiste tras detener el flood. Así el ping valida la
    # mitigación y no una pérdida causada sólo por congestión.
    h2.cmd("pkill hping3")
    print("[UDPFlood] Verificando mitigación...")

    out = h2.cmd(f"ping -c 3 -W 1 {TARGET}")

    blocked = (
        "0 received" in out or
        "100% packet loss" in out
    )

    print(
        f"[UDPFlood] {' BLOQUEADO' if blocked else 'x NO bloqueado'}"
    )
finally:
    h2.cmd("pkill hping3")

if not blocked:
    # Señal no fatal (ver test_syn_flood.py): no romper el CLI ni el `make`.
    _LAST_TEST_BLOCKED = blocked
    print("[UDPFlood] El mitigador no bloqueó el UDP flood")
