# Thresholds y Parámetros de Detección — Contramedidas DDoS SDN

## Ubicación sugerida

`docs/mitigator/thresholds.md`

---

# Thresholds y Configuración de Contramedidas DDoS

## Objetivo

Este documento describe los thresholds, ventanas temporales y parámetros utilizados por el módulo `ddos_mitigator.py` para detectar y mitigar ataques DDoS en la arquitectura SDN Spine-Leaf.

El sistema implementa detección para:

* SYN Flood
* HTTP Flood
* UDP/ICMP Volumetric Flood
* Port Scan

Además, incorpora una máquina de estados con correlación SYN/HTTP para evitar falsos positivos entre tráfico HTTP legítimo y ataques SYN flood.

---

# Arquitectura General de Detección

El mitigador trabaja sobre:

* OpenFlow 1.3
* Ryu Controller
* PacketIn inspection
* FlowStats polling
* Sliding Windows
* Máquina de estados por IP

La lógica principal es:

```text
PacketIn -> Clasificación -> Detección -> Mitigación -> Expiración automática
```

---

# Máquina de Estados

Cada IP origen observada atraviesa distintos estados antes de ser bloqueada.

```text
OBSERVING
    |
    | SYN rate > threshold
    v
SYN_CANDIDATE
    |
    | HTTP detectado
    v
HTTP_CANDIDATE
    |
    | HTTP rate > threshold
    v
BLOCKED
```

---

# Configuración General

## Variables de Entorno

Las contramedidas son configuradas mediante variables de entorno definidas en `docker-compose.yaml`.

Ejemplo:

```yaml
environment:
  - DDOS_THRESH_PPS=1000
  - DDOS_INTERVAL=2
  - DDOS_BLOCK_TIMEOUT=120
  - PORT_SCAN_THRESHOLD=20
  - PORT_SCAN_WINDOW=5
  - HTTP_FLOOD_THRESHOLD=10
  - HTTP_PORTS=80,443
```

---

# 1. Detección de Volumetric Flood (UDP/ICMP)

## Objetivo

Detectar ataques volumétricos de alto tráfico UDP o ICMP utilizando estadísticas OpenFlow (`FlowStats`).

---

## Parámetros

| Variable             | Valor  | Descripción                    |
| -------------------- | ------ | ------------------------------ |
| `DDOS_THRESH_PPS`    | `1000`  | Umbral de paquetes por segundo |
| `DDOS_INTERVAL`      | `2s`   | Intervalo de polling FlowStats |
| `DDOS_BLOCK_TIMEOUT` | `120s` | Tiempo de bloqueo              |

---

## Funcionamiento

Cada `DDOS_INTERVAL` segundos:

1. El controlador solicita estadísticas FlowStats.
2. Calcula el delta de paquetes.
3. Convierte el delta a paquetes por segundo.
4. Si el PPS supera el threshold:

   * se instala una regla DROP en todos los switches.

---

## Fórmula

La tasa PPS se calcula como:

PPS = \frac{\Delta paquetes}{\Delta tiempo}

---

## Justificación del Threshold

El valor `1000 PPS` fue seleccionado porque:

* tráfico normal del laboratorio:

  * ~10–200 PPS
* flood UDP/ICMP:

  * hping3 --flood en Mininet Docker: ~200-3000 PPS por proceso
  * 4 procesos: ~800-12000 PPS
* minimiza falsos positivos

---

# 2. Detección de SYN Flood

## Problema Detectado en v7

En la versión anterior:

```text
ab -c 200 -n 5000
```

generaba muchos SYN legítimos y era clasificado incorrectamente como SYN flood.

El problema era:

```text
SYN llegan primero
HTTP llega milisegundos después
```

La IP era bloqueada antes de observar el tráfico HTTP.

---

# Solución v8 — Correlación SYN/HTTP

La nueva versión introduce:

* período de gracia
* correlación SYN/HTTP
* máquina de estados
* ratio HTTP/SYN

---

## Parámetros SYN Flood

| Variable              | Valor   | Descripción           |
| --------------------- | ------- | --------------------- |
| `SYN_FLOOD_THRESHOLD` | `100`   | SYN por ventana       |
| `SYN_FLOOD_WINDOW`    | `1.0s`  | Ventana sliding       |
| `SYN_GRACE_MS`        | `100ms` | Tiempo de gracia      |
| `SYN_HTTP_RATIO_MIN`  | `0.2`   | Ratio mínimo HTTP/SYN |

---

## Funcionamiento

Cuando una IP supera:

SYN_{count} > 100

NO se bloquea inmediatamente.

La IP entra en:

```text
SYN_CANDIDATE
```

y se espera:

```text
100 ms
```

para observar si aparecen requests HTTP.

---

## Clasificación Final

### Caso 1 — SYN Flood Real

Muchos SYN y poco HTTP:

\frac{HTTP}{SYN} < 0.2

Resultado:

```text
BLOCKED(SYN_FLOOD)
```

---

### Caso 2 — HTTP Flood

Muchos SYN pero también tráfico HTTP:

\frac{HTTP}{SYN} \geq 0.2

Resultado:

```text
HTTP_CANDIDATE
```

---

## Justificación del Threshold

### HTTP Flood legítimo

Herramientas como:

```bash
ab -c 50
wrk -c 10
```

pueden generar:

```text
50–200 SYN/s
```

sin ser un ataque SYN real.

---

### SYN Flood Real

Herramientas como:

```bash
hping3 -S --flood
```

pueden generar:

```text
10.000+ SYN/s
```

sin completar handshake TCP.

---

# 3. Detección de HTTP Flood

## Objetivo

Detectar ataques HTTP GET/POST masivos hacia servicios web.

---

## Parámetros

| Variable               | Valor      |
| ---------------------- | ---------- |
| `HTTP_FLOOD_THRESHOLD` | `10 req/s` |
| `HTTP_FLOOD_WINDOW`    | `1s`       |
| `HTTP_PORTS`           | `80,443`   |

---

## Funcionamiento

El controlador inspecciona:

* paquetes TCP con flag PSH
* payload HTTP
* métodos válidos:

  * GET
  * POST
  * PUT
  * DELETE
  * OPTIONS
  * etc.

---

## Detección

Si:

HTTP_{requests} \geq 10

entonces:

```text
BLOCKED(HTTP_FLOOD)
```

---

## Justificación

En laboratorio:

* navegación normal:

  * 1–5 req/s
* ApacheBench:

  * 50–500 req/s
* wrk:

  * cientos o miles req/s

El threshold de `10 req/s` permite detectar fácilmente floods controlados.

---

# 4. Detección de Port Scan / Subnet Scan

## Objetivo

Detectar exploración masiva de puertos TCP y escaneo de subredes.

---

## Parámetros

| Variable              | Valor                      |
| --------------------- | -------------------------- |
| `PORT_SCAN_THRESHOLD` | `20 puertos o dst_ips`     |
| `PORT_SCAN_WINDOW`    | `5s`                       |

---

## Funcionamiento

El detector opera con **dos vectores** (cualquiera activa el bloqueo):

### Vector 1: Subnet Scan

Para cada IP origen, se almacenan las IPs destino únicas contactadas:

Si:

DstIPs_{unicas} \geq 20

entonces:

```text
BLOCKED(PORT_SCAN)
```

Ejemplo:

```bash
nmap -sS -p 80 10.1.1.0/24
```

Contacta 254 IPs en la misma ventana → supera threshold.

### Vector 2: Port Scan Clásico

Para cada IP origen, se almacenan los puertos destino únicos contactados:

Si:

Puertos_{unicos} \geq 20

entonces:

```text
BLOCKED(PORT_SCAN)
```

Ejemplo:

```bash
nmap -sS -p 1-100 10.1.1.4
```

Contacta 100 puertos únicos → supera threshold.

---

## Justificación

* Subnet scan: escaneos como `nmap -sS 10.1.1.0/24` contactan 254 IPs en segundos.
* Port scan clásico: `nmap -sS -p 1-100` contacta 100 puertos en un host.
* El tráfico normal (iperf, web browsing) contacta 1-5 IPs/puertos distintos.
* SYN flood a un puerto: solo 1 IP destino y 1 puerto → nunca activa el detector.

---

# 5. Timeouts y Limpieza

## Parámetros

| Variable               | Valor  |
| ---------------------- | ------ |
| `BLOCK_IDLE_TIMEOUT`   | `120s` |
| `SYN_CLEANUP_TIMEOUT`  | `15s`  |
| `HTTP_CLEANUP_TIMEOUT` | `15s`  |
| `PS_CLEANUP_TIMEOUT`   | `15s`  |

---

## Objetivo

Evitar:

* consumo excesivo de memoria
* contextos obsoletos
* IPs bloqueadas permanentemente

---

# 6. Prioridades OpenFlow

| Tipo            | Prioridad |
| --------------- | --------- |
| DROP Rules      | `1000`    |
| Intercept Rules | `500`     |
| Table Miss      | `0`       |

---

# 7. Herramientas de Prueba

## SYN Flood

```bash
hping3 -S --flood -p 80 TARGET
```

---

## HTTP Flood

```bash
ab -n 2000 -c 10 -k http://TARGET/
```

o:

```bash
wrk -t4 -c10 -d10s http://TARGET/
```

---

## Port Scan (clásico)

```bash
nmap -sS -p 1-100 TARGET
```

---

## Subnet Scan

```bash
nmap -sS -p 80 10.1.1.0/24
```

---

## UDP Flood

```bash
hping3 --udp --flood TARGET
```

---

# Recomendaciones para Laboratorio

## Entorno Académico

Valores actuales están optimizados para:

* Mininet
* tráfico controlado
* pruebas reproducibles
* baja latencia virtual

---

## Producción Real

En entornos reales se recomienda:

* thresholds dinámicos
* machine learning
* adaptive baselines
* rate limiting distribuido
* detección multi-switch

---
