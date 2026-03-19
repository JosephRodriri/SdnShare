# SDN Monitor — Sistema de Monitoreo Persistente para Redes SDN

Sistema de monitoreo en tiempo real para redes SDN con topología Spine-Leaf, construido sobre Spring Boot, PostgreSQL y WebSocket. Complementa la infraestructura de observabilidad existente (Grafana, Prometheus, InfluxDB, Graphite) con detección de anomalías DDoS, persistencia de eventos e historial de incidentes.

---

## Tabla de Contenidos

- [Arquitectura](#arquitectura)
- [Stack Tecnológico](#stack-tecnológico)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Requisitos Previos](#requisitos-previos)
- [Configuración y Arranque](#configuración-y-arranque)
- [API REST](#api-rest)
- [WebSocket](#websocket)
- [Base de Datos](#base-de-datos)
- [Detección de Anomalías](#detección-de-anomalías)
- [Variables de Entorno](#variables-de-entorno)

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                    INFRAESTRUCTURA SDN                          │
│   Mininet (OVS) ──► Controlador Ryu :8080                       │
│   s11, s12 (spine) / s21, s22, s23 (leaf) / h1..h6 (hosts)     │
└─────────────────────────┬───────────────────────────────────────┘
                          │ OpenFlow + métricas
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   InfluxDB :8086   Prometheus :9090  Graphite :9000
          │               │
          └───────┬────────┘
                  │ polling cada 10-15s
                  ▼
         Spring Boot :8090
         PostgreSQL  :5432
                  │
        ┌─────────┼─────────┐
        ▼         ▼         ▼
    REST API   WebSocket  Grafana :3000
    /api/*    ws://.../
              ws/sdn
                  │
                  ▼
           React Frontend
```

El backend Spring Boot actúa como capa de inteligencia: consulta las bases de datos de métricas, detecta anomalías DDoS y notifica al frontend en tiempo real vía WebSocket. PostgreSQL persiste eventos, alertas e historial de incidentes que los time-series databases no gestionan.

---

## Stack Tecnológico

| Capa | Tecnología |
|---|---|
| Backend | Spring Boot 3.3 · Java 17 |
| Base de datos | PostgreSQL 16 |
| Métricas SDN | InfluxDB 1.8 · Prometheus · Graphite |
| Comunicación real-time | WebSocket (Spring) |
| HTTP Client | WebFlux WebClient |
| Visualización | Grafana 10.4 |
| Infraestructura | Docker Compose · Mininet · Ryu · Open vSwitch |

---



---

## Requisitos Previos

- Java 17+
- Maven 3.8+
- Docker y Docker Compose
- PostgreSQL 16 (local o remoto)
- IntelliJ IDEA (recomendado)

---

## Configuración y Arranque

### 1. Levantar infraestructura SDN

```bash
# Clonar el repositorio
git clone https://github.com/JosephRodriri/SDN_Topologia.git
cd SdnShare

# Levantar todos los servicios SDN + monitoreo
docker compose --profile monitor up -d

# Verificar contenedores
docker ps
```

### 2. Crear la topología en Mininet

```bash
docker compose exec -it mininet \
  ./infra/topology/mn_spineleaf_topo.py infra/configs/network_config.yaml
```

```
mininet> pingall
mininet> py exec(open('scripts/traffic_gen.py').read())
```

### 3. Configurar variables de entorno en IntelliJ

En **Run → Edit Configurations → Environment Variables**:

```
URL_DB=jdbc:postgresql://<HOST>:5432/sdn_monitor
USER_NAME=sdn_user
PASSWORD_DB=sdn_pass
```

### 4. Arrancar Spring Boot

```bash
cd application/backend
./mvnw spring-boot:run
```

Al arrancar, el sistema automáticamente:
- Lee `infra/configs/network_config.yaml` y registra switches y hosts en PostgreSQL
- Inicia polling a InfluxDB cada 10 segundos
- Inicia polling a Prometheus cada 15 segundos
- Activa la detección de anomalías DDoS cada 5 segundos

**Logs esperados al arrancar:**
```
>>> [Topology] Cargando topología desde: infra/configs/network_config.yaml
>>> [Topology] Registrando switch: s11 (spine)
>>> [Topology] Registrando switch: s21 (leaf)
...
>>> [Topology] Topología cargada correctamente
=== MetricsCollectorService iniciado ===
=== InfluxDB  : http://localhost:8086
=== Prometheus: http://localhost:9090
>>> [InfluxDB] Polling...
>>> [DB] Métrica guardada → switch=21 port=3 rx=... tx=...
```

---

## API REST

Base URL: `http://localhost:8090`

### Topología

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/topology/switches` | Todos los switches |
| GET | `/api/topology/switches/active` | Switches activos |
| GET | `/api/topology/switches/{id}` | Switch por ID |
| GET | `/api/topology/hosts` | Todos los hosts |
| GET | `/api/topology/hosts/{name}` | Host por nombre |
| POST | `/api/topology/switches/{id}/status` | Actualizar estado |

### Métricas

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/metrics/ports/{switchId}` | Métricas recientes de un switch |
| GET | `/api/metrics/ports/{switchId}?minutes=60` | Con ventana de tiempo |
| GET | `/api/metrics/ports/{switchId}/{portId}/latest` | Último valor |
| POST | `/api/metrics/ingest` | Ingestar métrica desde Ryu |

### Anomalías

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/anomalies` | Todas las anomalías |
| GET | `/api/anomalies?unresolvedOnly=true` | Solo activas |
| GET | `/api/anomalies?severity=CRITICAL` | Por severidad |
| GET | `/api/anomalies/switch/{switchId}` | Por switch |
| GET | `/api/anomalies/host/{hostName}` | Por host (h1..h6) |
| GET | `/api/anomalies/stats` | Estadísticas 24h |
| PATCH | `/api/anomalies/{id}/resolve` | Resolver anomalía |

**Body para resolver anomalía:**
```json
{
  "resolvedBy": "admin",
  "note": "Ataque contenido, tráfico normalizado"
}
```

### Reglas de Alerta

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/alert-rules` | Todas las reglas |
| POST | `/api/alert-rules` | Crear regla |
| PUT | `/api/alert-rules/{id}` | Actualizar regla |
| PATCH | `/api/alert-rules/{id}/toggle` | Activar/desactivar |
| DELETE | `/api/alert-rules/{id}` | Eliminar |

**Body para crear regla:**
```json
{
  "name": "DDoS crítico",
  "metricType": "rx_pps",
  "operator": ">",
  "threshold": 1000,
  "durationSec": 30,
  "severity": "CRITICAL",
  "appliesTo": "ALL"
}
```

### Health Check

```
GET /actuator/health
```

---

## WebSocket

Conectar en: `ws://localhost:8090/ws/sdn`

El servidor emite tres tipos de mensajes en tiempo real:

```json
{ "type": "ANOMALY",        "payload": { ... }, "timestamp": 1234567890 }
{ "type": "PORT_METRIC",    "payload": { ... }, "timestamp": 1234567890 }
{ "type": "TOPOLOGY_CHANGE","payload": { ... }, "timestamp": 1234567890 }
```

**Probar desde consola del navegador:**
```javascript
const ws = new WebSocket('ws://localhost:8090/ws/sdn');
ws.onmessage = (e) => console.log('Mensaje:', JSON.parse(e.data));
```

---

## Base de Datos

### Schema

| Tabla | Descripción |
|---|---|
| `switches` | Inventario de switches SDN (spine y leaf) |
| `hosts` | Servidores conectados a los switches leaf |
| `port_metrics` | Serie temporal de métricas por puerto |
| `flow_metrics` | Estadísticas de flujos OpenFlow |
| `anomalies` | Registro de anomalías con ciclo de vida completo |
| `alert_rules` | Reglas configurables de detección |
| `events` | Log de auditoría central |

### Vistas útiles

```sql
-- Topología activa con hosts conectados
SELECT * FROM v_topology_summary;

-- Anomalías sin resolver con tiempo transcurrido
SELECT * FROM v_active_anomalies;

-- Últimas métricas por switch y puerto
SELECT * FROM v_latest_port_traffic;
```

### Consultas frecuentes

```sql
-- Métricas recientes por switch
SELECT switch_id, COUNT(*) as registros, MAX(timestamp) as ultima
FROM port_metrics
GROUP BY switch_id ORDER BY switch_id;

-- Anomalías activas críticas
SELECT * FROM anomalies
WHERE resolved_at IS NULL AND severity = 'CRITICAL'
ORDER BY detected_at DESC;
```

---

## Detección de Anomalías

El sistema calcula paquetes por segundo (pps) comparando métricas consecutivas y clasifica el tráfico según umbrales configurables:

| pps | Severidad | Tipo |
|---|---|---|
| ≥ 1000 | CRITICAL | DDOS |
| ≥ 500 | HIGH | HIGH_TRAFFIC |
| < 500 | Normal | — |

Cuando se detecta una anomalía el sistema:
1. Persiste el evento en PostgreSQL con switch, puerto, host afectado, rx/tx pps y timestamp
2. Emite alerta vía WebSocket a todos los clientes conectados
3. El operador puede resolverla desde la API con nota de resolución

**Simular un ataque DDoS:**
```bash
# Dentro de Mininet
mininet> h1 ping -f h2 &

# Monitor en tiempo real
bash infra/attacks/ddos_monitor.sh
```

---

## Variables de Entorno

| Variable | Default | Descripción |
|---|---|---|
| `URL_DB` | — | URL de conexión PostgreSQL |
| `USER_NAME` | — | Usuario PostgreSQL |
| `PASSWORD_DB` | — | Contraseña PostgreSQL |
| `SDN_INFLUXDB_HOST` | `http://localhost:8086` | URL InfluxDB |
| `SDN_PROMETHEUS_HOST` | `http://localhost:9090` | URL Prometheus |
| `SDN_RYU_HOST` | `http://localhost:8080` | URL Ryu/FlowManager |
| `GRAPHITE_POLLTIME` | `30` | Intervalo Graphite (seg) |
| `INFLUXDB_POLLTIME` | `30` | Intervalo InfluxDB (seg) |
| `PROMETHEUS_POLLTIME` | `30` | Intervalo Prometheus (seg) |

---

## Servicios y Puertos

| Servicio | URL | Credenciales |
|---|---|---|
| Spring Boot API | http://localhost:8090 | — |
| WebSocket | ws://localhost:8090/ws/sdn | — |
| FlowManager | http://localhost:8080/home | — |
| Grafana | http://localhost:3000 | admin / admin |
| Prometheus | http://localhost:9090 | — |
| InfluxDB | http://localhost:8086 | root / root |
| Graphite | http://localhost:9000 | — |

---

## Detener los Servicios

```bash
# Detener todos los contenedores
docker compose --profile monitor down

# Detener y eliminar volúmenes
docker compose --profile monitor down -v
```