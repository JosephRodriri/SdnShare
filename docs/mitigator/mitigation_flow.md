# Mitigation Flow — DDoS Countermeasures

## Overview

The `ddos_mitigator.py` module implements an intelligent DDoS detection and mitigation engine for a Spine-Leaf SDN topology using the Ryu controller and OpenFlow 1.3.

The system combines:

* Flow statistics analysis
* Packet inspection (PacketIn)
* Stateful traffic classification
* Dynamic OpenFlow mitigation rules
* Multi-attack correlation

The mitigation engine detects and blocks:

* SYN Flood
* HTTP Flood
* UDP/ICMP volumetric floods
* Port Scan attacks

---

# Architecture Integration

The mitigation module is integrated into the SDN controller stack:

```text
Mininet Hosts
      │
      ▼
OpenFlow Switches (Spine-Leaf)
      │
      ▼
Ryu Controller
 ├── dc_switch.py
 ├── ddos_mitigator.py
 ├── monitor_influxdb.py
 ├── monitor_graphite.py
 └── monitor_prometheus.py
```

The controller receives:

* Flow statistics from switches
* PacketIn events
* TCP SYN packets
* HTTP payloads

Based on traffic behavior, the module dynamically installs mitigation rules directly into the OpenFlow switches.

---

# Core Detection Strategy

The module uses a hybrid approach:

| Technique           | Purpose                           |
| ------------------- | --------------------------------- |
| FlowStats polling   | Detect volumetric UDP/ICMP floods |
| PacketIn inspection | Detect TCP-based attacks          |
| TCP flag analysis   | Identify SYN floods               |
| HTTP DPI            | Detect HTTP floods                |
| Sliding windows     | Measure rates over time           |
| State machine       | Differentiate attack types        |
| OpenFlow blocking   | Mitigate attackers                |

---

# Main Problem Solved in v8

Earlier versions incorrectly classified HTTP floods as SYN floods.

Example:

```bash
ab -c 200 -n 5000 http://TARGET/
```

This generates:

* many concurrent TCP SYN packets
* followed immediately by valid HTTP requests

The old detector blocked the IP before HTTP traffic arrived.

Result:

```text
HTTP Flood → falsely classified as SYN Flood
```

---

# Solution — Stateful SYN/HTTP Correlation

Version 8 introduces a state machine with a grace period.

Instead of blocking immediately after detecting high SYN rates, the system waits briefly to determine whether legitimate HTTP requests follow the SYN packets.

---

# State Machine

```text
                +----------------+
                |   OBSERVING    |
                +----------------+
                         |
               SYN rate > threshold
                         |
                         ▼
               +------------------+
               |  SYN_CANDIDATE   |
               +------------------+
                  |           |
       HTTP seen  |           | Grace expires
                  |           | and no HTTP
                  ▼           ▼
        +----------------+   BLOCK
        |HTTP_CANDIDATE  |   SYN_FLOOD
        +----------------+
                 |
       HTTP rate > threshold
                 |
                 ▼
              BLOCK
           HTTP_FLOOD
```

---

# Traffic Processing Flow

## 1. Switch Packet Interception

The controller installs interception rules:

### SYN interception

```python
tcp_flags=(0x002, 0x012)
```

Captures:

* SYN packets
* without ACK

Used for:

* SYN Flood detection
* Port Scan detection

---

### HTTP interception

```python
tcp_flags=(0x008, 0x008)
```

Captures:

* PSH packets
* containing HTTP payloads

Used for:

* HTTP Flood detection
* SYN/HTTP correlation

---

# SYN Flood Detection Flow

## Step 1 — Sliding Window

Every SYN packet is stored:

```python
ctx.syn_ts.append(now)
```

Old timestamps outside the window are removed.

---

## Step 2 — Threshold Evaluation

If:

```text
SYN_count >= SYN_FLOOD_THRESHOLD
```

the IP transitions to:

```text
OBSERVING → SYN_CANDIDATE
```

---

## Step 3 — Grace Period

The controller waits:

```text
SYN_GRACE_MS = 100ms
```

during which:

* valid HTTP traffic may arrive
* classification is postponed

---

## Step 4 — Correlation Decision

The ratio is computed:

```text
HTTP/SYN ratio
```

If:

```text
ratio < SYN_HTTP_RATIO_MIN
```

the attack is classified as:

```text
SYN_FLOOD
```

Otherwise:

```text
HTTP_CANDIDATE
```

---

# HTTP Flood Detection Flow

HTTP requests are extracted from TCP payloads.

The module validates:

```python
GET
POST
PUT
DELETE
PATCH
OPTIONS
```

using:

```python
_is_http_request()
```

---

## HTTP Flood Threshold

If:

```text
HTTP_count >= HTTP_FLOOD_THRESHOLD
```

the system blocks the source IP.

---

# Port Scan Detection

Port scans are identified using:

```text
unique destination ports
```

within a time window.

If:

```text
unique_ports >= PORT_SCAN_THRESHOLD
```

the source is blocked.

---

# Volumetric Flood Detection

UDP and ICMP floods are detected using OpenFlow FlowStats.

The controller periodically polls switches:

```python
OFPFlowStatsRequest
```

Packets per second are calculated:

```text
pps = delta_packets / interval
```

If:

```text
pps >= DDOS_THRESH_PPS
```

the attacker is blocked.

---

# Mitigation Engine

Once an attack is confirmed:

```python
_trigger_mitigation()
```

is executed.

---

# OpenFlow Blocking Strategy

A DROP rule is installed:

```python
priority=1000
```

matching:

```python
ipv4_src=attacker_ip
```

No actions are defined:

```python
instructions=[]
```

which means:

```text
DROP all packets
```

---

# Distributed Mitigation

The mitigation rule is installed on:

* all leaf switches
* all spine switches

This guarantees:

* attack isolation
* network-wide enforcement
* fast mitigation

---

# Automatic Expiration

Rules expire automatically:

```text
BLOCK_IDLE_TIMEOUT = 120s
```

When the rule expires:

* the IP is removed from the blocked set
* traffic monitoring restarts
* context is cleaned

---

# Context Management

Each IP has its own context:

```python
IpContext
```

containing:

| Field          | Purpose          |
| -------------- | ---------------- |
| state          | FSM state        |
| syn_ts         | SYN timestamps   |
| http_ts        | HTTP timestamps  |
| portscan_ports | Unique ports     |
| last_seen      | Cleanup tracking |

This centralizes all attack analysis into a single object.

---

# Monitoring Threads

The module runs several concurrent threads:

| Thread              | Purpose                     |
| ------------------- | --------------------------- |
| `_poll_loop`        | FlowStats polling           |
| `_cleanup_loop`     | Remove stale contexts       |
| `_grace_check_loop` | Validate grace expiration   |
| `_stats_loop`       | Periodic statistics logging |

---

# Docker Integration

The mitigation system is configured through environment variables in `docker-compose.yml`.

Example:

```yaml
- DDOS_THRESH_PPS=20000
- DDOS_INTERVAL=2
- DDOS_BLOCK_TIMEOUT=120
- PORT_SCAN_THRESHOLD=10
- HTTP_FLOOD_THRESHOLD=15
```

This allows rapid tuning without modifying source code.

---

# Recommended Laboratory Tests

## SYN Flood

```bash
hping3 -S --flood -p 80 TARGET
```

Expected:

```text
SYN_FLOOD detected
```

---

## HTTP Flood

```bash
ab -n 2000 -c 10 -k http://TARGET/
```

Expected:

```text
HTTP_FLOOD detected
```

without false SYN classification.

---

## Port Scan

```bash
nmap -sS -p 1-100 TARGET
```

Expected:

```text
PORT_SCAN detected
```

---

# Key Improvements in v8

| Improvement                   | Benefit                       |
| ----------------------------- | ----------------------------- |
| State machine                 | Better traffic classification |
| SYN/HTTP correlation          | Prevents false positives      |
| Grace period                  | Allows HTTP validation        |
| Unified IP context            | Cleaner architecture          |
| Concurrent monitoring threads | Better scalability            |
| Dynamic mitigation            | Fast response                 |
| OpenFlow distributed blocking | Network-wide protection       |

---

