# Arquitectura de Contramedidas DDoS para SDN Spine-Leaf

## Introducción

Este módulo implementa un sistema de detección y mitigación de ataques DDoS sobre una arquitectura SDN Spine-Leaf utilizando Ryu Controller y OpenFlow 1.3.

La solución fue diseñada para ejecutarse dentro de un laboratorio virtualizado basado en Docker + Mininet, permitiendo detectar y mitigar múltiples tipos de ataques en tiempo real mediante reglas dinámicas OpenFlow.

El objetivo principal del módulo es:

* Detectar ataques de red en tiempo real.
* Diferenciar tráfico legítimo de tráfico malicioso.
* Mitigar automáticamente hosts atacantes.
* Reducir falsos positivos.
* Mantener la estabilidad del controlador SDN.

---

# Problema Principal

En versiones anteriores del mitigador (v7), existía un problema importante:

El detector de SYN Flood bloqueaba direcciones IP demasiado rápido.

Ejemplo:

```bash
ab -c 200 -n 5000 http://TARGET/
```

ApacheBench genera múltiples conexiones concurrentes.

Eso produce:

* muchos paquetes SYN legítimos
* seguidos inmediatamente de tráfico HTTP válido

Sin embargo:

* el detector veía primero los SYN
* superaba el threshold
* bloqueaba la IP antes de que llegaran los requests HTTP

Resultado:

* un HTTP Flood era clasificado erróneamente como SYN Flood

---

# Solución Implementada

Se implementó una:

## Máquina de Estados con Correlación SYN/HTTP

La lógica central del sistema ahora analiza:

* cantidad de SYN
* cantidad de requests HTTP
* relación entre ambos
* ventana temporal
* período de gracia

Esto permite distinguir entre:

| Tipo de tráfico  | Característica               |
| ---------------- | ---------------------------- |
| SYN Flood real   | muchos SYN sin HTTP          |
| HTTP Flood       | muchos SYN + HTTP            |
| Cliente legítimo | SYN normales + HTTP normales |

---

# Arquitectura General

```text
                    ┌─────────────────────────┐
                    │      Clientes SDN       │
                    │  h1 h2 h3 h4 ... hn     │
                    └────────────┬────────────┘
                                 │
                         Tráfico TCP/IP
                                 │
                ┌────────────────────────────────┐
                │        Spine-Leaf Fabric       │
                │                                │
                │  Leaf ─── Spine ─── Leaf       │
                │                                │
                └────────────────┬───────────────┘
                                 │ OpenFlow 1.3
                                 ▼
                  ┌──────────────────────────┐
                  │      Ryu Controller      │
                  │                          │
                  │  dc_switch.py            │
                  │  ddos_mitigator.py       │
                  └────────────┬─────────────┘
                               │
                 ┌─────────────┼─────────────┐
                 │             │             │
                 ▼             ▼             ▼
          SYN Detector   HTTP Detector   FlowStats
                 │             │             │
                 └──────┬──────┴──────┬──────┘
                        ▼             ▼
                 State Machine   Mitigation Engine
                        │
                        ▼
                OpenFlow DROP Rules
```

---

# Componentes del Sistema

## 1. Topología SDN Spine-Leaf

Archivo principal:

```text
infra/controller/dc_switch.py
```

Responsabilidades:

* aprendizaje MAC
* forwarding L2
* instalación de flujos
* interconexión spine-leaf
* forwarding entre switches

La topología utiliza:

* switches leaf
* switches spine
* OpenFlow 1.3
* Ryu Controller

---

# 2. Módulo de Mitigación DDoS

Archivo principal:

```text
infra/controller/ddos_mitigator.py
```

Este módulo se ejecuta junto al controlador principal:

```yaml
command: "infra/controller/dc_switch.py infra/controller/ddos_mitigator.py ..."
```

Funciones principales:

* monitoreo PacketIn
* análisis TCP
* detección HTTP
* análisis SYN
* detección Port Scan
* detección UDP/ICMP volumétrico
* instalación automática de reglas DROP

---

# Máquina de Estados

La lógica principal utiliza una FSM (Finite State Machine).

## Estados

| Estado         | Descripción           |
| -------------- | --------------------- |
| OBSERVING      | observando tráfico    |
| SYN_CANDIDATE  | alto volumen SYN      |
| HTTP_CANDIDATE | SYN + HTTP detectados |
| BLOCKED        | IP bloqueada          |

---

# Flujo de Estados

```text
                    ┌─────────────┐
                    │ OBSERVING   │
                    └──────┬──────┘
                           │
                  SYN > threshold
                           │
                           ▼
                 ┌─────────────────┐
                 │ SYN_CANDIDATE   │
                 └──────┬──────────┘
                        │
         ┌──────────────┴──────────────┐
         │                             │
         ▼                             ▼
   HTTP detectado              Grace timeout
         │                             │
         ▼                             ▼
┌──────────────────┐          ┌────────────────┐
│ HTTP_CANDIDATE   │          │ BLOCKED        │
└────────┬─────────┘          │ SYN_FLOOD      │
         │                    └────────────────┘
         │
 HTTP > threshold
         │
         ▼
┌──────────────────┐
│ BLOCKED           │
│ HTTP_FLOOD        │
└──────────────────┘
```

```text
ddos_mitigator.py  —  (State Machine Classifier + SYN/HTTP Correlation)


PROBLEMA CENTRAL RESUELTO EN v8

En v7, el detector SYN_FLOOD (threshold=30 SYN/s) bloqueaba la IP antes de
que el detector HTTP_FLOOD tuviera tiempo de observar requests GET/POST.

Raíz del problema:
  `ab -c 200 -n 5000` abre 200 conexiones concurrentes -> 200 SYN en ~7ms
  Con SYN_FLOOD_THRESHOLD=30 -> la IP se bloquea en t=7ms
  Los requests HTTP llegan en t=8ms -> nunca son vistos

  Sin embargo, `hping3 -S --flood` también genera >30 SYN/s, pero SIN
  completar el handshake -> los SYN nunca van seguidos de HTTP.

  La diferencia clave: SYN flood real = SYN sin HTTP. HTTP flood = SYN + HTTP.

SOLUCIÓN: MÁQUINA DE ESTADOS CON PERÍODO DE GRACIA
--------------------------------------------------------─
Cada IP observable pasa por estados antes de ser bloqueada:

  ┌─────────────┐
  │  OBSERVING  │  ← estado inicial, acumulando evidencia
  └──────┬──────┘
         │
    SYN rate > threshold
         │
         ├─── sin HTTP en ventana -> esperar SYN_GRACE_MS ──┐
         │                                                   │
         │    ¿llegan HTTP requests durante la gracia?       │
         │    SÍ: -> HTTP_CANDIDATE                          │
         │    NO: -> BLOCKED(SYN_FLOOD)  ←──────────────────┘
         │
  ┌──────▼──────────┐
  │ HTTP_CANDIDATE  │  ← alto SYN rate PERO también hay HTTP
  └──────┬──────────┘
         │
         ├─── HTTP_count > HTTP_FLOOD_THRESHOLD -> BLOCKED(HTTP_FLOOD)
         │
         ├─── ratio HTTP/SYN < SYN_HTTP_RATIO_MIN -> BLOCKED(SYN_FLOOD)
         │    (muchos SYN, pocos HTTP -> flood real, no cliente HTTP)
         │
         └─── timeout sin actividad -> volver a OBSERVING

HERRAMIENTAS DE PRUEBA EN LABORATORIO

  SYN Flood:
    hping3 -S --flood -p 80 TARGET          -> SYN sin ACK -> SYN_FLOOD
    hping3 -S --faster -c 500 -p 80 TARGET  -> SYN rápido controlado

  HTTP Flood (usa keep-alive para minimizar SYN):
    ab -n 2000 -c 10 -k http://TARGET/      -> -k = keep-alive -> pocos SYN
    wrk -t4 -c10 -d10s http://TARGET/       -> keep-alive nativo
    siege -c 10 -t 10s http://TARGET/       -> keep-alive por defecto

  HTTP Flood alternativo (sin keep-alive, usa threshold más alto):
    ab -n 500 -c 5 http://TARGET/           -> concurrencia baja -> SYN manageable

  Port Scan:
    nmap -sS -p 1-100 TARGET                -> SYN sin completar

THRESHOLDS RECOMENDADOS PARA LABORATORIO v8

  SYN_FLOOD_THRESHOLD=100   # Alto: HTTP flood legítimo genera ~50-200 SYN
  SYN_FLOOD_WINDOW=1.0      # Ventana para SYN
  SYN_GRACE_MS=100          # 100ms de gracia: suficiente para ver primeros HTTP
  SYN_HTTP_RATIO_MIN=0.2    # Si <20% de SYN tienen HTTP -> SYN_FLOOD puro
  HTTP_FLOOD_THRESHOLD=10   # 10 req/s es fácilmente alcanzable en lab
  HTTP_FLOOD_WINDOW=1.0     # Ventana de HTTP flood
```





---

# Detección de SYN Flood

## Estrategia

El controlador intercepta:

```text
TCP SYN packets
```

mediante reglas OpenFlow:

```python
tcp_flags=(0x002, 0x012)
```

El sistema mantiene:

```python
ctx.syn_ts = deque()
```

para aplicar una sliding window temporal.

---

## Variables principales

```python
SYN_FLOOD_THRESHOLD = 100
SYN_FLOOD_WINDOW = 1.0
SYN_GRACE_MS = 100
```

---

## Lógica

Si:

```text
SYN/s > threshold
```

la IP entra en:

```text
SYN_CANDIDATE
```

y espera un período de gracia.

Si no llegan requests HTTP:

```text
→ SYN_FLOOD
```

---

# Detección de HTTP Flood

El sistema inspecciona:

```text
TCP PSH packets
```

y extrae el payload TCP.

Se valida:

```python
GET
POST
PUT
DELETE
OPTIONS
```

---

## Variables

```python
HTTP_FLOOD_THRESHOLD = 10
HTTP_FLOOD_WINDOW = 1.0
```

---

## Correlación SYN/HTTP

El sistema calcula:

```python
HTTP_count / SYN_count
```

Si:

```text
ratio < SYN_HTTP_RATIO_MIN
```

entonces:

```text
SYN Flood real
```

Si:

```text
ratio >= threshold
```

entonces:

```text
HTTP Flood
```

---

# Detección de Port Scan

El sistema mantiene:

```python
ctx.portscan_ports
```

con puertos únicos observados.

Si una IP contacta muchos puertos diferentes:

```python
PORT_SCAN_THRESHOLD = 10
```

dentro de:

```python
PORT_SCAN_WINDOW = 10
```

entonces:

```text
PORT_SCAN detectado
```

---

# Detección Volumétrica UDP/ICMP

Se utiliza:

```text
OpenFlow FlowStats
```

para medir paquetes por segundo.

El módulo excluye:

```text
TCP traffic
```

para evitar interferencia con SYN/HTTP detection.

---

## Threshold

```python
DDOS_THRESH_PPS = 1000
```

---

# Motor de Mitigación

Cuando un ataque es confirmado:

```python
_trigger_mitigation()
```

instala reglas OpenFlow DROP:

```python
priority=1000
```

sobre todos los switches.

---

# Regla de Bloqueo

```python
match = parser.OFPMatch(
    eth_type=ether_types.ETH_TYPE_IP,
    ipv4_src=src_ip,
)
```

La regla:

* bloquea tráfico del atacante
* tiene timeout automático
* se elimina dinámicamente

---

# Expiración Automática

Las reglas usan:

```python
idle_timeout = BLOCK_IDLE_TIMEOUT
```

por defecto:

```python
120 segundos
```

Cuando expira:

```python
EventOFPFlowRemoved
```

limpia automáticamente:

* IP bloqueada
* contexto FSM
* sliding windows

---

# Monitoreo y Observabilidad

El laboratorio integra:

| Herramienta | Función                  |
| ----------- | ------------------------ |
| Grafana     | dashboards               |
| Prometheus  | métricas                 |
| InfluxDB    | series temporales        |
| Graphite    | almacenamiento histórico |

---

# Docker Compose

Servicios principales:

| Servicio   | Función        |
| ---------- | -------------- |
| controller | Ryu Controller |
| mininet    | emulación SDN  |
| grafana    | dashboards     |
| prometheus | monitoreo      |
| influxdb   | almacenamiento |
| graphite   | métricas       |

---

# Flujo Completo de Mitigación

```text
1. Cliente envía tráfico
2. Switch genera PacketIn
3. Controller analiza paquete
4. FSM clasifica comportamiento
5. Se identifica ataque
6. Mitigator instala DROP rules
7. Switches bloquean atacante
8. Timeout elimina bloqueo
9. Sistema vuelve a observar
```

---

# Herramientas de Ataque Utilizadas

## SYN Flood

```bash
hping3 -S --flood -p 80 TARGET
```

---

## HTTP Flood

```bash
ab -n 2000 -c 10 -k http://TARGET/
```

---

## Port Scan

```bash
nmap -sS -p 1-100 TARGET
```

---

# Ventajas de la Arquitectura

## Reducción de Falsos Positivos

La correlación SYN/HTTP evita bloquear:

* clientes legítimos
* HTTP Flood válidos
* tráfico keep-alive

---

## Escalabilidad

La solución funciona sobre:

* múltiples switches
* múltiples hosts
* múltiples ataques simultáneos

---

## Mitigación Distribuida

Las reglas DROP se instalan en:

```text
todos los switches SDN
```

evitando propagación del ataque.

---

# Limitaciones

## PacketIn Saturation

Si demasiados paquetes llegan al controller:

```text
PacketIn flood
```

el controller puede saturarse.

Por eso existe:

```python
PACKETIN_WARN_RATE
```

---

## DPI Básico

La inspección HTTP actual:

* solo analiza métodos HTTP
* no inspecciona contenido avanzado
* no soporta HTTPS cifrado profundo

---

# Posibles Mejoras Futuras

## Machine Learning

Integrar:

```text
Random Forest
XGBoost
LSTM
Autoencoders
```

para clasificación inteligente.

---

## Adaptive Thresholds

Thresholds dinámicos basados en:

* baseline histórico
* comportamiento temporal
* carga de red

---

## Deep Packet Inspection

Inspección avanzada:

* User-Agent
* headers
* payload analysis
* TLS fingerprinting

---

# Conclusión

La solución implementa un sistema completo de:

* detección
* clasificación
* mitigación
* observabilidad

para ataques DDoS en entornos SDN.

La principal innovación es:

## Correlación SYN/HTTP mediante Máquina de Estados

lo que permite distinguir correctamente entre:

* SYN Flood reales
* HTTP Flood
* tráfico legítimo

reduciendo significativamente los falsos positivos y mejorando la estabilidad del controlador SDN.
