# `docs/testing_guide.md`

````md
# Testing Guide — SDN DDoS Mitigation Module

## Overview

This document explains how to test the SDN DDoS mitigation module implemented in:

```bash
infra/controller/ddos_mitigator.py
````

The module detects and mitigates:

* SYN Flood
* UDP Flood
* ICMP Flood
* HTTP Flood
* Port Scan

The mitigation engine is integrated into the SDN controller using OpenFlow rules dynamically installed in the switches.

---

# Architecture Under Test

The environment uses:

* Ryu SDN Controller
* Spine-Leaf topology
* OpenFlow 1.3
* Mininet
* Docker Compose
* Grafana / InfluxDB / Graphite monitoring

Main controller:

```bash
infra/controller/dc_switch.py
```

Mitigation module:

```bash
infra/controller/ddos_mitigator.py
```

---

# Lab Startup

## 1. Build and start containers

From project root:

```bash
docker compose up --build
```

Or with monitoring stack:

```bash
docker compose --profile monitor up --build
```

---

## 2. Enter Mininet container

```bash
docker exec -it <mininet_container> bash
```

Example:

```bash
docker exec -it sdn-mininet-1 bash
```

---

## 3. Start the topology

Inside Mininet container:

```bash
python3 infra/topology/spine_leaf.py
```

---

# Controller Configuration

The mitigation thresholds are configured through environment variables in:

```bash
docker-compose.yaml
```

Current configuration:

```yaml
- DDOS_THRESH_PPS=1000
- DDOS_INTERVAL=2
- DDOS_BLOCK_TIMEOUT=120

- PORT_SCAN_THRESHOLD=20
- PORT_SCAN_WINDOW=5

- HTTP_FLOOD_THRESHOLD=10
- HTTP_PORTS=80,443

- VICTIM_WINDOW=1
- VICTIM_SYN_THRESHOLD=300
- VICTIM_HTTP_THRESHOLD=50
- VICTIM_UNIQUE_SRC_THRESHOLD=3
- VICTIM_MIN_SOURCE_EVENTS=5
```

---

# Internal Detection Logic

## SYN Flood Detection

The module uses a state machine.

Problem solved in v8:

Previous versions blocked HTTP flood traffic too early because HTTP clients generate SYN packets before sending HTTP requests.

Example:

```bash
ab -c 200 -n 5000 http://TARGET/
```

This generates many SYN packets instantly.

To solve this, v8 introduces:

* SYN grace period
* SYN/HTTP correlation
* Stateful classification

---

# State Machine

Each IP transitions through states:

```text
OBSERVING
    ↓
SYN_CANDIDATE
    ↓
HTTP_CANDIDATE
    ↓
BLOCKED
```

---

## SYN Candidate

When SYN rate exceeds threshold:

```python
SYN_FLOOD_THRESHOLD
```

The IP is NOT blocked immediately.

Instead, the controller waits:

```python
SYN_GRACE_MS
```

to observe whether HTTP traffic appears.

---

## HTTP Candidate

If HTTP requests arrive during the grace period:

```text
SYN + HTTP observed
```

the traffic is classified as HTTP traffic instead of SYN flood.

---

## SYN Flood Decision

If:

```text
HTTP/SYN ratio < SYN_HTTP_RATIO_MIN
```

the IP is classified as a real SYN flood attacker.

---

# Detection Thresholds

Recommended lab thresholds:

```python
SYN_FLOOD_THRESHOLD = 100
SYN_FLOOD_WINDOW    = 1.0

SYN_GRACE_MS        = 100

SYN_HTTP_RATIO_MIN  = 0.2

HTTP_FLOOD_THRESHOLD = 10
HTTP_FLOOD_WINDOW    = 1.0

PORT_SCAN_THRESHOLD = 20
PORT_SCAN_WINDOW    = 5
```

Distributed detection thresholds used by Docker Compose:

```python
VICTIM_WINDOW = 1.0
VICTIM_SYN_THRESHOLD = 300
VICTIM_HTTP_THRESHOLD = 50
VICTIM_UNIQUE_SRC_THRESHOLD = 3
VICTIM_MIN_SOURCE_EVENTS = 5
```

---

# Running Tests

The project already includes automated attack scripts:

```text
infra/attacks/tests/
```


---

# SYN Flood Test

## Execute

```bash
py exec(open('infra/attacks/tests/test_syn_flood.py').read())
```

```bash
h1 hping3 -S --flood -V -p 80 10.1.1.4
```
---

## Expected Behavior

The controller should:

1. Detect excessive SYN packets
2. Transition IP to `SYN_CANDIDATE`
3. Wait during grace period
4. Observe absence of HTTP traffic
5. Classify attack as `SYN_FLOOD`
6. Install DROP rule in all switches

---

## Expected Logs

```text
[DDoS-B] SYN_CANDIDATE ip=...
[DDoS] Grace check ip=...
[DDoS] ══ ATAQUE DETECTADO ══ tipo=SYN_FLOOD
[DDoS] ══ BLOQUEADO ══ ip=...
```

---

# UDP Flood Test

## Execute

```bash
py exec(open('infra/attacks/tests/test_udp_flood.py').read())
```

```bash
h2 hping3 --udp --flood -V 10.1.1.4
```
---

## Detection Method

UDP floods are detected using:

```text
FlowStats polling
```

The controller periodically checks packet rates.

---

## Expected Behavior

When packets per second exceed:

```python
DDOS_THRESH_PPS
```

the source IP is blocked.

---

## Expected Logs

```text
[DDoS-A] dpid=...
pps=...
ATAQUE DETECTADO tipo=VOLUMETRIC_FLOOD
```

---

# ICMP Flood Test

## Execute

```bash
py exec(open('infra/attacks/tests/test_icmp_flood.py').read())
```

```bash
h3 hping3 --icmp --flood 10.1.1.4
```
---

## Detection Method

ICMP flood detection also uses FlowStats analysis.

The controller computes:

```text
delta packets / polling interval
```

---

## Expected Result

The attacker IP should receive a DROP rule after exceeding the PPS threshold.

---

# HTTP Flood Test

## Execute

```bash
py exec(open('infra/attacks/tests/test_http_flood.py').read())
```

---

# Important

HTTP floods generate SYN packets naturally.

The mitigation module differentiates:

| Traffic Type | SYN  | HTTP    |
| ------------ | ---- | ------- |
| SYN Flood    | High | None    |
| HTTP Flood   | High | Present |

---

# Detection Logic

The module intercepts:

* TCP SYN packets
* TCP PSH packets
* HTTP payloads

HTTP methods inspected:

```python
GET
POST
PUT
DELETE
PATCH
OPTIONS
```

---

# Expected Behavior

The controller should:

1. Detect high SYN rate
2. Enter `SYN_CANDIDATE`
3. Observe HTTP traffic
4. Transition to `HTTP_CANDIDATE`
5. Detect excessive HTTP requests
6. Block the attacker as `HTTP_FLOOD`

---

# Expected Logs

```text
SYN_CANDIDATE -> HTTP_CANDIDATE
HTTP request recibido
ATAQUE DETECTADO tipo=HTTP_FLOOD
```

---

# Port Scan Test

## Execute

```bash
py exec(open('infra/attacks/tests/test_port_scan.py').read())
```

```bash
h5 nmap -sS -p 1-1024 10.1.1.4
```
---



# Detection Method

The controller tracks:

```text
unique destination ports
```

within a time window.

---

# Threshold

```python
PORT_SCAN_THRESHOLD
```

If exceeded:

```text
PORT_SCAN
```

is triggered.

---

# Expected Logs

```text
PortScan ip=...
puertos=...
ATAQUE DETECTADO tipo=PORT_SCAN
```

---

# OpenFlow Mitigation

When an attack is detected:

```python
_trigger_mitigation()
```

installs DROP rules dynamically.

---

# Installed Rule

```python
match = parser.OFPMatch(
    eth_type=ether_types.ETH_TYPE_IP,
    ipv4_src=src_ip,
)
```

Priority:

```python
BLOCK_PRIORITY = 1000
```

---

# Block Expiration

Rules expire automatically:

```python
BLOCK_IDLE_TIMEOUT
```

Default:

```python
120 seconds
```

When expiration occurs:

```text
EventOFPFlowRemoved
```

cleans the internal IP state.

---

# Monitoring

## Grafana

Access:

```text
http://localhost:3000
```

Default credentials:

```text
admin / admin
```

---

## Prometheus

```text
http://localhost:9090
```

---

## Graphite

```text
http://localhost:9000
```

---

# Verification Checklist

## SYN Flood

* [ ] SYN_CANDIDATE state detected
* [ ] Grace period applied
* [ ] No HTTP correlation found
* [ ] DROP rule installed

---

## HTTP Flood

* [ ] HTTP_CANDIDATE transition observed
* [ ] HTTP threshold exceeded
* [ ] HTTP flood blocked correctly

---

## UDP Flood

* [ ] PPS threshold exceeded
* [ ] FlowStats detection triggered
* [ ] DROP rule installed

---

## ICMP Flood

* [ ] FlowStats detection triggered
* [ ] Attacker blocked

---

## Port Scan

* [ ] Unique port tracking working
* [ ] Threshold exceeded
* [ ] Port scanner blocked

---

# Important Notes

## Why use SYN/HTTP correlation?

Without correlation:

```text
HTTP flood traffic may be falsely classified as SYN flood.
```

This occurs because HTTP clients naturally open TCP connections first.

The v8 architecture solves this problem using:

* Grace period
* HTTP correlation
* Stateful classification

---

# Recommended Tools

## SYN Flood

```bash
hping3 -S --flood -p 80 TARGET
```

---

## HTTP Flood

```bash
ab -n 2000 -c 10 -k http://TARGET/
```

or:

```bash
wrk -t4 -c10 -d10s http://TARGET/
```

---

## Port Scan

```bash
nmap -sS -p 1-100 TARGET
```

---




#       Ataque port scan:
Comando:
```bash
h5 nmap -sS -p 1-1024 10.1.1.4

h1 nmap -sS 10.1.1.1/24

py exec(open('infra/attacks/tests/test_port_scan.py').read())
```

#       Ataque http flood: 
Comando:
```bash
py exec(open('infra/attacks/tests/test_http_flood.py').read())

```

#       Ataque SYN flood:
Comando:
```bash
h1 hping3 -S --flood -V -p 80 10.1.1.4


py exec(open('infra/attacks/tests/test_syn_flood.py').read())
```

#       Ataque UDP flood: 
Comando:
```bash
h2 hping3 --udp --flood -V 10.1.1.4


py exec(open('infra/attacks/tests/test_udp_flood.py').read())
```

#       Ataque ICMP flood:
Comando:
```bash
h3 hping3 --icmp --flood 10.1.1.4


py exec(open('infra/attacks/tests/test_icmp_flood.py').read())
```







