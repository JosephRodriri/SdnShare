# SDN Monitor — Spring Boot Backend

Backend persistente para monitoreo de red SDN Spine-Leaf.
Complementa Grafana con detección de anomalías, historial y WebSocket.

## Stack
- **Spring Boot 3.2** — API REST + WebSocket
- **PostgreSQL 16** — Persistencia de eventos y métricas
- **WebFlux WebClient** — Polling a InfluxDB y Prometheus

## Estructura del proyecto

```
sdn-monitor/
├── pom.xml
├── docker/
│   ├── schema.sql                   # Schema PostgreSQL
│   └── docker-compose.addon.yml     # Servicios adicionales
└── src/main/java/com/sdn/monitor/
    ├── SdnMonitorApplication.java   # Main + CORS
    ├── config/
    ├── controller/
    │   └── Controllers.java         # TopologyController, MetricsController,
    │                                  AnomalyController, AlertRuleController
    ├── model/entity/
    │   ├── Switch.java
    │   ├── Host.java
    │   ├── PortMetric.java
    │   ├── Anomaly.java
    │   └── AlertRule.java
    ├── repository/
    │   └── Repositories.java
    ├── service/impl/
    │   ├── MetricsCollectorService.java   # Polling InfluxDB + Prometheus
    │   └── AnomalyDetectionService.java  # Detección DDoS
    └── websocket/
        └── SdnWebSocketHandler.java      # Alertas en tiempo real
```

## Endpoints REST

### Topología
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | /api/topology/switches | Todos los switches |
| GET | /api/topology/switches/active | Switches activos |
| GET | /api/topology/hosts | Todos los hosts |
| POST | /api/topology/switches/{id}/status | Actualizar estado (desde Ryu) |

### Métricas
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | /api/metrics/ports/{switchId} | Métricas de un switch |
| GET | /api/metrics/ports/{switchId}/{portId} | Historial con rango de fechas |
| GET | /api/metrics/ports/{switchId}/{portId}/latest | Último valor |
| POST | /api/metrics/ingest | Ingestar desde Ryu directamente |

### Anomalías
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | /api/anomalies?unresolvedOnly=true | Anomalías activas |
| GET | /api/anomalies/stats | Estadísticas 24h |
| GET | /api/anomalies/host/{hostName} | Por host (h1..h6) |
| PATCH | /api/anomalies/{id}/resolve | Resolver anomalía |

### Reglas de alerta
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | /api/alert-rules | Todas las reglas |
| POST | /api/alert-rules | Crear regla |
| PUT | /api/alert-rules/{id} | Actualizar |
| PATCH | /api/alert-rules/{id}/toggle | Activar/desactivar |

## WebSocket

Conectar en: `ws://localhost:8090/ws/sdn`

Mensajes recibidos:
```json
{ "type": "ANOMALY",       "payload": {...}, "timestamp": 1234567890 }
{ "type": "PORT_METRIC",   "payload": {...}, "timestamp": 1234567890 }
{ "type": "TOPOLOGY_CHANGE","payload": {...}, "timestamp": 1234567890 }
```

## Levantar el servicio

```bash
# Con Docker (junto al lab existente)
docker compose -f docker-compose.yaml -f docker/docker-compose.addon.yml \
  --profile monitor up -d

# Local para desarrollo
./mvnw spring-boot:run
```

## Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| SDN_INFLUXDB_HOST | http://localhost:8086 | URL InfluxDB |
| SDN_PROMETHEUS_HOST | http://localhost:9090 | URL Prometheus |
| SDN_RYU_HOST | http://localhost:8080 | URL Ryu/FlowManager |
| SDN_ANOMALY_DDOS_CRITICAL_THRESHOLD | 1000 | pps para alerta CRITICAL |
| SDN_ANOMALY_DDOS_HIGH_THRESHOLD | 500 | pps para alerta HIGH |