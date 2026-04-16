Quiero desarrollar un módulo de contramedidas DDoS para un laboratorio SDN usando Ryu +
1. Setup del entorno SDN:

* Integración con controlador Ryu
* Funcionamiento en Mininet
* Captura de estadísticas de tráfico (flow stats)

2. Detección de ataques tipo flood:

* SYN flood
* UDP flood
* ICMP flood

La detección debe basarse en comportamiento (thresholds de paquetes por segundo o volumen de tráfico).

3. Primera contramedida funcional:

* Instalación automática de reglas OpenFlow
* Bloqueo de IP origen atacante
* Log de eventos de detección y mitigación

4. Salida esperada:

* Evidencia en logs del controlador
* Demostración en Mininet
* Código modular y fácil de extender


