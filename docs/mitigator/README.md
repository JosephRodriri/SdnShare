# DDoS Mitigator — Sistema de Detección y Mitigación de Ataques DDoS sobre SDN

Este módulo implementa un sistema de detección y mitigación de ataques DDoS sobre una infraestructura SDN basada en Mininet, Open vSwitch y Ryu con OpenFlow 1.3.

La idea principal del proyecto es aprovechar las ventajas de las redes definidas por software (SDN): al tener un controlador centralizado, es posible observar el tráfico de toda la red en tiempo real y reaccionar automáticamente instalando reglas OpenFlow para bloquear tráfico malicioso.

El sistema fue diseñado para funcionar sobre una topología Spine-Leaf y detectar diferentes tipos de ataques sin necesidad de hardware especializado como firewalls físicos o appliances IDS/IPS.

Actualmente el mitigador es capaz de detectar y bloquear:

* SYN Flood
* UDP Flood
* ICMP Flood
* HTTP Flood
* Port Scan

---

# ¿Cómo funciona?

El módulo `ddos_mitigator.py` trabaja junto con `dc_switch.py` dentro del controlador Ryu.

Mientras `dc_switch.py` se encarga del forwarding y aprendizaje de rutas, `ddos_mitigator.py` analiza el tráfico de red y decide cuándo una IP debe ser bloqueada.

El sistema utiliza dos mecanismos principales:

## 1. FlowStats Polling

Se consultan periódicamente las estadísticas de flujo de los switches OpenFlow para detectar tráfico volumétrico como:

* UDP Flood
* ICMP Flood

Con esto se calcula la cantidad de paquetes por segundo (pps) enviados por cada host.

---

## 2. PacketIn Inspection

El controlador intercepta ciertos paquetes TCP específicos para analizar:

* SYN Flood
* Port Scan
* HTTP Flood

Aquí se utilizan ventanas deslizantes (`sliding windows`) y una máquina de estados (FSM) para diferenciar tráfico legítimo de ataques reales.

---

# Arquitectura General

```text
Mininet Hosts
      │
      ▼
Open vSwitch (Spine-Leaf)
      │ OpenFlow 1.3
      ▼
Ryu Controller
 ├── dc_switch.py
 └── ddos_mitigator.py
        ├── FlowStats detector
        ├── SYN detector
        ├── HTTP detector
        ├── Port Scan detector
        └── Mitigation Engine
```

---

# Ataques soportados

| Ataque     | Método de detección                      |
| ---------- | ---------------------------------------- |
| SYN Flood  | Sliding window sobre paquetes SYN        |
| UDP Flood  | FlowStats + paquetes por segundo         |
| ICMP Flood | FlowStats + paquetes por segundo         |
| Port Scan  | Cantidad de puertos distintos escaneados |
| HTTP Flood | Inspección de payload HTTP               |

---

# Mitigación

Cuando el sistema detecta un ataque:

1. Identifica la IP atacante
2. Genera una regla DROP OpenFlow
3. Instala la regla en todos los switches
4. El tráfico del atacante queda bloqueado automáticamente

Las reglas se instalan con prioridad alta para asegurar que tengan precedencia sobre el forwarding normal.

---



# Requisitos

Antes de ejecutar las pruebas, asegúrate de tener instalado:

* Docker
* Docker Compose
* Mininet
* Ryu
* Open vSwitch

---

# Instalación de hping3

Algunas pruebas utilizan `hping3` para generar tráfico malicioso.

Si el contenedor de Mininet no lo tiene instalado, puedes hacerlo con:

```bash
docker compose exec mininet apt-get update
docker compose exec mininet apt-get install -y hping3
docker compose exec mininet which hping3
```

Si el último comando devuelve una ruta como:

```bash
/usr/sbin/hping3
```

entonces quedó instalado correctamente.

---

# Ejecución del laboratorio

Levantar los servicios:

```bash
docker compose up -d
```

Iniciar la topología:

```bash
make topo
```

---

# Ejecución de pruebas

Las pruebas pueden ejecutarse directamente desde la CLI de Mininet.

## SYN Flood

```bash
py exec(open('infra/attacks/tests/test_syn_flood.py').read())
```

Esta prueba genera una inundación de paquetes SYN para verificar la detección del ataque y la instalación automática de reglas DROP.

---

## UDP Flood

```bash
py exec(open('infra/attacks/tests/test_udp_flood.py').read())
```

Envía grandes cantidades de tráfico UDP para validar el detector volumétrico basado en FlowStats.

---

## ICMP Flood

```bash
py exec(open('infra/attacks/tests/test_icmp_flood.py').read())
```

Genera múltiples paquetes ICMP Echo Request para saturar la red y comprobar el mecanismo de mitigación.

---

## Port Scan

```bash
py exec(open('infra/attacks/tests/test_port_scan.py').read())
```

Ejecuta un escaneo de puertos para validar la detección basada en diversidad de puertos destino.

---

## HTTP Flood

```bash
py exec(open('infra/attacks/tests/test_http_flood.py').read())
```

Simula múltiples peticiones HTTP concurrentes para validar la detección de floods de aplicación.

---

# Verificación de mitigación

Puedes validar las reglas instaladas desde FlowManager:

```text
http://localhost:8080/home
```

Buscar reglas con:

* `priority=1000`
* `ipv4_src=<IP atacante>`
* instrucciones vacías (`DROP`)

---

# Logs esperados

Cuando un ataque es detectado, el controlador mostrará mensajes similares a:

```text
[DDoS] ATAQUE DETECTADO tipo=SYN_FLOOD ip=10.1.1.1
[DDoS] BLOQUEADO ip=10.1.1.1 switches=[11,12,21,22,23]
```

También se generan eventos parseables:

```text
DDOS_EVENT attack_type=SYN_FLOOD src_ip=10.1.1.1
```

---

