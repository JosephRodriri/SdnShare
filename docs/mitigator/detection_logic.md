# Lógica de Detección — Documentación Técnica Profunda

> Análisis exhaustivo de los mecanismos de detección implementados en `ddos_mitigator.py`.
> Nivel: documentación de ingeniería senior / tesis de investigación.

---

## Tabla de Contenidos

1. [Arquitectura de Detección en Dos Capas](#1-arquitectura-de-detección-en-dos-capas)
2. [Sliding Windows — Fundamento Matemático](#2-sliding-windows--fundamento-matemático)
3. [Detección de SYN Flood](#3-detección-de-syn-flood)
4. [Correlación SYN/HTTP — El Problema Central](#4-correlación-synhttp--el-problema-central)
5. [Detección de HTTP Flood](#5-detección-de-http-flood)
6. [Detección de UDP e ICMP Flood (FlowStats)](#6-detección-de-udp-e-icmp-flood-flowstats)
7. [Detección de Port Scan](#7-detección-de-port-scan)
8. [Prevención de Falsos Positivos](#8-prevención-de-falsos-positivos)
9. [IpContext — El Objeto de Estado Centralizado](#9-ipcontext--el-objeto-de-estado-centralizado)
10. [TCP Flags — Análisis Detallado](#10-tcp-flags--análisis-detallado)
11. [Deep Packet Inspection HTTP](#11-deep-packet-inspection-http)
12. [Cálculo de PPS y Tasas](#12-cálculo-de-pps-y-tasas)

---

## 1. Arquitectura de Detección en Dos Capas

El sistema implementa dos mecanismos de detección complementarios que operan de forma paralela y asíncrona:

```
┌───────────────────────────────────────────────────────────────────┐
│                    ARQUITECTURA DE DETECCIÓN                      │
│                                                                   │
│  CAPA 1: FlowStats (polling periódico)                            │
│  ─────────────────────────────────────                            │
│  Cada POLL_INTERVAL segundos:                                     │
│    Switch → OFPFlowStatsReply → Controller                        │
│    Análisis: volumen bruto de paquetes por MAC origen             │
│    Detecta: UDP Flood, ICMP Flood                                 │
│                                                                   │
│  CAPA 2: PacketIn (evento por paquete)                            │
│  ─────────────────────────────────────                            │
│  Por cada SYN o PSH hacia HTTP_PORTS:                             │
│    Switch → PacketIn → Controller                                 │
│    Análisis: flags TCP, puertos destino, payload HTTP             │
│    Detecta: SYN Flood, Port Scan, HTTP Flood                      │
│                                                                   │
│  CAPA DE CORRELACIÓN (FSM)                                        │
│  ─────────────────────────────────────                            │
│  Combina evidencia de ambas capas por IP                          │
│  Evita falsos positivos mediante período de gracia                │
│  Clasifica: SYN_FLOOD vs HTTP_FLOOD                               │
└───────────────────────────────────────────────────────────────────┘
```

### ¿Por qué dos capas?

**FlowStats** mide el volumen acumulado de paquetes en el dataplane. Es ideal para detectar floods volumétricos (muchos paquetes/segundo) donde el protocolo específico (UDP, ICMP) es irrelevante para la detección porque los contadores crecen de forma proporcional al ataque. Sin embargo, FlowStats no puede inspeccionar los flags TCP ni el contenido del payload, ya que solo accede a los contadores de flujo.

**PacketIn** entrega el paquete completo al controlador, permitiendo inspección de headers L4 y payload L7. Sin embargo, no puede usarse para todos los paquetes (saturación del controlador), por lo que se usa selectivamente mediante reglas de intercepción específicas (SYN, PSH-HTTP).

La combinación de ambas capas permite cobertura completa de los cinco vectores de ataque sin saturar el controlador con PacketIn de tráfico normal.

---

## 2. Sliding Windows — Fundamento Matemático

Una **ventana deslizante** (sliding window) es una estructura que mantiene un conjunto de eventos (timestamps) dentro de un intervalo de tiempo fijo `[now - window, now]`, actualizándose continuamente conforme avanza el tiempo.

### Implementación con `deque`

```python
def slide_syn(self, now: float) -> int:
    cutoff = now - SYN_FLOOD_WINDOW      # límite inferior de la ventana
    while self.syn_ts and self.syn_ts[0] < cutoff:
        self.syn_ts.popleft()            # eliminar timestamps expirados
    self.syn_ts.append(now)              # añadir el nuevo timestamp
    return len(self.syn_ts)             # count = SYN en la ventana actual
```

**¿Por qué `deque` y no un contador simple?**

Un contador simple con ventana fija tiene el siguiente comportamiento:

```
t=0.0s: ventana nueva, counter=1
t=0.9s: counter=29 (justo bajo el threshold=30)
t=1.0s: VENTANA RESETEA → counter=0
t=1.0s: counter=1 (el último paquete)
```

En este escenario, un atacante que envíe exactamente `threshold - 1 = 29` paquetes por segundo **nunca es detectado**, incluso si en 60 segundos ha enviado 1.740 paquetes.

La sliding window elimina este problema:

```
Ventana [now-1.0, now] contiene exactamente los últimos N segundos de SYN.
Si hay 30 SYN en cualquier intervalo de 1 segundo → DETECTADO.
La detección no depende de cuándo empezó la ventana anterior.
```

**Complejidad:**
- Inserción: O(1) amortizado
- Eliminación de expirados: O(k) donde k = número de elementos expirados
- Lectura de count: O(1)
- Memoria: O(count) ≤ O(threshold) por IP

### Ventana para SYN vs HTTP

Ambas tienen sliding windows pero con semánticas distintas:

| Ventana | Tipo de evento | Duración | Uso |
|---|---|---|---|
| `syn_ts` | timestamps de SYN | `SYN_FLOOD_WINDOW` s | Detectar SYN flood |
| `http_ts` | timestamps de requests HTTP | `HTTP_FLOOD_WINDOW` s | Detectar HTTP flood |

```python
# SYN: ventana de 1.0 segundo por defecto
cutoff_syn = now - SYN_FLOOD_WINDOW   # now - 1.0

# HTTP: ventana de 1.0 segundo por defecto
cutoff_http = now - HTTP_FLOOD_WINDOW  # now - 1.0
```

En ambos casos, `len(deque)` es directamente el count de eventos en la ventana. No se necesita ningún cálculo adicional.

---

## 3. Detección de SYN Flood

### ¿Qué es un SYN Flood?

En TCP, el establecimiento de conexión sigue el protocolo three-way handshake:

```
Cliente                     Servidor
   │──── SYN ──────────────────►│   Cliente inicia
   │◄─── SYN-ACK ───────────────│   Servidor responde
   │──── ACK ──────────────────►│   Handshake completo
```

Un **SYN Flood** consiste en enviar masivamente paquetes SYN sin nunca enviar el ACK final. El servidor reserva recursos para cada SYN recibido (tabla de conexiones semi-abiertas, memoria, temporizadores). Cuando esta tabla se agota, el servidor rechaza nuevas conexiones legítimas.

```
Atacante                    Servidor
   │──── SYN ──────────────────►│  Recursos reservados
   │──── SYN ──────────────────►│  Recursos reservados
   │──── SYN ──────────────────►│  Recursos reservados
   │   (miles de SYN/s)         │  Tabla llena
   │──── SYN ──────────────────►│  CONEXIÓN RECHAZADA para tráfico legítimo
```

### Mecanismo de Detección

**Paso 1: Captura de SYN mediante regla de intercepción**

Al conectarse cada switch, se instala una regla OpenFlow de alta prioridad:

```python
match_syn = parser.OFPMatch(
    eth_type=ether_types.ETH_TYPE_IP,  # Solo IPv4
    ip_proto=6,                         # Solo TCP
    tcp_flags=(0x002, 0x012),           # SYN=1, ACK=0
)
```

La máscara `0x012` (binario: 00010010) evalúa los bits:
- Bit SYN (0x002 = 00000010): debe ser 1
- Bit ACK (0x010 = 00010000): debe ser 0

Esto filtra exactamente los paquetes SYN puros, excluyendo SYN-ACK (que tienen SYN=1, ACK=1). Esta distinción es crucial: los SYN-ACK son respuestas legítimas del servidor y no deben contarse.

**Paso 2: Procesamiento en PacketIn handler**

```python
flags    = tcp_pkt.bits
is_syn   = bool(flags & 0x02) and not bool(flags & 0x10)
```

El handler verifica nuevamente los flags en software (la regla OpenFlow ya filtra, pero la verificación en Python añade una capa extra de precisión).

**Paso 3: Actualización de sliding window**

```python
if is_syn:
    syn_count = ctx.slide_syn(now)
    self._evaluate_syn(ctx, src_ip, syn_count, now, datapath.id)
```

**Paso 4: Evaluación del threshold**

En `_evaluate_syn()`:

```python
if syn_count < SYN_FLOOD_THRESHOLD:
    return  # Bajo threshold → sin acción

if ctx.state == IpState.OBSERVING:
    ctx.state = IpState.SYN_CANDIDATE
    ctx.syn_candidate_ts = now
    # NO bloquear todavía → iniciar período de gracia
```

El sistema **no bloquea inmediatamente** cuando el threshold se supera. Primero entra en `SYN_CANDIDATE` y espera `SYN_GRACE_MS` milisegundos para observar si hay requests HTTP. Esta decisión es el corazón del sistema y se explica en la sección siguiente.

### Threshold y Calibración

`SYN_FLOOD_THRESHOLD = 100` SYN/segundo es el valor recomendado para laboratorio porque:

- Un usuario navegando web: 2-10 SYN/s (múltiples conexiones paralelas a un sitio)
- Apache Benchmark `ab -c 50`: ~50 SYN iniciales en <100ms
- Apache Benchmark `ab -c 200`: ~200 SYN iniciales en <50ms
- hping3 `--flood`: >10.000 SYN/s (producción), ~1.000-5.000 SYN/s en Mininet

Con threshold=100, los primeros dos casos no se detectan (correcto), el tercero entra en SYN_CANDIDATE y se clasifica según correlación HTTP (correcto), y el cuarto se bloquea como SYN_FLOOD (correcto).

---

## 4. Correlación SYN/HTTP — El Problema Central

### El Problema Fundamental

Tanto un **SYN Flood** como un **HTTP Flood** generan paquetes SYN en la fase inicial. Esto crea una ambigüedad que versiones anteriores del sistema no podían resolver:

```
hping3 -S --flood -p 80 TARGET:
  t=0ms:  SYN×10.000/s, HTTP=0  → SYN flood real

ab -c 200 -n 5000 http://TARGET/:
  t=0ms:  200 SYN en 7ms → 28.571 SYN/s durante 7ms
  t=8ms:  200 HTTP GET enviados
  → Si bloqueamos en t=7ms, nunca vemos los HTTP GET
```

Un sistema naive que bloquea en cuanto SYN rate > threshold clasificaría ambos escenarios como "SYN_FLOOD", produciendo un falso positivo para el HTTP flood.

### La Solución: Correlación SYN/HTTP

La clave diferenciadora es **qué ocurre después de los SYN**:

| Escenario | SYN | Después del SYN |
|---|---|---|
| SYN Flood (hping3) | Miles de SYN | Nada (no hay ACK, no hay HTTP) |
| HTTP Flood (ab/curl) | N SYN (N=concurrencia) | N HTTP GET/POST (uno por conexión) |
| Tráfico legítimo | Pocos SYN | Requests HTTP proporcionales |

El **ratio HTTP/SYN** es el discriminador principal:

```
SYN flood real:    ratio = HTTP_count / SYN_count ≈ 0.0
HTTP flood:        ratio = HTTP_count / SYN_count ≈ 1.0
Tráfico legítimo:  ratio = HTTP_count / SYN_count ≈ variable (depende del patrón)
```

### El Período de Gracia

El período de gracia (`SYN_GRACE_MS = 100ms`) es el tiempo que el sistema espera después de que `SYN_count ≥ threshold` para observar si llegan requests HTTP:

```
t=0ms:   SYN_count = 100 → threshold alcanzado
         Estado: OBSERVING → SYN_CANDIDATE
         syn_candidate_ts = t=0ms

t=0-100ms: Período de gracia activo
           Sistema observa si llegan PacketIn con PSH+HTTP

Caso A (HTTP flood con ab):
t=8ms:   PSH+GET llega → HTTP_count=1
         SYN_CANDIDATE → HTTP_CANDIDATE
         ratio = 1/100 = 0.01 (bajo, pero mejora con más requests)

t=50ms:  HTTP_count=10 ≥ HTTP_FLOOD_THRESHOLD
         → BLOCKED(HTTP_FLOOD) ✓

Caso B (SYN flood con hping3):
t=100ms: Gracia expirada, HTTP_count=0
         ratio = 0/5000 = 0.00 < SYN_HTTP_RATIO_MIN=0.2
         → BLOCKED(SYN_FLOOD) ✓
```

### Verificación por hilo separado

El período de gracia se verifica de dos formas:

1. **Cada nuevo SYN:** En `_evaluate_syn()`, si el estado es `SYN_CANDIDATE`, se comprueba si `ctx.grace_expired(now)`.

2. **Hilo periódico:** `_grace_check_loop()` corre cada `SYN_GRACE_MS * 2` ms y verifica todas las IPs en `SYN_CANDIDATE`. Esto garantiza que si el atacante deja de enviar SYN después de la primera ráfaga (el hilo de PacketIn no se ejecutará para esa IP), la decisión igual se toma.

```python
def _grace_check_loop(self):
    check_interval = (SYN_GRACE_MS * 2) / 1000.0   # 200ms
    while True:
        hub.sleep(check_interval)
        self._check_grace_expirations()

def _check_grace_expirations(self):
    now = time.time()
    for src_ip, ctx in list(self._ip_ctx.items()):
        if ctx.state != IpState.SYN_CANDIDATE:
            continue
        if not ctx.grace_expired(now):
            continue
        # Decidir: ratio bajo → SYN_FLOOD, ratio alto → HTTP_CANDIDATE
        if ctx.http_syn_ratio < SYN_HTTP_RATIO_MIN:
            self._trigger_mitigation(src_ip, "SYN_FLOOD", ...)
        else:
            ctx.state = IpState.HTTP_CANDIDATE
```

---

## 5. Detección de HTTP Flood

### ¿Qué es un HTTP Flood?

Un HTTP Flood es un ataque de capa de aplicación donde el atacante envía un gran número de peticiones HTTP válidas a alta frecuencia. A diferencia del SYN Flood, las conexiones TCP se completan correctamente y los requests son semánticamente válidos (GET, POST, etc.). El servidor procesa cada request consumiendo CPU y memoria, hasta que no puede atender más requests.

### Arquitectura de Detección HTTP

```
INTERCEPCIÓN:
  Regla PSH en cada switch:
    match(eth_type=IP, ip_proto=6, tcp_dst=80, tcp_flags=PSH)
    → OUTPUT(CONTROLLER, 256 bytes)

ANÁLISIS:
  PacketIn llega al controller con los primeros 256 bytes del paquete
  → Extraer payload TCP
  → Verificar que es un request HTTP válido
  → Incrementar contador HTTP para esa IP

DETECCIÓN:
  Si HTTP_count (en ventana de 1s) ≥ HTTP_FLOOD_THRESHOLD
  → BLOCKED(HTTP_FLOOD)
```

### El Flag PSH y su Relación con HTTP

El **flag PSH** (Push) en TCP indica que el emisor quiere que los datos sean entregados inmediatamente a la aplicación destino, sin esperar a que el buffer se llene. Los requests HTTP siempre llevan PSH=1 en el último segmento (que contiene la línea de request completa).

```
Segmento TCP con PSH=1:
  Ethernet → IPv4 → TCP(PSH=1) → "GET / HTTP/1.1\r\nHost: target\r\n\r\n"
```

Esto es conveniente para el detector: podemos usar PSH como señal de que hay datos de aplicación que inspeccionar, sin necesidad de rastrear el estado de la conexión TCP.

**Limitación:** Requests HTTP grandes (POST con body grande) pueden fragmentarse en múltiples segmentos TCP. Solo el último tiene PSH=1. Si el método HTTP está en el primer segmento (que no tiene PSH), el detector puede no verlo. En la práctica, para requests GET típicos (< 1KB), todo el request cabe en un solo segmento con PSH=1.

### Extracción del Payload

```python
@staticmethod
def _extract_tcp_payload(pkt: packet.Packet) -> Optional[bytes]:
    for proto in pkt.protocols:
        if isinstance(proto, (bytes, bytearray)):
            data = bytes(proto)
            return data if data else None
    return None
```

La biblioteca Ryu parsea el paquete en una lista de objetos protocolo: `[Ethernet, IPv4, TCP, bytes_payload]`. El payload TCP raw aparece como el último elemento de tipo `bytes`. La iteración sobre `pkt.protocols` es más robusta que `pkt[-1]` porque:

1. Si no hay payload, `pkt[-1]` devuelve el objeto `tcp.tcp`, mientras que la iteración simplemente no encuentra ningún `bytes` y retorna `None`.
2. En paquetes fragmentados o con opciones TCP no estándar, la posición del payload puede variar.

### Validación HTTP

```python
@staticmethod
def _is_http_request(payload: bytes) -> bool:
    # Criterio 1: comienza con un verbo HTTP conocido
    if not any(payload.startswith(m) for m in HTTP_METHODS):
        return False
    # Criterio 2: contiene indicadores de protocolo HTTP
    return b"HTTP/" in payload or b"\r\n" in payload
```

Los verbos HTTP soportados son:
```python
HTTP_METHODS = (
    b"GET ", b"POST ", b"HEAD ", b"PUT ",
    b"DELETE ", b"PATCH ", b"OPTIONS ", b"CONNECT ", b"TRACE ",
)
```

La validación dual (verbo + indicador de protocolo) reduce falsos positivos:
- Un payload binario que casualmente empiece con `GET ` (improbable pero posible) será rechazado si no contiene `HTTP/` o `\r\n`.
- Un request HTTP malformado sin `\r\n` será rechazado (no es un request HTTP válido).

### Keep-Alive y su Impacto

Con **keep-alive** (Connection: keep-alive), el cliente reutiliza la misma conexión TCP para múltiples requests. Esto significa:

```
Sin keep-alive (curl sin -k):
  SYN × N_requests → N SYN para N requests
  → ratio HTTP/SYN ≈ 1.0

Con keep-alive (curl -k, ab -k, wrk):
  SYN × 1 (o pocos) → muchos HTTP requests sobre pocas conexiones
  → ratio HTTP/SYN >> 1.0
  → El detector SYN no se activa (pocos SYN)
  → El detector HTTP se activa directamente por el conteo HTTP
```

Keep-alive es ventajoso para el detector HTTP porque:
1. Evita el problema de correlación SYN/HTTP (pocos SYN → no entra en SYN_CANDIDATE)
2. El detector HTTP actúa directamente desde estado OBSERVING

Por eso se recomienda usar `ab -k` para demostrar HTTP_FLOOD de forma limpia en el laboratorio.

---

## 6. Detección de UDP e ICMP Flood (FlowStats)

### ¿Por qué FlowStats para UDP/ICMP?

A diferencia del TCP, UDP e ICMP son protocolos sin estado y sin flags de control relevantes. No hay concepto de "inicio de conexión" o "completar handshake". La única señal de flood es el **volumen**: una cantidad anormalmente alta de paquetes por unidad de tiempo desde una misma IP origen.

FlowStats es el mecanismo natural para medir volumen porque:
1. Los contadores de flujo en OVS se incrementan a velocidad de línea (en el dataplane), sin pasar por el controller.
2. Cada vez que el controller solicita estadísticas, el switch devuelve `packet_count` y `byte_count` acumulados para cada regla de flujo.
3. El delta entre dos muestreos consecutivos, dividido por el intervalo, da la tasa exacta.

### Flujo de Detección FlowStats

```
Cada POLL_INTERVAL segundos:
│
├── Para cada switch en self._datapaths:
│   └── Enviar OFPFlowStatsRequest(match=vacío)  ← pedir TODOS los flujos
│
└── Al recibir OFPFlowStatsReply:
    └── Para cada stat en body:
        │
        ├── Ignorar: priority ∈ {BLOCK_PRIORITY, INTERCEPT_PRIORITY}
        │   (nuestras propias reglas, no queremos contaminar el análisis)
        │
        ├── Ignorar: eth_src == broadcast o vacío
        │
        ├── Ignorar: ip_proto == 6 (TCP explícito en el match)
        │   (TCP se analiza via PacketIn; las reglas de dc_switch con L2
        │   match pueden incluir TCP, pero ip_proto no está en su match
        │   → None ≠ 6, por lo que estas reglas SÍ se incluyen)
        │
        └── Acumular: current[eth_src] += stat.packet_count
```

### Cálculo de PPS

```python
delta = pkt_total - prev
pps   = delta / POLL_INTERVAL
```

Si `POLL_INTERVAL = 2` segundos y en ese período se registraron 4.000 paquetes adicionales:
```
pps = 4000 / 2 = 2000 paquetes/segundo
```

Si `pps ≥ DDOS_THRESH_PPS = 1000`:
```
→ VOLUMETRIC_FLOOD detectado
```

### Tratamiento del delta negativo

```python
if delta < 0:
    # Contador del switch reseteado
    self._prev_pkt[key] = pkt_total
    continue
```

Los contadores del switch pueden resetearse si una regla de dc_switch expira por `idle_timeout` y se reinstala. En este caso, el nuevo counter empieza desde 0, produciendo `delta < 0`. El sistema detecta esto y actualiza el baseline sin generar una falsa alarma.

### Nota sobre el filtro TCP en FlowStats

```python
if stat.match.get("ip_proto") == 6:
    continue
```

Este filtro intenta excluir flujos TCP del análisis volumétrico. Sin embargo, `dc_switch.py` (SpineLeaf1) instala reglas con match(in_port, eth_src, eth_dst) **sin** ip_proto en el match. Para esas reglas, `stat.match.get("ip_proto")` devuelve `None`, y `None == 6` es False → las reglas L2 NO se excluyen.

En la práctica, esto significa que el FlowStats volumétrico puede incluir tráfico TCP en su conteo. Sin embargo, esto no es un problema operacional porque:
1. Los SYN floods son detectados por PacketIn en <2 segundos, mucho antes de que FlowStats acumule suficiente delta.
2. Si un SYN flood también dispara el detector FlowStats, `self._blocked` previene la instalación duplicada de reglas DROP.
3. El threshold `DDOS_THRESH_PPS = 1000` está calibrado por encima del tráfico TCP legítimo normal en el laboratorio.

---

## 7. Detección de Port Scan

### ¿Qué es un Port Scan?

Un port scan es una técnica de reconocimiento donde el atacante sondea un host para determinar qué puertos tienen servicios escuchando. La variante más común es el **SYN scan** (half-open scan): se envía un SYN a cada puerto, y si el puerto está abierto, el servidor responde con SYN-ACK. El scanner envía un RST sin completar el handshake, dejando el puerto en estado "entrevistado" sin establecer una conexión completa.

### Señal Diferenciadora

La diferencia clave entre un port scan y un SYN flood hacia un único puerto es la **diversidad de puertos destino**:

```
SYN flood: 10.000 SYN/s todos al puerto 80
  → ctx.portscan_ports = {80}
  → len(set) = 1 → nunca dispara port scan

nmap -sS -p 1-100:
  → SYN al puerto 1, SYN al puerto 2, ... SYN al puerto 100
  → ctx.portscan_ports = {1, 2, 3, ..., 100}
  → len(set) = 100 ≥ PORT_SCAN_THRESHOLD → PORT_SCAN detectado
```

### Implementación

```python
def _update_port_scan(self, ctx: IpContext, src_ip: str, dst_port: int,
                      now: float, dpid: int):
    # Ventana temporal: resetear si expiró PORT_SCAN_WINDOW segundos
    wstart = ctx.portscan_wstart
    if wstart is None or (now - wstart) > PORT_SCAN_WINDOW:
        ctx.portscan_wstart = now
        ctx.portscan_ports  = set()       # resetear set de puertos

    ctx.portscan_ports.add(dst_port)      # añadir puerto actual (set: sin duplicados)
    port_count = len(ctx.portscan_ports)

    if port_count >= PORT_SCAN_THRESHOLD:
        self._trigger_mitigation(src_ip, "PORT_SCAN", ...)
```

El uso de un `set()` es esencial: si la IP envía 1.000 SYN al puerto 80, `ctx.portscan_ports` sigue siendo `{80}` con size=1. Solo los puertos únicos cuentan.

### Ventana Temporal

`PORT_SCAN_WINDOW = 10` segundos es el período de observación. Si una IP contacta 20 puertos distintos en 10 segundos → PORT_SCAN. Si tarda 11 segundos (1 puerto/segundo), la ventana se resetea y el set vuelve a size=0.

Esta es una limitación conocida: **slow scans** (`nmap --scan-delay 2s`) con PORT_SCAN_THRESHOLD=20 y PORT_SCAN_WINDOW=10 no son detectados. Es un trade-off aceptado en el diseño: detectar scans rápidos con alta certeza vs. tolerar scans lentos.

### Independencia del Port Scan respecto a la FSM SYN/HTTP

El detector de port scan opera **sobre todos los SYN**, independientemente del estado FSM de la IP. Incluso si la IP está en `HTTP_CANDIDATE` (porque también envía requests HTTP), si contacta suficientes puertos distintos, se detecta el port scan.

```python
if is_syn:
    syn_count = ctx.slide_syn(now)
    self._update_port_scan(ctx, src_ip, dst_port, now, datapath.id)  # siempre
    self._evaluate_syn(ctx, src_ip, syn_count, now, datapath.id)     # FSM
```

Esto permite detectar un atacante que combina port scan con HTTP flood, clasificándolo como PORT_SCAN (la primera detección que actúa).

---

## 8. Prevención de Falsos Positivos

### Tabla de Análisis de Falsos Positivos

| Escenario legítimo | Riesgo | Mitigación implementada |
|---|---|---|
| Browser cargando web (10-20 SYN/s) | Bajo | Threshold=100 >> 20 |
| ab sin keep-alive (`-c 50`) | Medio | FSM: SYN_CANDIDATE + gracia HTTP |
| ab con keep-alive (`-k -c 200`) | Bajo | Pocos SYN; detector HTTP por req count |
| iperf3 TCP (muchos paquetes) | Medio | FlowStats threshold alto (1000 pps) |
| Servidor con muchas conexiones | Bajo | IP_WHITELIST configurable |
| Scan de seguridad interno | Bajo | IP_WHITELIST para herramientas internas |

### Mecanismos de Prevención

**1. Threshold elevado para SYN**

`SYN_FLOOD_THRESHOLD = 100` está muy por encima del tráfico TCP legítimo típico en el laboratorio (< 30 SYN/s para uso normal).

**2. Período de gracia y correlación**

El período de gracia de 100ms previene el bloqueo de clientes HTTP que generan SYN iniciales altos por concurrencia.

**3. Whitelist de IPs**

```bash
DDOS_IP_WHITELIST=10.1.1.100,10.1.1.254
```

Cualquier IP en la whitelist es ignorada por todos los detectores. Útil para herramientas de monitoreo interno, scanners de vulnerabilidades autorizados, o gateways que generan mucho tráfico legítimo.

**4. Validación HTTP robusta**

El payload HTTP se valida no solo por verbo sino también por indicadores de protocolo (`HTTP/` o `\r\n`), reduciendo falsos positivos por payload binario que casualmente inicie con "GET ".

**5. Bloqueo idempotente**

```python
if src_ip in self._blocked:
    return
```

Si múltiples detectores identifican la misma IP simultáneamente, solo se instala un conjunto de reglas DROP. El segundo detector simplemente retorna sin acción.

---

## 9. IpContext — El Objeto de Estado Centralizado

`IpContext` es un objeto Python que encapsula **todo** el estado de observación de una IP origen. En versiones anteriores, este estado estaba disperso en múltiples diccionarios globales (`_syn_counter`, `_syn_window_start`, `_http_counter`, `_http_window_start`, `_portscan_ports`, `_portscan_wstart`), lo que dificultaba la sincronización y la limpieza.

### Estructura Interna

```python
class IpContext:
    __slots__ = (
        "state",            # IpState enum
        "syn_ts",           # deque: timestamps de SYN recientes
        "syn_candidate_ts", # float: cuándo entró a SYN_CANDIDATE
        "http_ts",          # deque: timestamps de HTTP recientes
        "portscan_ports",   # set: puertos únicos contactados
        "portscan_wstart",  # float: inicio de ventana port scan
        "last_seen",        # float: último timestamp de actividad
    )
```

**`__slots__`** es una optimización de Python que preasigna los atributos en memoria, reduciendo el uso de memoria en ~40% comparado con `__dict__` normal. Esto importa cuando hay cientos de IPs activas simultáneamente.

### Propiedades Calculadas

```python
@property
def syn_count(self) -> int:
    return len(self.syn_ts)    # O(1): len de deque

@property
def http_count(self) -> int:
    return len(self.http_ts)   # O(1)

@property
def http_syn_ratio(self) -> float:
    return self.http_count / self.syn_count if self.syn_count else 0.0
```

Estas propiedades no almacenan nada; simplemente calculan desde la deque existente. Esto garantiza que el ratio siempre refleja el estado actual de las ventanas deslizantes.

### Ciclo de Vida de IpContext

```
1. IP primera vez vista:
   _get_or_create_ctx(src_ip) → crea IpContext(state=OBSERVING)
   self._ip_ctx[src_ip] = ctx

2. IP activa siendo analizada:
   ctx actualiza syn_ts, http_ts, portscan_ports
   ctx.last_seen = now

3. IP bloqueada:
   ctx.state = IpState.BLOCKED
   ctx permanece en _ip_ctx (referencia para estadísticas)

4. Bloqueo expirado (OFPFlowRemoved):
   self._ip_ctx.pop(src_ip, None)   ← eliminación completa
   self._blocked.discard(src_ip)

5. Inactividad prolongada (cleanup_loop):
   Si ctx.state != BLOCKED y last_seen > timeout:
   self._ip_ctx.pop(src_ip, None)   ← garbage collection
```

---

## 10. TCP Flags — Análisis Detallado

Los flags TCP son bits de control en el header TCP que determinan el tipo y propósito del segmento. Los 9 flags estándar (bits 0-8 del campo flags de 16 bits):

```
Bit  Flag  Valor    Significado
  0  NS    0x100    ECN nonce sum (experimental)
  1  CWR   0x080    Congestion Window Reduced
  2  ECE   0x040    ECN Echo
  3  URG   0x020    Urgent pointer válido
  4  ACK   0x010    Acknowledgment válido
  5  PSH   0x008    Push function (datos a la aplicación)
  6  RST   0x004    Reset the connection
  7  SYN   0x002    Synchronize sequence numbers
  8  FIN   0x001    No more data from sender
```

### Flags Relevantes para el Detector

**SYN (0x002):**
```python
is_syn = bool(flags & 0x02) and not bool(flags & 0x10)
```
SYN=1 AND ACK=0 → paquete de inicio de conexión (no respuesta del servidor).

**PSH (0x008):**
```python
is_psh = bool(flags & 0x08)
```
PSH=1 → hay datos de aplicación listos para entregar. Indica el último segmento de un request HTTP.

**SYN-ACK (excluido):**
SYN=1, ACK=1 → respuesta del servidor al SYN del cliente. La máscara `0x012` en la regla OpenFlow excluye estos correctamente.

### Máscara de tcp_flags en OpenFlow

```python
tcp_flags=(value, mask)
```

La máscara indica qué bits evaluar:
- `(0x002, 0x002)`: evaluar solo SYN → match si SYN=1 (incluye SYN-ACK)
- `(0x002, 0x012)`: evaluar SYN y ACK → match si SYN=1 AND ACK=0 (solo SYN puro)
- `(0x008, 0x008)`: evaluar solo PSH → match si PSH=1 (cualquier combinación de otros flags)

El valor `0x012` en la máscara del detector SYN es `0x010 | 0x002 = ACK | SYN`. Al poner valor=`0x002` y máscara=`0x012`, la regla hace match cuando SYN=1 Y ACK=0.

---

## 11. Deep Packet Inspection HTTP

### ¿Qué es DPI en este contexto?

Deep Packet Inspection (DPI) en el detector HTTP consiste en analizar el **payload** de los segmentos TCP (más allá del header L4) para determinar si contienen requests HTTP. En el sistema implementado, el DPI es básico: verificación de verbos HTTP y presencia de indicadores de protocolo.

### Flujo Completo de DPI

```
PacketIn recibido (PSH hacia puerto HTTP):
    │
    ▼
Extraer payload:
    pkt.protocols → buscar bytes → payload = "GET / HTTP/1.1\r\n..."
    │
    ▼
Verificar verbo:
    payload.startswith(b"GET ")    → True ✓
    payload.startswith(b"POST ")   → False
    ...
    → alguno es True → continuar
    │
    ▼
Verificar protocolo:
    b"HTTP/" in payload → True (payload contiene "HTTP/1.1")
    b"\r\n" in payload  → True (payload contiene fin de línea HTTP)
    → al menos uno es True → es HTTP válido
    │
    ▼
Incrementar contador HTTP:
    ctx.slide_http(now) → +1 en ventana deslizante
    http_count = len(ctx.http_ts)
    │
    ▼
Evaluar threshold:
    if http_count >= HTTP_FLOOD_THRESHOLD → BLOQUEAR
```



---

## 12. Cálculo de PPS y Tasas

### PPS (Packets Per Second) en FlowStats

```python
delta = pkt_total - prev_pkt_total
pps   = delta / POLL_INTERVAL
```

**Precisión:** La precisión del cálculo de PPS depende de `POLL_INTERVAL`. Con `POLL_INTERVAL=2`:
- El PPS se calcula cada 2 segundos
- Un burst de 5 segundos puede promediarse con un período tranquilo
- Para alta precisión, reducir a `POLL_INTERVAL=1`

**Latencia de detección:** Un flood que empieza en t=0 puede no detectarse hasta t=POLL_INTERVAL en el mejor caso. En el peor caso (si el polling acaba de correr), puede tomar hasta 2×POLL_INTERVAL.

### SYN rate en sliding window

La "tasa" de SYN no se calcula como paquetes/segundo directamente, sino como count de SYN en la ventana deslizante:

```python
count = len(ctx.syn_ts)   # SYN en los últimos SYN_FLOOD_WINDOW segundos
```

Si `SYN_FLOOD_WINDOW = 1.0s` y `count = 150`, significa que en los últimos 1.0 segundos llegaron 150 SYN → 150 SYN/s.

Esta representación es equivalente al cálculo `count / SYN_FLOOD_WINDOW`, pero evita la división y el resultado es directamente comparable con `SYN_FLOOD_THRESHOLD`.

### HTTP request rate en sliding window

Idéntico al SYN rate: la deque `http_ts` contiene timestamps de requests HTTP en los últimos `HTTP_FLOOD_WINDOW` segundos. Su longitud es el count de requests en esa ventana.

```python
http_count = len(ctx.http_ts)   # Requests HTTP en HTTP_FLOOD_WINDOW segundos
```

El threshold `HTTP_FLOOD_THRESHOLD = 10` con `HTTP_FLOOD_WINDOW = 1.0s` equivale a detectar cuando una IP envía más de 10 requests HTTP por segundo.