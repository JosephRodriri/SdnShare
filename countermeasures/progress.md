## 16_4_2026
*Archivos creados:*

1. `infra/controller/ddos_mitigator.py`

*Rol:*
App Ryu que corre junto al switch. Cuenta paquetes por IP origen y bloquea cuando se supera el umbral.

2. `infra/attacks/ddos_demo.py`
   *Rol:*
   Lanza ataques SYN/UDP/ICMP en secuencia y verifica que el bloqueo funciona.

3. `infra/attacks/test_syn_flood.py`
   *Rol:*
   Prueba mínima de un solo ataque.

4. `scripts/watch_ddos.sh`
   *Rol:*
   Colorea los eventos DDoS en el output del controlador.

*archivos modificados:*

- docker-compose.yml