## Explicación Detallada del Código

explicacion del código en capas, desde la arquitectura global hasta las decisiones de implementación de cada función.

---

## 1. Arquitectura general

El archivo implementa una aplicación Ryu que corre en paralelo con `dc_switch.py` dentro del mismo proceso del controlador. Ryu permite cargar múltiples aplicaciones simultáneamente; cada una recibe los mismos eventos OpenFlow (PacketIn, FlowStatsReply, etc.) pero actúa de forma independiente.

La arquitectura está dividida en cuatro módulos internos:

```
Módulo A  FlowStats polling    → detecta UDP e ICMP flood (volumen bruto)
Módulo B  PacketIn L4          → detecta SYN flood y port scan
Módulo C  PacketIn L7          → detecta HTTP flood (DPI sobre payload)
Módulo D  Mitigation Engine    → instala reglas DROP en los switches
```

Un quinto componente transversal es la **Finite State Machine (FSM)** que correlaciona la evidencia de los módulos B y C para evitar clasificar un HTTP flood como SYN flood.

---

## 2. Bloque de configuración

```python
DDOS_THRESH_PPS    = int(os.environ.get("DDOS_THRESH_PPS", 20000))
POLL_INTERVAL      = int(os.environ.get("DDOS_INTERVAL",      2))
SYN_FLOOD_THRESHOLD = int(os.environ.get("SYN_FLOOD_THRESHOLD", 100))
SYN_GRACE_MS        = int(os.environ.get("SYN_GRACE_MS",        100))
SYN_HTTP_RATIO_MIN  = float(os.environ.get("SYN_HTTP_RATIO_MIN", 0.2))
...
```

Todos los parámetros se leen de variables de entorno con valores por defecto. Esto permite ajustarlos desde `docker-compose.yaml` sin modificar el código. Es una práctica de diseño importante para laboratorio: los thresholds correctos dependen del entorno (latencia de Mininet, velocidad del host), y cambiarlos requiere solo reiniciar el container.

Las dos constantes de prioridad OpenFlow son centrales para entender el sistema:

```python
BLOCK_PRIORITY     = 1000   # DROP rules — gana contra todo
INTERCEPT_PRIORITY = 500    # SYN/PSH trap — sobre dc_switch (100)
```

En OpenFlow, cuando un paquete llega al switch, se evalúa la tabla de flujos y gana la regla de **mayor prioridad** que hace match. La jerarquía queda:

```
1000 → DROP (atacante bloqueado)           ← instala el mitigador
 500 → CONTROLLER (SYN/PSH interceptado)  ← instala el mitigador
 100 → OUTPUT(puerto) (forwarding normal)  ← instala dc_switch
   0 → CONTROLLER (table-miss)            ← instala dc_switch
```

`max_len` en las reglas de intercepción controla cuántos bytes del paquete se envían al controller:

```python
SYN_MAXLEN  = 128   # Suficiente para Ethernet(14) + IP(20) + TCP(20) + margen
HTTP_MAXLEN = 256   # Suficiente para el verbo HTTP + primera línea del request
```

Esto es una optimización de ancho de banda del canal controller-switch. No necesitamos el payload completo para contar SYN, solo los headers.

---

## 3. La clase `IpState` — Enumeración de estados

```python
class IpState(Enum):
    OBSERVING      = auto()
    SYN_CANDIDATE  = auto()
    HTTP_CANDIDATE = auto()
    BLOCKED        = auto()
```

`auto()` asigna valores enteros secuenciales (1, 2, 3, 4). El valor en sí no importa; lo que importa es la identidad del estado para comparaciones (`ctx.state == IpState.BLOCKED`).

Usar un `Enum` en lugar de strings o constantes enteras tiene ventajas: el IDE puede detectar typos, `repr()` muestra el nombre legible (`IpState.OBSERVING`), y es imposible asignar un estado inválido.

---

## 4. La clase `IpContext` — El objeto de estado por IP

Esta es la estructura de datos más importante del sistema. Cada IP origen tiene exactamente un `IpContext` que centraliza toda la evidencia acumulada sobre esa IP.

```python
__slots__ = (
    "state", "syn_ts", "syn_candidate_ts",
    "http_ts", "portscan_ports", "portscan_wstart", "last_seen",
)
```

`__slots__` es una optimización de Python que preasigna los atributos en memoria en lugar de usar un diccionario `__dict__` dinámico. Reduce el consumo de memoria por instancia aproximadamente un 40%. Cuando el sistema tiene cientos de IPs observadas simultáneamente, esto importa.

Versiones anteriores tenían este estado disperso en siete diccionarios globales separados (`_syn_counter`, `_syn_window_start`, `_http_counter`, etc.). `IpContext` los unifica. La ventaja es que limpiar el estado de una IP es un solo `self._ip_ctx.pop(ip, None)` que borra todo, en lugar de siete llamadas `.pop()` separadas donde olvidar una causa un memory leak.

**`slide_syn` y `slide_http` — El núcleo de las sliding windows:**

```python
def slide_syn(self, now: float) -> int:
    cutoff = now - SYN_FLOOD_WINDOW       # ej: now - 1.0 segundos
    while self.syn_ts and self.syn_ts[0] < cutoff:
        self.syn_ts.popleft()             # eliminar timestamps expirados
    self.syn_ts.append(now)              # añadir el SYN actual
    self.last_seen = now
    return len(self.syn_ts)              # count = SYN en los últimos 1.0s
```

`self.syn_ts` es una `deque` (double-ended queue) de timestamps flotantes. Mantiene el invariante de que todos sus elementos están dentro del intervalo `[now - SYN_FLOOD_WINDOW, now]`.

El `while` al inicio elimina los timestamps más antiguos que el límite inferior de la ventana. Como la deque está ordenada por tiempo de inserción (siempre se inserta por la derecha con `append`), los más viejos están a la izquierda y se eliminan con `popleft()`. La complejidad es O(k) donde k es el número de elementos expirados, que en promedio es pequeño.

Por qué esto es correcto y una ventana fija no lo es: una ventana fija resetea el contador al inicio de cada período, creando un "punto ciego" en la transición entre períodos. La sliding window nunca tiene este problema porque la pregunta que responde es siempre la misma: "¿cuántos SYN llegaron en los últimos N segundos desde ahora?"

**`grace_expired`:**

```python
def grace_expired(self, now: float) -> bool:
    if self.syn_candidate_ts is None:
        return False
    return (now - self.syn_candidate_ts) * 1000 >= SYN_GRACE_MS
```

La multiplicación por 1000 convierte la diferencia de segundos (float) a milisegundos para comparar con `SYN_GRACE_MS` (también en milisegundos). `syn_candidate_ts` se establece cuando la IP entra a `SYN_CANDIDATE`.

---

## 5. `__init__` de `DDoSMitigator` — Inicialización

```python
self._datapaths: dict = {}    # dpid → datapath object
self._blocked: set   = set()  # IPs con regla DROP activa
self._ip_ctx: dict   = {}     # ip → IpContext
self._prev_pkt: dict = {}     # (dpid, eth_src) → packet_count previo
self._mac_to_ip: dict = {}    # MAC → IP (aprendizaje pasivo)
```

`_datapaths` es el registro de switches. El objeto `datapath` de Ryu es el canal de comunicación bidireccional con un switch OpenFlow específico. Sin él, no podemos enviar mensajes (FlowMod, FlowStatsRequest) a ese switch.

`_blocked` es un `set` de IPs con regla DROP activa. Se consulta en cada PacketIn para hacer un early return antes de cualquier análisis. Es la primera línea de defensa contra el overhead de procesar paquetes de IPs ya bloqueadas.

`_mac_to_ip` permite a FlowStats (que ve contadores por MAC) relacionarlos con una IP. dc_switch aprende MACs de los paquetes; el mitigador hace lo mismo pasivamente desde los PacketIn que recibe.

Los cuatro hilos de background se lanzan con `hub.spawn()`:

```python
self._poll_thread    = hub.spawn(self._poll_loop)
self._cleanup_thread = hub.spawn(self._cleanup_loop)
self._grace_thread   = hub.spawn(self._grace_check_loop)
self._stats_thread   = hub.spawn(self._stats_loop)
```

Ryu usa `gevent` internamente, no threads del sistema operativo. `hub.spawn` crea una greenlet (coroutine cooperativa). El scheduler de gevent alterna entre greenlets cuando una llama a `hub.sleep()`. No hay paralelismo real (GIL de Python), pero permite que los loops periódicos corran "en background" sin bloquear el event loop principal de Ryu.

---

## 6. `_features_handler` — Registro de switches e instalación de reglas

```python
@set_ev_cls(ofp_event.EventOFPSwitchFeatures, CONFIG_DISPATCHER)
def _features_handler(self, ev):
```

`@set_ev_cls` es el decorador de Ryu que registra el método como manejador del evento `EventOFPSwitchFeatures`. Este evento se dispara cuando un switch completa la fase de configuración OpenFlow (intercambio de capabilities). `CONFIG_DISPATCHER` indica que solo se activa durante esa fase de negociación inicial.

Lo primero que hace es guardar el datapath:
```python
self._datapaths[dp.id] = dp
```

Luego instala la regla SYN trap. El análisis de la regla:

```python
match_syn = parser.OFPMatch(
    eth_type=ether_types.ETH_TYPE_IP,    # 0x0800: solo IPv4
    ip_proto=6,                           # solo TCP
    tcp_flags=(0x002, 0x012),            # SYN=1, ACK=0
)
```

El campo `tcp_flags` toma una tupla `(valor, máscara)`. La máscara `0x012` es `0x010 | 0x002`, es decir, los bits ACK y SYN. Con valor `0x002`, la regla exige SYN=1 y ACK=0. Esto filtra exactamente los SYN puros del three-way handshake inicial, excluyendo los SYN-ACK (donde ambos bits son 1) que son respuestas legítimas del servidor.

La acción asociada envía el paquete al controller con max_len=128 bytes:
```python
syn_act = [parser.OFPActionOutput(ofproto.OFPP_CONTROLLER, SYN_MAXLEN)]
```

`OFPP_CONTROLLER` es un puerto especial de OpenFlow que representa al controller. La acción le dice al switch: "manda una copia de este paquete (los primeros 128 bytes) al controller".

Un punto importante: esta regla tiene `priority=500`, que está por encima de las reglas de forwarding de dc_switch (priority=100). Esto garantiza que el mitigador vea **todos** los SYN, incluso cuando dc_switch ya tiene instalada una regla de forwarding para ese par MAC origen-destino. Sin esto, después del primer SYN de cada flujo, dc_switch forwardearia directamente y el mitigador nunca vería los SYN subsiguientes.

La regla PSH para HTTP funciona igual pero con match diferente:
```python
match_psh = parser.OFPMatch(
    eth_type=ether_types.ETH_TYPE_IP,
    ip_proto=6,
    tcp_dst=port,                          # específicamente hacia puerto 80 o 443
    tcp_flags=(0x008, 0x008),              # PSH=1 (cualquier valor en otros bits)
)
```

Se instala una regla por cada puerto en `HTTP_PORTS`. PSH=1 indica que el emisor quiere que los datos se entreguen inmediatamente a la aplicación destino, típico en el último segmento de un request HTTP.

---

## 7. `_poll_loop` y `_flow_stats_reply_handler` — Detección volumétrica

```python
def _poll_loop(self):
    hub.sleep(POLL_INTERVAL * 3)    # espera inicial: dc_switch necesita configurar switches
    while True:
        for dp in list(self._datapaths.values()):
            self._request_flow_stats(dp)
        hub.sleep(POLL_INTERVAL)    # esperar 2 segundos antes del siguiente ciclo
```

La espera inicial de `POLL_INTERVAL * 3 = 6 segundos` da tiempo a que dc_switch instale sus reglas de forwarding. Si el polling empezara inmediatamente, todos los deltas serían cero (no hay tráfico aún) y se perdería el baseline.

`_request_flow_stats` envía un `OFPFlowStatsRequest` con match vacío, pidiendo estadísticas de **todos** los flujos en todas las tablas. El switch responde asincrónicamente con un `OFPFlowStatsReply` que dispara `_flow_stats_reply_handler`.

El handler hace varias cosas en secuencia:

**Primero, filtra reglas no relevantes:**
```python
if stat.priority in (BLOCK_PRIORITY, INTERCEPT_PRIORITY):
    continue
```

Las reglas DROP (priority=1000) y las reglas de intercepción SYN/PSH (priority=500) del propio mitigador no deben contaminar el análisis. Sus contadores reflejan tráfico bloqueado o interceptado, no el volumen del atacante en el dataplane normal.

```python
if stat.match.get("ip_proto") == 6:
    continue
```

Excluye reglas que explícitamente tienen TCP en el match. Sin embargo, dc_switch instala reglas con match(eth_src, eth_dst) sin ip_proto, por lo que `stat.match.get("ip_proto")` devuelve `None` para esas reglas, y `None == 6` es False. En la práctica, estas reglas L2 de dc_switch sí se incluyen y pueden contener tráfico TCP junto con UDP/ICMP. Esto es una limitación conocida del diseño: el análisis FlowStats es un detector de volumen bruto, no de protocolo específico.

**Luego calcula el delta y PPS:**
```python
delta = pkt_total - prev
pps   = delta / POLL_INTERVAL
```

Si en los últimos 2 segundos llegaron 40.000 paquetes más desde esta MAC:
```
pps = 40000 / 2 = 20000 paquetes/segundo ≥ DDOS_THRESH_PPS=20000 → ATAQUE
```

La detección por delta es más robusta que usar el contador absoluto porque el counter acumulado siempre crece. El delta mide la **tasa de llegada en el intervalo**, que es lo que indica un flood activo.

---

## 8. `_packet_in_handler` — Dispatcher principal

```python
@set_ev_cls(ofp_event.EventOFPPacketIn, MAIN_DISPATCHER)
def _packet_in_handler(self, ev):
```

`MAIN_DISPATCHER` significa que este handler actúa en el estado normal de operación (después de la fase de configuración inicial). Este mismo evento lo recibe también dc_switch, que lo usa para hacer forwarding. Los dos handlers coexisten: Ryu despacha el mismo evento a todos los manejadores registrados para él.

El handler implementa un "fast path" de descarte temprano para minimizar el trabajo por paquete no relevante:

```python
if not eth or eth.ethertype == ether_types.ETH_TYPE_LLDP:
    return   # descartar LLDP (tráfico de descubrimiento de topología)

ip_pkt = pkt.get_protocol(ipv4.ipv4)
if not ip_pkt:
    return   # solo IPv4

if src_ip in self._blocked or src_ip in IP_WHITELIST:
    return   # IP ya procesada

tcp_pkt = pkt.get_protocol(tcp.tcp)
if not tcp_pkt:
    return   # solo TCP (SYN y PSH son TCP)
```

Cada `return` temprano evita el costo de las instrucciones siguientes. En un sistema con muchos PacketIn por segundo, este ahorro acumulado es significativo.

La línea de aprendizaje MAC→IP:
```python
if eth.src not in self._mac_to_ip:
    self._mac_to_ip[eth.src] = src_ip
```

Solo aprende la primera vez que ve una MAC. Esto es suficiente para el propósito (mapear MAC→IP para FlowStats) y evita actualizaciones innecesarias del diccionario.

La clasificación de flags:
```python
is_syn = bool(flags & 0x02) and not bool(flags & 0x10)
is_psh = bool(flags & 0x08)
```

La operación AND con una máscara de un solo bit (`& 0x02`) extrae ese bit. `bool()` convierte a True/False. La condición compuesta `SYN=1 AND ACK=0` distingue el SYN inicial del SYN-ACK de respuesta.

---

## 9. `_evaluate_syn` — La lógica de transición SYN

Esta función implementa las transiciones de estado relacionadas con el tráfico SYN. Recibe el `IpContext`, la IP, el count actual de SYN, el timestamp, y el dpid.

```python
if ctx.state == IpState.BLOCKED:
    return   # IP ya bloqueada: ignorar
if syn_count < SYN_FLOOD_THRESHOLD:
    return   # Bajo threshold: sin acción
```

Estos dos guards evitan trabajo innecesario en los casos más comunes.

**Transición OBSERVING → SYN_CANDIDATE:**
```python
if ctx.state == IpState.OBSERVING:
    ctx.state = IpState.SYN_CANDIDATE
    ctx.syn_candidate_ts = now
```

Cuando el SYN count supera el threshold por primera vez, en lugar de bloquear inmediatamente, el sistema registra el timestamp de entrada a `SYN_CANDIDATE`. Este timestamp es el punto de referencia para el período de gracia. No se instala ninguna regla DROP aún.

**Transición SYN_CANDIDATE → decisión:**
```python
elif ctx.state == IpState.SYN_CANDIDATE:
    if ctx.grace_expired(now):
        if ctx.http_syn_ratio < SYN_HTTP_RATIO_MIN:
            self._trigger_mitigation(src_ip, "SYN_FLOOD", ...)
        else:
            # ratio suficiente: esperar confirmación HTTP_FLOOD
            pass
```

El bloqueo como SYN_FLOOD solo ocurre si se cumplen DOS condiciones simultáneamente: la gracia expiró Y el ratio HTTP/SYN es bajo. Si solo expira la gracia pero hay suficientes HTTP (ratio ≥ 0.2), el sistema asume que es tráfico legítimo o un HTTP flood que se detectará por el detector HTTP.

---

## 10. `_evaluate_http` — La lógica de transición HTTP

```python
if ctx.state == IpState.SYN_CANDIDATE:
    ctx.state = IpState.HTTP_CANDIDATE
```

Cuando llega un request HTTP mientras la IP está en `SYN_CANDIDATE`, el sistema cambia el estado. Esto captura el momento clave: si después de muchos SYN llegó un HTTP real, significa que los SYN completaron el handshake (el servidor respondió SYN-ACK y el cliente envió ACK). Eso descarta hping3 (que nunca completa el handshake) y apunta a un cliente HTTP real.

```python
if http_count >= HTTP_FLOOD_THRESHOLD:
    self._trigger_mitigation(src_ip, "HTTP_FLOOD", ...)
```

Esta condición aplica en cualquier estado (OBSERVING, SYN_CANDIDATE, HTTP_CANDIDATE). Esto cubre el caso de keep-alive: si el cliente usa una sola conexión TCP (1 SYN) pero envía 100 requests HTTP sobre ella, el estado se queda en OBSERVING (nunca supera SYN_FLOOD_THRESHOLD), pero el contador HTTP llega a threshold y se bloquea como HTTP_FLOOD directamente.

---

## 11. `_update_port_scan` — Detección de escaneo

```python
ctx.portscan_ports.add(dst_port)
port_count = len(ctx.portscan_ports)
if port_count >= PORT_SCAN_THRESHOLD:
    self._trigger_mitigation(src_ip, "PORT_SCAN", ...)
```

El uso de `set.add()` es la clave: un set descarta duplicados automáticamente. Si la IP envía 10.000 SYN al puerto 80, `portscan_ports` sigue siendo `{80}` con size=1. Solo la diversidad de puertos distintos incrementa el contador.

La ventana temporal funciona con un timestamp de inicio y reset:
```python
if wstart is None or (now - wstart) > PORT_SCAN_WINDOW:
    ctx.portscan_wstart = now
    ctx.portscan_ports  = set()    # reset del set
```

El reset crea un nuevo set vacío. El set anterior se convierte en basura y el garbage collector de Python lo libera. Esto es más eficiente que llamar `set.clear()` en algunos casos porque el set nuevo empieza con la capacidad mínima.

Esta función se llama para **todos los SYN**, incluso si la IP está en estado HTTP_CANDIDATE. Un atacante que hace port scan mientras simultáneamente tiene tráfico HTTP será detectado como PORT_SCAN (la primera detección que dispara bloqueará la IP).

---

## 12. `_grace_check_loop` y `_check_grace_expirations`

```python
def _grace_check_loop(self):
    check_interval = (SYN_GRACE_MS * 2) / 1000.0   # 200ms
    while True:
        hub.sleep(check_interval)
        self._check_grace_expirations()
```

Este hilo existe para resolver un problema de timing: si hping3 envía exactamente 100 SYN (suficiente para entrar en SYN_CANDIDATE) y luego deja de enviar, no llegará ningún SYN adicional que dispare `_evaluate_syn`. Sin este hilo, la gracia nunca se verificaría y la IP quedaría "atrapada" en SYN_CANDIDATE indefinidamente.

El hilo verifica cada 200ms (el doble del período de gracia de 100ms) todas las IPs en `SYN_CANDIDATE`:

```python
for src_ip, ctx in list(self._ip_ctx.items()):   # list() para copia segura
    if ctx.state != IpState.SYN_CANDIDATE:
        continue
    if not ctx.grace_expired(now):
        continue
    if ctx.http_syn_ratio < SYN_HTTP_RATIO_MIN:
        self._trigger_mitigation(src_ip, "SYN_FLOOD", ...)
    else:
        ctx.state = IpState.HTTP_CANDIDATE
```

`list(self._ip_ctx.items())` crea una copia de los ítems antes de iterar. Esto es necesario porque `_trigger_mitigation` puede modificar `self._ip_ctx` (cambiando el estado de la IP a BLOCKED), y modificar un dict mientras se itera sobre él causa `RuntimeError` en Python.

---

## 13. `_trigger_mitigation` — El motor de mitigación

```python
def _trigger_mitigation(self, src_ip, attack_type, detail, src_dpid):
    if src_ip in self._blocked:
        return   # idempotente: no instalar reglas duplicadas
    self._blocked.add(src_ip)
```

La primera línea garantiza que si múltiples detectores identifican la misma IP simultáneamente (por ejemplo, el hilo de grace check y un PacketIn recién llegado), solo se ejecuta una mitigación. `self._blocked.add()` antes de `_install_block_rule()` evita una race condition donde dos llamadas concurrentes instalarían reglas duplicadas.

```python
ctx = self._ip_ctx.get(src_ip)
if ctx:
    ctx.state = IpState.BLOCKED
```

Actualizar el estado del IpContext a BLOCKED hace que todos los handlers futuros que consulten `ctx.state` retornen early sin análisis innecesario.

```python
for dpid, datapath in self._datapaths.items():
    self._install_block_rule(datapath, src_ip)
```

La instalación en bucle garantiza que la regla DROP llega a **todos** los switches registrados. En una topología Spine-Leaf con 5 switches, esto son 5 mensajes OFPFlowMod enviados casi simultáneamente. El tráfico del atacante queda bloqueado en el primer switch que lo recibe (el leaf donde está conectado), sin que llegue al core de la red.

La línea `print(f"DDOS_EVENT ...")` emite una línea estructurada a stdout del proceso del controller. Esta línea se puede capturar con `docker compose logs controller | grep DDOS_EVENT` y parsear automáticamente para integración con sistemas de logging o bases de datos.

---

## 14. `_install_block_rule` — La regla DROP en OpenFlow

```python
match = parser.OFPMatch(
    eth_type=ether_types.ETH_TYPE_IP,
    ipv4_src=src_ip,           # bloquea toda IP de origen específica
)
msg = parser.OFPFlowMod(
    datapath=datapath,
    table_id=BLOCK_TABLE,      # tabla 0
    priority=BLOCK_PRIORITY,   # 1000: gana contra todo
    idle_timeout=BLOCK_IDLE_TIMEOUT,   # 120 segundos
    hard_timeout=0,            # sin límite de tiempo absoluto
    match=match,
    instructions=[],           # lista vacía = DROP en OpenFlow
    command=ofproto.OFPFC_ADD,
    flags=ofproto.OFPFF_SEND_FLOW_REM,  # notificar al expirar
)
```

`instructions=[]` es la forma correcta de especificar DROP en OpenFlow 1.3. Una regla sin instrucciones no tiene acción de salida, por lo que el switch descarta el paquete silenciosamente. Esto contrasta con una instrucción explícita de DROP que no existe en OpenFlow estándar.

`idle_timeout=120` significa que si no llega ningún paquete que haga match en esa regla durante 120 segundos, el switch la elimina automáticamente. Esta es la expiración automática del bloqueo: cuando el atacante deja de enviar tráfico, su regla DROP desaparece sola al cabo de 2 minutos.

`OFPFF_SEND_FLOW_REM` instruye al switch para que envíe un `OFPFlowRemoved` al controller cuando la regla expire. Esto dispara `_flow_removed_handler` que limpia el estado en el controller.

---

## 15. `_flow_removed_handler` — Limpieza al expirar el bloqueo

```python
@set_ev_cls(ofp_event.EventOFPFlowRemoved, MAIN_DISPATCHER)
def _flow_removed_handler(self, ev):
    if msg.priority != BLOCK_PRIORITY:
        return   # ignorar expiración de otras reglas (dc_switch también usa timeout)
    
    src_ip = match.get("ipv4_src")
    self._blocked.discard(src_ip)
    self._ip_ctx.pop(src_ip, None)   # elimina todo el contexto
```

El check `if msg.priority != BLOCK_PRIORITY` es necesario porque dc_switch también instala reglas con `idle_timeout`, y sus reglas también generan `OFPFlowRemoved` al expirar. Sin este filtro, el handler intentaría limpiar IPs de dc_switch que nunca fueron bloqueadas por el mitigador.

`self._blocked.discard()` (no `remove()`) elimina el elemento sin error si no existe. `self._ip_ctx.pop(src_ip, None)` elimina el IpContext completo, liberando toda la memoria asociada (las deques de timestamps, el set de puertos, etc.).

El log incluye `msg.packet_count` y `msg.byte_count`, que el switch incluye en el mensaje `OFPFlowRemoved`. Estos valores indican cuántos paquetes del atacante fueron bloqueados durante la vigencia de la regla, y son útiles como evidencia del ataque.

---

## 16. `_cleanup_stale_contexts` — Prevención de memory leak

```python
stale = [
    ip for ip, ctx in self._ip_ctx.items()
    if ctx.state != IpState.BLOCKED
    and (now - ctx.last_seen) > max(SYN_CLEANUP_TIMEOUT,
                                     HTTP_CLEANUP_TIMEOUT,
                                     PS_CLEANUP_TIMEOUT)
]
for ip in stale:
    self._ip_ctx.pop(ip, None)
```

IPs que generaron algo de tráfico (entraron al sistema de análisis) pero no superaron ningún threshold quedan en `_ip_ctx` con estado OBSERVING. Sin limpieza periódica, en un período largo podrían acumularse miles de entradas para IPs únicas que hicieron solo unos pocos pings.

El timeout de limpieza es el máximo de los tres timeouts configurados, lo que garantiza que ningún contexto activo (con ventana de detección aún válida) se elimine prematuramente. Un IpContext solo se considera "stale" si han pasado más de N segundos desde el último paquete de esa IP.

La lista de comprensión crea una lista de IPs a eliminar antes de modificar el dict, evitando el problema de modificar un dict durante la iteración.

---

## 17. `_log_stats` — Estadísticas periódicas

```python
state_counts = defaultdict(int)
for ctx in self._ip_ctx.values():
    state_counts[ctx.state.name] += 1
```

Esto cuenta cuántas IPs están en cada estado en el momento del log. `ctx.state.name` devuelve el nombre del enum como string ("OBSERVING", "BLOCKED", etc.), que es legible en los logs. Este conteo es útil durante el laboratorio para verificar que el sistema está procesando correctamente: si hay muchas IPs en OBSERVING pero ninguna en BLOCKED durante un ataque conocido, algo falla.

---

## 18. El problema central resuelto: la carrera SYN/HTTP

Para entender por qué todo este diseño es necesario, considera este escenario concreto:

```
t=0ms:   ab -c 200 inicia
         200 conexiones TCP en paralelo
         200 SYN enviados en ~7ms

t=7ms:   SYN_count = 200 ≥ SYN_FLOOD_THRESHOLD=100
         v7 (ventana fija): BLOQUEADO como SYN_FLOOD ← INCORRECTO
         v8 (FSM + gracia): → SYN_CANDIDATE, gracia=100ms

t=8ms:   Los 200 TCP handshakes completan
         200 GET / HTTP/1.1 enviados
         Primeros PacketIn PSH llegan al controller

t=10ms:  HTTP_count = 5, SYN_CANDIDATE → HTTP_CANDIDATE
         ratio = 5/200 = 0.025 (bajo, pero los HTTP siguen llegando)

t=50ms:  HTTP_count = 10 ≥ HTTP_FLOOD_THRESHOLD
         → BLOCKED como HTTP_FLOOD ← CORRECTO
```

Para hping3 en el mismo escenario:

```
t=0ms:   hping3 --flood inicia
         10.000 SYN/s

t=10ms:  SYN_count = 100 ≥ threshold
         → SYN_CANDIDATE, gracia=100ms

t=100ms: Gracia expirada
         HTTP_count = 0, ratio = 0.00 < SYN_HTTP_RATIO_MIN=0.2
         → BLOCKED como SYN_FLOOD ← CORRECTO
```

La diferencia observable es que el HTTP flood tiene un período de latencia de detección de ~50ms (el tiempo para acumular 10 requests HTTP), mientras que el SYN flood tiene ~100ms (el período de gracia). Ambos son aceptables en el contexto del laboratorio.

---

## Resumen de interacciones entre componentes

```
Switch s21 recibe SYN de 10.1.1.1:
│
├─ Regla priority=1000 (DROP): ¿10.1.1.1 está bloqueada?
│   SI → descarta, fin
│   NO → continúa
│
├─ Regla priority=500 (SYN trap): ¿eth_type=IP, ip_proto=6, SYN=1, ACK=0?
│   SI → PacketIn al controller con 128 bytes
│   NO → continúa a priority=100
│
└─ Regla priority=100 (dc_switch): match(in_port, eth_src, eth_dst)?
    SI → OUTPUT(puerto_correcto)
    NO → priority=0 (table-miss) → PacketIn al controller

Controller recibe PacketIn:
│
├─ dc_switch._packet_in_handler: aprende MAC, instala forwarding rule, hace PacketOut
│
└─ ddos_mitigator._packet_in_handler:
    ├─ Aprender MAC→IP
    ├─ is_syn? → slide_syn() → _update_port_scan() → _evaluate_syn()
    └─ is_psh+HTTP? → _extract_payload() → _is_http_request() → slide_http() → _evaluate_http()
        └─ Si threshold superado: _trigger_mitigation()
            └─ Para cada switch: _install_block_rule() → OFPFlowMod(DROP, priority=1000)
```
