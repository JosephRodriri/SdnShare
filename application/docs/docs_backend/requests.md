
## 1. Curl (terminal)

```bash
# GET - todos los switches
curl http://localhost:8090/api/topology/switches

# GET - anomalías activas
curl http://localhost:8090/api/anomalies?unresolvedOnly=true

# GET - métricas del switch 21 últimos 30 minutos
curl "http://localhost:8090/api/metrics/ports/21?minutes=30"

# POST - ingestar métrica manualmente
curl -X POST http://localhost:8090/api/metrics/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "switchId": "21",
    "portId": 3,
    "rxBytes": 1234567,
    "txBytes": 987654,
    "rxPackets": 1500,
    "txPackets": 1200,
    "txErrors": 0,
    "rxErrors": 0,
    "txDropped": 0,
    "rxDropped": 0,
    "durationSec": 60
  }'

# PATCH - resolver anomalía
curl -X PATCH http://localhost:8090/api/anomalies/1/resolve \
  -H "Content-Type: application/json" \
  -d '{"resolvedBy": "admin", "note": "Ataque contenido"}'
```

---

## 2. Postman / Insomnia

Importa esta colección directamente en Postman:

```json
{
  "info": { "name": "SDN Monitor API" },
  "variable": [{ "key": "base", "value": "http://localhost:8090" }],
  "item": [
    {
      "name": "Topología",
      "item": [
        { "name": "Get Switches",       "request": { "method": "GET",   "url": "{{base}}/api/topology/switches" }},
        { "name": "Get Hosts",          "request": { "method": "GET",   "url": "{{base}}/api/topology/hosts" }},
        { "name": "Get Switch by ID",   "request": { "method": "GET",   "url": "{{base}}/api/topology/switches/21" }}
      ]
    },
    {
      "name": "Métricas",
      "item": [
        { "name": "Get Port Metrics",   "request": { "method": "GET",   "url": "{{base}}/api/metrics/ports/21?minutes=30" }},
        { "name": "Ingest Metric",      "request": { "method": "POST",  "url": "{{base}}/api/metrics/ingest",
          "body": { "mode": "raw", "raw": "{\"switchId\":\"21\",\"portId\":3,\"rxBytes\":1234,\"txBytes\":5678,\"rxPackets\":10,\"txPackets\":8,\"txErrors\":0,\"rxErrors\":0,\"txDropped\":0,\"rxDropped\":0,\"durationSec\":60}" }}}
      ]
    },
    {
      "name": "Anomalías",
      "item": [
        { "name": "Get All Anomalies",      "request": { "method": "GET",   "url": "{{base}}/api/anomalies" }},
        { "name": "Get Unresolved",         "request": { "method": "GET",   "url": "{{base}}/api/anomalies?unresolvedOnly=true" }},
        { "name": "Get Stats",              "request": { "method": "GET",   "url": "{{base}}/api/anomalies/stats" }},
        { "name": "Resolve Anomaly",        "request": { "method": "PATCH", "url": "{{base}}/api/anomalies/1/resolve",
          "body": { "mode": "raw", "raw": "{\"resolvedBy\":\"admin\",\"note\":\"Resuelto\"}" }}}
      ]
    },
    {
      "name": "Alert Rules",
      "item": [
        { "name": "Get Rules",    "request": { "method": "GET",    "url": "{{base}}/api/alert-rules" }},
        { "name": "Create Rule",  "request": { "method": "POST",   "url": "{{base}}/api/alert-rules",
          "body": { "mode": "raw", "raw": "{\"name\":\"Test Rule\",\"metricType\":\"rx_pps\",\"operator\":\">\",\"threshold\":800,\"durationSec\":60,\"severity\":\"HIGH\",\"appliesTo\":\"ALL\"}" }}},
        { "name": "Toggle Rule",  "request": { "method": "PATCH",  "url": "{{base}}/api/alert-rules/1/toggle" }}
      ]
    }
  ]
}
```

---

## 3. Swagger UI (recomendado para desarrollo)

Agrega esta dependencia al `pom.xml`:

```xml
<dependency>
    <groupId>org.springdoc</groupId>
    <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
    <version>2.3.0</version>
</dependency>
```

Y en `application.properties`:

```properties
springdoc.api-docs.path=/api-docs
springdoc.swagger-ui.path=/swagger-ui.html
springdoc.swagger-ui.enabled=true
```

Luego abre en el navegador:
```
http://localhost:8090/swagger-ui.html
```

Verás todos los endpoints documentados e interactivos, sin necesidad de Postman ni curl.

---

## 4. WebSocket (probar alertas en tiempo real)

Desde el navegador abre la consola y pega:

```javascript
// Conectar al WebSocket
const ws = new WebSocket('ws://localhost:8090/ws/sdn');

ws.onopen    = () => console.log('✅ Conectado');
ws.onmessage = (e) => console.log('📨 Mensaje:', JSON.parse(e.data));
ws.onerror   = (e) => console.error('❌ Error:', e);
ws.onclose   = () => console.log('🔌 Desconectado');
```

Cuando el backend detecte una anomalía verás en consola:
```json
{
  "type": "ANOMALY",
  "payload": {
    "severity": "CRITICAL",
    "hostName": "h1",
    "rxPps": 4990,
    "switchId": "21"
  },
  "timestamp": 1709123456789
}
```

---

