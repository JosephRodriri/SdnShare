# Cómo Funciona el Sistema de Monitoreo SDN

## Visión General

El sistema está compuesto por dos grandes bloques que trabajan juntos: la **infraestructura SDN existente** (Mininet + Ryu + bases de datos de métricas) y el **backend persistente nuevo** (Spring Boot + PostgreSQL + WebSocket). Grafana sigue operando de forma independiente para visualización de series temporales.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CAPA DE DATOS SDN                            │
│                                                                     │
│   Mininet (switches OVS)  ──►  Controlador Ryu  ──►  FlowManager   │
│        s11, s12 (spine)          :8080                  :8080/home  │
│        s21, s22, s23 (leaf)         │                               │
│        h1 … h6 (hosts)             │                               │
└─────────────────────────────────────┼───────────────────────────────┘
                                      │ OpenFlow + REST
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                  ▼
             InfluxDB :8086    Prometheus :9090    Graphite :9000
             port_stats         ryu_byte_count      ryu.monitor.*
             flow_stats         ryu_flow_count
                    │                 │
                    └────────┬────────┘
                             │ polling cada 10-15s
                             ▼
                    Spring Boot :8090
                    PostgreSQL  :5432
                             │
                    ┌────────┼────────┐
                    ▼        ▼        ▼
                REST API  WebSocket  Grafana
                /api/*   ws://.../   :3000
                         ws/sdn
                             │
                             ▼
                      React Frontend
```

---

## 1. Capa SDN — Cómo se genera el tráfico

### 1.1 Topología Spine-Leaf

Mininet crea la red emulada con Open vSwitch (OVS) al ejecutar:

```bash
docker compose exec -it mininet ./scripts/mn_spineleaf_topo.py scripts/network_config.yaml
```

Esto levanta la siguiente topología:

```
        s11 (spine)    s12 (spine)
       / | \            / | \
      /  |  \          /  |  \
   s21  s22  s23    s21  s22  s23   (leaf)
   /\    /\    /\
 h1 h2 h3 h4 h5 h6                 (hosts)
```

Cada host tiene una IP (`10.1.1.1`–`10.1.1.6`) y una MAC conocida (`00:00:00:00:00:01`–`06`). Los switches leaf conectan hosts en los puertos 3 y 4, y se interconectan con los spines en los puertos 1 y 2.

### 1.2 El Controlador Ryu

Ryu es el cerebro de la red. Cuando un paquete llega a un switch sin una regla de flujo, el switch lo envía al controlador. Ryu responde con instrucciones OpenFlow (flow entries) que le dicen al switch cómo reenviar ese paquete en el futuro.

Además de controlar el reenvío, Ryu ejecuta las aplicaciones de monitoreo:

```bash
# Aplicaciones cargadas en el controlador
scripts/dc_switch_3.py          # lógica de reenvío spine-leaf
scripts/monitor_influxdb.py     # envía stats a InfluxDB
scripts/monitor_graphite.py     # envía stats a Graphite
scripts/monitor_prometheus.py   # expone métricas en /metrics
```

### 1.3 Recolección de Métricas desde Ryu

Cada aplicación de monitoreo hace polling periódico a los switches OpenFlow solicitando estadísticas:

```
Ryu ──► OFPFlowStatsRequest  ──► switch
Ryu ◄── OFPFlowStatsReply    ◄── switch  (packets, bytes por flujo)

Ryu ──► OFPPortStatsRequest  ──► switch
Ryu ◄── OFPPortStatsReply    ◄── switch  (rx/tx bytes, packets, errors)
```

Con esos datos, cada monitor escribe en su base de datos correspondiente.

---

## 2. Bases de Datos de Series Temporales

### InfluxDB (`:8086`)

Almacena dos mediciones:

| Measurement | Tags | Fields |
|---|---|---|
| `port_stats` | `datapath`, `port_no` | `rx_bytes`, `tx_bytes`, `rx_packets`, `tx_packets`, `tx_errors`, `rx_errors` |
| `flow_stats` | `datapath`, `table_id`, `eth_dst`, `dest` | `packets`, `bytes` |

Consulta de ejemplo:
```sql
SELECT non_negative_derivative(mean("tx_bytes"), 1s) * 8
FROM "port_stats"
WHERE "datapath" = '11'
GROUP BY time(1m)
```

### Prometheus (`:9090`)

Expone métricas en formato pull desde el endpoint `/metrics` del controlador. Prometheus hace scraping cada 15 segundos:

```
ryu_byte_count{eth_dst="00:00:00:00:00:01"} 1234567
ryu_flow_count{datapath_id="21", table_id="0"} 8
```

### Graphite (`:9000`)

Recibe métricas en formato `clave.valor timestamp` por el protocolo Carbon (TCP 2003):

```
ryu.monitor.11.port.1.tx_bytes  1234567  1709123456
ryu.monitor.21.flow.0.00:00:00:00:00:01.bytes  98765  1709123456
```

---

## 3. Spring Boot — Backend Persistente (`:8090`)

El backend nuevo añade lo que las bases de datos de series temporales no ofrecen: **persistencia de eventos, lógica de detección de amenazas y comunicación en tiempo real**.

### 3.1 Dos formas de recibir datos

**Modo A — Polling activo (scheduled)**

Spring Boot consulta InfluxDB y Prometheus periódicamente de forma autónoma:

```
MetricsCollectorService
  ├── @Scheduled cada 10s → consulta InfluxDB → guarda en PostgreSQL
  └── @Scheduled cada 15s → consulta Prometheus → guarda en PostgreSQL
```

**Modo B — Push desde Ryu (REST)**

El controlador Ryu puede enviar métricas directamente al backend con un POST:

```
POST /api/metrics/ingest
{
  "switchId": "21",
  "portId": 3,
  "rxBytes": 1234567,
  "txBytes": 987654,
  "rxPackets": 1500,
  "txPackets": 1200,
  ...
}
```

### 3.2 Detección de Anomalías DDoS

El servicio `AnomalyDetectionService` corre cada 5 segundos y analiza las métricas recientes calculando **paquetes por segundo (pps)**:

```
pps = (packets_ahora - packets_antes) / segundos_transcurridos
```

Clasificación por umbrales:

| pps | Severidad | Tipo |
|---|---|---|
| ≥ 1000 | CRITICAL | DDOS |
| ≥ 500 | HIGH | HIGH_TRAFFIC |
| < 500 | Normal | — |

Cuando se detecta una anomalía:
1. Se persiste en la tabla `anomalies` de PostgreSQL con timestamp, switch, puerto, host afectado y valores de rx/tx pps.
2. Se envía un mensaje WebSocket a todos los clientes React conectados.
3. Queda registrada hasta que un operador la resuelva manualmente (`PATCH /api/anomalies/{id}/resolve`).

El mapeo de switch+puerto a host está hardcodeado según `network_config.yaml`:

```
s21 puerto 3 → h1    s22 puerto 3 → h3    s23 puerto 3 → h5
s21 puerto 4 → h2    s22 puerto 4 → h4    s23 puerto 4 → h6
```

### 3.3 API REST

Todos los endpoints están bajo `/api/`:

```
GET  /api/topology/switches          → lista de switches con tipo y estado
GET  /api/topology/hosts             → lista de hosts con IP y MAC
GET  /api/metrics/ports/{switchId}   → métricas recientes de un switch
POST /api/metrics/ingest             → ingestar desde Ryu
GET  /api/anomalies?unresolvedOnly=true → anomalías activas
GET  /api/anomalies/stats            → resumen 24h por tipo
PATCH /api/anomalies/{id}/resolve    → marcar como resuelta
GET  /api/alert-rules                → reglas de alerta configuradas
POST /api/alert-rules                → crear nueva regla
PATCH /api/alert-rules/{id}/toggle  → activar/desactivar regla
```

### 3.4 WebSocket en Tiempo Real

El frontend React se conecta a `ws://localhost:8090/ws/sdn` y recibe tres tipos de mensajes:

```json
{ "type": "ANOMALY",        "payload": { "severity": "CRITICAL", "hostName": "h1", ... } }
{ "type": "PORT_METRIC",    "payload": { "switchId": "21", "portId": 3, "rxBytes": ... } }
{ "type": "TOPOLOGY_CHANGE","payload": { "switchId": "11", "isActive": false } }
```

---

## 4. PostgreSQL — Qué persiste y por qué

PostgreSQL almacena lo que los time-series databases no gestionan bien:

| Tabla | Qué guarda | Para qué sirve |
|---|---|---|
| `switches` | Inventario de switches con tipo y estado | Visualizar topología en el frontend |
| `hosts` | IP, MAC y conexión de cada host | Asociar anomalías a hosts concretos |
| `port_metrics` | Copia de métricas por switch/puerto | Consultas históricas con filtros complejos |
| `flow_metrics` | Estadísticas de flujos OpenFlow | Análisis de tráfico por destino |
| `anomalies` | Eventos detectados con contexto completo | Historial de incidentes, auditoría |
| `alert_rules` | Umbrales configurables por operador | Ajustar sensibilidad sin recompilar |
| `events` | Log general de eventos del sistema | Trazabilidad de cambios y acciones |

---

## 5. Grafana — Visualización de Series Temporales (`:3000`)

Grafana sigue activo y conectado directamente a las tres bases de datos. No pasa por Spring Boot. Sus dashboards muestran:

| Panel | Fuente | Qué muestra |
|---|---|---|
| Host Inbound Traffic | Prometheus | tráfico por host (H1–H6) en bps |
| Spine 11 Port Utilization | Graphite | Tx/Rx por puerto del spine s11 |
| Spine 12 Port Utilization | InfluxDB | Tx/Rx por puerto del spine s12 |
| Flow Count | Prometheus | número de flujos activos por switch |
| Controller Inbound Traffic | InfluxDB | tráfico enviado al controlador por switch |

---

## 6. Flujo Completo — Desde un Ataque Hasta la Alerta

```
1. En Mininet se lanza un flood:
   mininet> h1 ping -f h2

2. Los paquetes llegan al switch s21 en el puerto 3 (h1)

3. s21 reporta estadísticas de puerto a Ryu vía OpenFlow

4. monitor_influxdb.py escribe en InfluxDB:
   port_stats{datapath="21", port_no="3"} rx_packets=50000

5. Spring Boot hace polling a InfluxDB cada 10s y guarda en PostgreSQL

6. AnomalyDetectionService calcula:
   pps = (50000 - 100) / 10 = 4990 pps → CRITICAL

7. Se crea registro en anomalies:
   { anomalyType: "DDOS", severity: "CRITICAL",
     switchId: "21", portId: 3, hostName: "h1",
     rxPps: 4990, detectedAt: "2026-03-05T14:32:00Z" }

8. WebSocket emite a React:
   { "type": "ANOMALY", "payload": { "severity": "CRITICAL", ... } }

9. El operador ve la alerta en el frontend y resuelve:
   PATCH /api/anomalies/42/resolve
   { "resolvedBy": "admin", "note": "Ataque contenido" }

10. El evento queda en el historial de PostgreSQL para auditoría
```

---

## 7. Cómo Levantar Todo

```bash
# 1. Levantar infraestructura SDN + monitoreo + nuevo backend
docker compose -f docker-compose.yaml \
  -f sdn-monitor/docker/docker-compose.addon.yml \
  --profile monitor up -d

# 2. Crear topología
docker compose exec -it mininet \
  ./scripts/mn_spineleaf_topo.py scripts/network_config.yaml

# 3. Verificar conectividad
mininet> pingall

# 4. Generar tráfico
mininet> py exec(open('scripts/traffic_gen.py').read())
```

### Puertos de acceso

| Servicio | URL | Función |
|---|---|---|
| FlowManager | http://localhost:8080/home | Topología y flujos OpenFlow |
| Spring Boot API | http://localhost:8090/api | REST API del backend |
| WebSocket | ws://localhost:8090/ws/sdn | Alertas en tiempo real |
| Grafana | http://localhost:3000 | Dashboards de métricas |
| Prometheus | http://localhost:9090 | Métricas raw |
| InfluxDB | http://localhost:8086 | Series temporales |
| Graphite | http://localhost:9000 | Métricas históricas |