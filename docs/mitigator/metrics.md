# Métricas y Evaluación de Contramedidas DDoS en SDN

## Introducción

Este documento describe las métricas utilizadas para evaluar el módulo de detección y mitigación DDoS implementado sobre la arquitectura SDN Spine-Leaf utilizando Ryu Controller y OpenFlow 1.3.

El objetivo principal del sistema es detectar y mitigar ataques de red en tiempo real minimizando:

* falsos positivos,
* saturación del controlador,
* impacto sobre tráfico legítimo,
* tiempo de respuesta ante ataques.

El sistema implementa detección para:

* SYN Flood
* HTTP Flood
* UDP/ICMP Volumetric Flood
* Port Scan

y utiliza una máquina de estados con correlación SYN/HTTP para mejorar la precisión de clasificación.

---

# Arquitectura de Monitoreo

La solución integra múltiples componentes de observabilidad:

| Componente         | Función                 |
| ------------------ | ----------------------- |
| Ryu Controller     | Detección y mitigación  |
| OpenFlow FlowStats | Métricas de tráfico     |
| Graphite           | Almacenamiento temporal |
| Prometheus         | Recolección de métricas |
| Grafana            | Visualización           |
| InfluxDB           | Persistencia temporal   |

---

# Métricas Principales

## 1. Tiempo de Detección

Mide cuánto tarda el sistema en identificar un ataque desde el primer paquete malicioso.

### Fórmula

T_{deteccion}=t_{alerta}-t_{inicio_ataque}

### Objetivo

Reducir el tiempo de detección para minimizar impacto sobre la red.

### Observación

En SYN Floods reales usando `hping3 --flood`, la detección ocurre típicamente en milisegundos debido al alto volumen de SYN.

---

## 2. Tiempo de Mitigación

Mide cuánto tarda el controlador en instalar reglas DROP después de detectar el ataque.

### Fórmula

T_{mitigacion}=t_{flowmod}-t_{deteccion}

### Incluye

* generación del evento,
* creación del `FlowMod`,
* propagación OpenFlow,
* instalación de reglas.

### Meta esperada

Menor a 1 segundo en laboratorio Mininet.

---

# Métricas de Clasificación

## 3. Ratio SYN/HTTP

Métrica central de la versión v8.

Permite distinguir entre:

* SYN Flood real,
* HTTP Flood legítimo,
* clientes HTTP normales.

### Fórmula

Ratio_{HTTP/SYN}=\frac{HTTP\ Requests}{SYN\ Packets}

---

## Interpretación

| Ratio       | Interpretación        |
| ----------- | --------------------- |
| cercano a 0 | SYN Flood             |
| intermedio  | tráfico sospechoso    |
| alto        | tráfico HTTP legítimo |

---

## Uso en el Sistema

Si:

Ratio_{HTTP/SYN}<0.2

entonces el tráfico es clasificado como:

* `SYN_FLOOD`

De lo contrario:

* `HTTP_CANDIDATE`

---

# Métricas de Volumen

## 4. Packets Per Second (PPS)

Utilizada para detectar floods UDP e ICMP mediante estadísticas OpenFlow.

### Fórmula

PPS=\frac{\Delta\ Packets}{\Delta\ Time}

---

## Threshold configurado

```python
DDOS_THRESH_PPS = 1000
```

Si el tráfico supera este valor:

* se activa mitigación automática.

---

# Métricas HTTP Flood

## 5. HTTP Requests por Ventana

Cuenta requests HTTP dentro de una ventana temporal deslizante.

### Fórmula

HTTP_{rate}=\frac{Requests}{Ventana\ de\ tiempo}

---

## Configuración

```python
HTTP_FLOOD_THRESHOLD = 15
HTTP_FLOOD_WINDOW = 1.0
```

### Interpretación

Más de 15 requests HTTP por segundo:

→ posible HTTP Flood.

---

# Métricas de Port Scan

## 6. Puertos Únicos Escaneados

Detecta comportamiento de escaneo horizontal.

### Fórmula

PortScan_{score}=|Puertos_Unicos|

---

## Configuración

```python
PORT_SCAN_THRESHOLD = 10
PORT_SCAN_WINDOW = 10
```

Si una IP contacta:

* más de 10 puertos
* en menos de 10 segundos

→ se clasifica como `PORT_SCAN`.

---

# Métricas del Controlador SDN

## 7. Tasa de PacketIn

Mide presión sobre el controlador SDN.

### Fórmula

PacketInRate=\frac{PacketIn}{segundo}

---

## Objetivo

Evitar saturación del controlador OpenFlow.

### Configuración

```python
PACKETIN_WARN_RATE = 1000
```

Si el límite es superado:

* el sistema genera advertencias de posible saturación.

---

# Métricas de Bloqueo

## 8. Total de IPs Bloqueadas

Permite evaluar efectividad del sistema.

### Variables monitoreadas

```python
total_blocked
syn_flood
http_flood
port_scan
volumetric_flood
```

---

# Máquina de Estados

## Estados Implementados

| Estado         | Descripción                |
| -------------- | -------------------------- |
| OBSERVING      | Recolectando evidencia     |
| SYN_CANDIDATE  | Alto volumen SYN           |
| HTTP_CANDIDATE | SYN + HTTP correlacionados |
| BLOCKED        | Regla DROP instalada       |

---

# Flujo de Clasificación

```text
OBSERVING
   |
   | SYN > threshold
   v
SYN_CANDIDATE
   |
   | HTTP detectado
   v
HTTP_CANDIDATE
   |
   | HTTP threshold superado
   v
BLOCKED
```

---

# Métricas Visualizadas en Grafana

Los dashboards permiten observar:

* tráfico por switch,
* PPS,
* IPs bloqueadas,
* PacketIn rate,
* SYN rate,
* HTTP rate,
* alertas activas,
* estados de IPs,
* tiempo de mitigación.

---

# Herramientas de Prueba

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

## UDP Flood

```bash
hping3 --udp --flood TARGET
```

---

## Port Scan

```bash
nmap -sS -p 1-100 TARGET
```

---

# Evaluación Experimental

## Objetivos evaluados

| Objetivo                | Resultado esperado |
| ----------------------- | ------------------ |
| Detectar SYN Flood      | Sí                 |
| Detectar HTTP Flood     | Sí                 |
| Detectar Port Scan      | Sí                 |
| Detectar UDP Flood      | Sí                 |
| Evitar falsos positivos | Sí                 |
| Minimizar PacketIn      | Sí                 |
| Mitigar automáticamente | Sí                 |

---

# Ventajas de la Solución

## 1. Correlación SYN/HTTP

Reduce falsos positivos.

---

## 2. Máquina de Estados

Permite clasificación progresiva y contextual.

---

## 3. Sliding Windows

Mejor precisión temporal.

---

## 4. SDN Centralizado

Mitigación global desde el controlador.

---

## 5. Reglas OpenFlow Dinámicas

Bloqueo automático distribuido.

---

# Limitaciones

## 1. Dependencia del controlador

El controlador sigue siendo punto crítico.

---

## 2. Umbrales Estáticos

Los thresholds pueden requerir ajuste según entorno.

---

## 3. Ataques Distribuidos Reales

El sistemq trabaja principalmente con tráfico local.

---

