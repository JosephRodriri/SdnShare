# Glosario Técnico del Sistema SDN DDoS Mitigator

---

## SDN (Software Defined Networking)

Arquitectura de red donde el plano de control se separa del plano de datos.

* El switch solo reenvía paquetes.
* El controlador toma las decisiones inteligentes.
* Permite programar la red dinámicamente.



* Open vSwitch = dataplane
* Ryu Controller = control plane

---

## Control Plane

Componente lógico que decide cómo debe comportarse la red.

Funciones:

* instalar reglas
* detectar ataques
* tomar decisiones

En el proyecto:

* `ddos_mitigator.py`
* `dc_switch.py`

---

## Data Plane (Dataplane)

Parte de la red que realmente mueve paquetes.

Funciones:

* forwarding
* switching
* conteo de tráfico

En el proyecto:

* Open vSwitch (OVS)

---

## OpenFlow

Protocolo de comunicación entre controlador SDN y switches.

Permite:

* instalar reglas
* pedir estadísticas
* bloquear tráfico
* recibir PacketIn

El mitigador usa:

* `FlowMod`
* `PacketIn`
* `FlowStatsRequest`

---

## Ryu Controller

Framework SDN escrito en Python.

Permite:

* crear aplicaciones OpenFlow
* recibir eventos de red
* programar lógica de detección

El sistema corre sobre Ryu.

---

## Open vSwitch (OVS)

Switch virtual compatible con OpenFlow.

Funciones:

* forwarding
* tablas de flujo
* estadísticas
* aplicar reglas DROP

---

## Flow Table

Tabla interna del switch que contiene reglas OpenFlow.

Ejemplo:

```text
Si ipv4_src=10.0.0.1 → DROP
```

Cada paquete se compara contra esta tabla.

---

## Flow Entry

Regla individual dentro de una flow table.

Contiene:

* match
* prioridad
* acciones
* timeouts

---

## Match

Conjunto de condiciones para identificar tráfico.

Ejemplo:

```python
tcp_flags=(0x002, 0x012)
```

Significa:

* SYN=1
* ACK=0

---

## FlowMod

Mensaje OpenFlow enviado por el controlador para instalar reglas.

El sistema usa FlowMod para:

* bloquear IPs
* interceptar SYN
* interceptar HTTP

---

## PacketIn

Evento donde el switch envía un paquete al controlador.

Ocurre cuando:

* una regla lo indica
* no existe match
* el paquete debe inspeccionarse

---

## PacketOut

Mensaje del controlador hacia el switch para reenviar un paquete.

`dc_switch.py` usa PacketOut para forwarding.

---

## FlowStats

Estadísticas acumuladas de tráfico dentro del switch.

Incluyen:

* packet_count
* byte_count
* duración

El sistema usa FlowStats para detectar floods volumétricos.

---

## FlowStatsReply

Respuesta del switch con estadísticas solicitadas por el controlador.

---

## Polling

Consulta periódica.

El mitigador:

* consulta FlowStats cada N segundos.

---

## PPS (Packets Per Second)

Cantidad de paquetes por segundo.

Fórmula:

```text
pps = delta_packets / tiempo
```

Se usa para detectar floods.

---

## Flood

Ataque basado en enviar tráfico masivo.

Ejemplos:

* SYN Flood
* UDP Flood
* ICMP Flood
* HTTP Flood

---

## DDoS

Distributed Denial of Service.

Ataque distribuido cuyo objetivo es saturar un servicio o red.

---

## SYN Flood

Ataque TCP donde se envían miles de SYN sin completar el handshake.

Objetivo:

* agotar conexiones semiabiertas del servidor.

---

## HTTP Flood

Ataque de capa de aplicación basado en miles de requests HTTP válidos.

Objetivo:

* consumir CPU y memoria del servidor web.

---

## UDP Flood

Ataque volumétrico usando paquetes UDP masivos.

---

## ICMP Flood

Ataque basado en paquetes ICMP masivos.

Ejemplo:

* ping flood

---

## Port Scan

Técnica de reconocimiento para descubrir puertos abiertos.

El detector mide:

* cantidad de puertos únicos contactados.

---

## TCP Three-Way Handshake

Proceso para crear una conexión TCP.

```text
SYN → SYN-ACK → ACK
```

---

## TCP Flags

Bits de control dentro del header TCP.

Principales:

* SYN
* ACK
* PSH
* FIN
* RST

---

## SYN Flag

Indica inicio de conexión TCP.

---

## ACK Flag

Indica confirmación de recepción.

---

## PSH Flag

Indica que los datos deben entregarse inmediatamente a la aplicación.

El detector HTTP usa PSH.

---

## TCP Payload

Datos reales transportados por TCP.

Ejemplo:

* HTTP GET
* JSON
* HTML

---

## Payload

Contenido útil del paquete.

No incluye headers.

---

## Header

Metadatos del paquete.

Incluye:

* IP origen
* puertos
* flags
* checksums

---

## DPI (Deep Packet Inspection)

Inspección profunda del contenido de paquetes.

El detector HTTP hace DPI básico.

---

## HTTP Request

Petición enviada por un cliente HTTP.

Ejemplo:

```http
GET /index.html HTTP/1.1
```

---

## HTTP Methods

Verbos HTTP.

Ejemplos:

* GET
* POST
* PUT
* DELETE

---

## Keep-Alive

Mecanismo HTTP/TCP para reutilizar conexiones.

Permite:

* múltiples requests sobre una sola conexión TCP.

---

## Sliding Window

Estructura temporal que mantiene eventos recientes.

El sistema usa sliding windows para:

* SYN rate
* HTTP rate

---

## Deque

Double-ended queue.

Estructura eficiente para:

* append()
* popleft()

Ideal para sliding windows.

---

## Threshold

Límite que dispara detección.

Ejemplo:

```text
100 SYN/s
```

---

## FSM (Finite State Machine)

Máquina de estados finitos.

El sistema usa:

```text
OBSERVING
SYN_CANDIDATE
HTTP_CANDIDATE
BLOCKED
```

---

## State Transition

Cambio entre estados de la FSM.

Ejemplo:

```text
OBSERVING → SYN_CANDIDATE
```

---

## Grace Period

Período de espera antes de tomar una decisión.

El mitigador espera:

* posibles HTTP requests
* antes de clasificar como SYN Flood.

---

## Correlation

Relación entre múltiples eventos para tomar decisiones.

El sistema correlaciona:

* SYN
* HTTP

---

## HTTP/SYN Ratio

Relación entre requests HTTP y SYN.

Ayuda a distinguir:

* SYN Flood
* HTTP Flood

---

## False Positive

Tráfico legítimo clasificado erróneamente como ataque.

---

## Mitigation

Acción defensiva para detener el ataque.

La mitigación:

* reglas DROP OpenFlow.

---

## DROP Rule

Regla que descarta paquetes silenciosamente.

---

## Priority (OpenFlow)

Nivel de precedencia de una regla.

Mayor prioridad:

* gana el match.

---

## Table-Miss

Situación donde ningún flujo coincide.

Normalmente:

* genera PacketIn.

---

## Timeout

Tiempo tras el cual una regla expira.

Tipos:

* idle_timeout
* hard_timeout

---

## idle_timeout

La regla expira si no recibe tráfico.

---

## hard_timeout

La regla expira después de un tiempo fijo.

---

## OFPFlowRemoved

Evento enviado cuando una regla OpenFlow expira.

El sistema lo usa para:

* desbloquear IPs
* limpiar memoria.

---

## Datapath

Objeto Ryu que representa conexión con un switch.

---

## DPID (Datapath ID)

Identificador único del switch OpenFlow.

---

## Green Thread / Greenlet

Thread cooperativo ligero usado por gevent/Ryu.

---

## Event Loop

Bucle principal de eventos de Ryu.

Procesa:

* PacketIn
* FlowStats
* timers

---

## Whitelist

Lista de IPs ignoradas por el mitigador.

---

## Garbage Collection

Liberación automática de memoria no usada.

---

## Memory Leak

Consumo creciente de memoria por objetos nunca eliminados.

El cleanup loop evita esto.

---

## Concurrency

Ejecución concurrente de múltiples tareas.

El sistema:

* polling
* cleanup
* detección
* estadísticas

corren simultáneamente mediante greenlets.

---

## Mininet

Emulador de redes SDN.

Usado para:

* laboratorio
* simulación de topologías
* generación de ataques

---

## Spine-Leaf

Arquitectura moderna de red datacenter.



* switches spine
* switches leaf
* hosts finales.
