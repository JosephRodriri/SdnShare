
---

# Data Dictionary - SDN Database

**Last update:** 2024
**System:** SDN Network Monitoring and Alerts
**Database Type:** PostgreSQL

---

# Table of Contents

1. [Tables](#tables)
2. [Views](#views)
3. [Indexes](#indexes)
4. [Relationships](#relationships)
5. [Data Types](#data-types)

---

# TABLES

## 1. **switches**

**Description:** Master table for SDN switches (spine and leaf).

| Column      | Type        | Description                       | Required | Constraints                               |
| ----------- | ----------- | --------------------------------- | -------- | ----------------------------------------- |
| id          | BIGINT      | Unique identifier                 | Yes      | PRIMARY KEY, Auto-generated               |
| switch_id   | VARCHAR(50) | Switch identifier                 | Yes      | UNIQUE (values: '11','12','21','22','23') |
| name        | VARCHAR(50) | Switch name                       | Yes      | Example: 's11', 's21'                     |
| switch_type | VARCHAR(10) | Type of switch                    | Yes      | 'spine' | 'leaf'                          |
| is_active   | BOOLEAN     | Indicates if the switch is active | No       | DEFAULT: true                             |
| last_seen   | TIMESTAMPTZ | Last time the switch was detected | No       | NULL allowed                              |
| created_at  | TIMESTAMPTZ | Creation timestamp                | No       | DEFAULT: NOW()                            |

**Indexes**

* `idx_switches_switch_id` – Search by switch ID
* `idx_switches_type` – Filter by switch type
* `idx_switches_is_active` – Active switches

---

## 2. **hosts**

**Description:** Servers and virtual machines connected to leaf switches.

| Column           | Type        | Description                        | Required | Constraints                          |
| ---------------- | ----------- | ---------------------------------- | -------- | ------------------------------------ |
| id               | BIGINT      | Unique identifier                  | Yes      | PRIMARY KEY, Auto-generated          |
| name             | VARCHAR(50) | Host name                          | Yes      | UNIQUE (values: 'h1'..'h6')          |
| ip               | VARCHAR(15) | IP address                         | Yes      | UNIQUE (format: '10.1.1.1')          |
| mac              | VARCHAR(17) | MAC address                        | Yes      | UNIQUE (format: '00:00:00:00:00:01') |
| connected_switch | VARCHAR(50) | Switch where the host is connected | No       | FK → switches(switch_id)             |
| connected_port   | INT         | Switch port number                 | No       | Example: 3, 4                        |
| is_active        | BOOLEAN     | Indicates if the host is active    | No       | DEFAULT: true                        |
| last_seen        | TIMESTAMPTZ | Last detected activity             | No       | NULL allowed                         |
| created_at       | TIMESTAMPTZ | Creation timestamp                 | No       | DEFAULT: NOW()                       |

**Relationship**

* FK: `fk_hosts_switch` → switches(switch_id)

---

## 3. **port_metrics**

**Description:** Time-series port metrics (historical data).

| Column       | Type        | Description          | Required | Constraints                 |
| ------------ | ----------- | -------------------- | -------- | --------------------------- |
| id           | BIGSERIAL   | Unique identifier    | Yes      | PRIMARY KEY, Auto-generated |
| switch_id    | VARCHAR(50) | Switch identifier    | Yes      | FK → switches(switch_id)    |
| switch_type  | VARCHAR(10) | Switch type          | Yes      | 'spine' | 'leaf'            |
| port_id      | INT         | Port number          | Yes      | Port identifier             |
| tx_bytes     | BIGINT      | Transmitted bytes    | No       | DEFAULT: 0                  |
| rx_bytes     | BIGINT      | Received bytes       | No       | DEFAULT: 0                  |
| tx_packets   | BIGINT      | Transmitted packets  | No       | DEFAULT: 0                  |
| rx_packets   | BIGINT      | Received packets     | No       | DEFAULT: 0                  |
| tx_errors    | INT         | Transmission errors  | No       | DEFAULT: 0                  |
| rx_errors    | INT         | Reception errors     | No       | DEFAULT: 0                  |
| tx_dropped   | INT         | Dropped packets (TX) | No       | DEFAULT: 0                  |
| rx_dropped   | INT         | Dropped packets (RX) | No       | DEFAULT: 0                  |
| duration_sec | INT         | Duration in seconds  | No       | DEFAULT: 0                  |
| timestamp    | TIMESTAMPTZ | Metric timestamp     | Yes      | DEFAULT: NOW()              |

**Unique Constraint**

* UNIQUE: (switch_id, port_id, timestamp)

**Indexes**

* `idx_port_metrics_switch` – Search by switch
* `idx_port_metrics_timestamp` – Time ordering (DESC)
* `idx_port_metrics_switch_timestamp` – Switch + timestamp composite index
* `idx_port_metrics_port_id` – Search by port

**Relationship**

* FK: `fk_port_metrics_switch` → switches(switch_id)

---

## 4. **flow_metrics**

**Description:** OpenFlow statistics by table and destination MAC.

| Column       | Type        | Description             | Required | Constraints                 |
| ------------ | ----------- | ----------------------- | -------- | --------------------------- |
| id           | BIGSERIAL   | Unique identifier       | Yes      | PRIMARY KEY                 |
| switch_id    | VARCHAR(50) | Switch identifier       | Yes      | FK → switches(switch_id)    |
| table_id     | INT         | OpenFlow table ID       | No       | DEFAULT: 0                  |
| eth_dst      | VARCHAR(17) | Destination MAC address | No       | Format: '00:00:00:00:00:01' |
| dest         | VARCHAR(50) | Flow destination        | No       | 'controller' | 'host'       |
| packet_count | BIGINT      | Packet count            | No       | DEFAULT: 0                  |
| byte_count   | BIGINT      | Byte count              | No       | DEFAULT: 0                  |
| timestamp    | TIMESTAMPTZ | Timestamp               | Yes      | DEFAULT: NOW()              |

**Unique Constraint**

* UNIQUE: (switch_id, table_id, eth_dst, timestamp)

**Indexes**

* `idx_flow_metrics_switch`
* `idx_flow_metrics_timestamp`
* `idx_flow_metrics_eth_dst`
* `idx_flow_metrics_table_id`

**Relationship**

* FK: `fk_flow_metrics_switch` → switches(switch_id)

---

## 5. **anomalies**

**Description:** Detected anomalies registry (full lifecycle tracking).

| Column          | Type         | Description                    | Required | Constraints                             |
| --------------- | ------------ | ------------------------------ | -------- | --------------------------------------- |
| id              | BIGSERIAL    | Unique identifier              | Yes      | PRIMARY KEY                             |
| anomaly_type    | VARCHAR(50)  | Type of anomaly                | Yes      | 'DDOS' | 'PACKET_LOSS' | 'HIGH_TRAFFIC' |
| severity        | VARCHAR(20)  | Severity level                 | Yes      | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'  |
| switch_id       | VARCHAR(50)  | Affected switch                | No       | FK → switches                           |
| port_id         | INT          | Affected port                  | No       | NULL allowed                            |
| host_name       | VARCHAR(10)  | Affected host                  | No       | 'h1'..'h6'                              |
| rx_pps          | INT          | Received packets per second    | No       | NULL allowed                            |
| tx_pps          | INT          | Transmitted packets per second | No       | NULL allowed                            |
| metric_value    | FLOAT        | Metric value                   | No       | NULL allowed                            |
| threshold       | FLOAT        | Threshold exceeded             | No       | NULL allowed                            |
| details         | JSONB        | Additional details             | No       | JSON format                             |
| detected_at     | TIMESTAMPTZ  | Detection timestamp            | Yes      | DEFAULT: NOW()                          |
| resolved_at     | TIMESTAMPTZ  | Resolution timestamp           | No       | NULL = active anomaly                   |
| resolved_by     | VARCHAR(100) | Resolved by                    | No       | 'auto' | 'admin'                        |
| resolution_note | TEXT         | Resolution notes               | No       | NULL allowed                            |

---

# VIEWS

## 1. **v_topology_summary**

**Description:** Current network topology (active switches and connected hosts).

```sql
CREATE OR REPLACE VIEW v_topology_summary AS
SELECT
    s.switch_id,
    s.name,
    s.switch_type,
    s.is_active,
    COUNT(h.id) as host_count,
    STRING_AGG(h.name, ', ' ORDER BY h.name) as connected_hosts,
    MAX(s.last_seen) as last_activity
FROM switches s
LEFT JOIN hosts h ON s.switch_id = h.connected_switch AND h.is_active = true
GROUP BY s.switch_id, s.name, s.switch_type, s.is_active
ORDER BY s.switch_type DESC, s.switch_id;
```

Use case: Network topology dashboard and quick network overview.

---

## 2. **v_active_anomalies**

**Description:** Active anomalies (not resolved).

```sql
CREATE OR REPLACE VIEW v_active_anomalies AS
SELECT
    id,
    anomaly_type,
    severity,
    switch_id,
    port_id,
    host_name,
    metric_value,
    threshold,
    detected_at,
    EXTRACT(EPOCH FROM (NOW() - detected_at)) / 3600 as hours_since_detection
FROM anomalies
WHERE resolved_at IS NULL
ORDER BY severity DESC, detected_at DESC;
```

Use case: Real-time monitoring and alert center.

---

## 3. **v_latest_port_traffic**

**Description:** Latest port traffic metrics per switch.

```sql
CREATE OR REPLACE VIEW v_latest_port_traffic AS
SELECT DISTINCT ON (switch_id, port_id)
    switch_id,
    switch_type,
    port_id,
    rx_bytes,
    tx_bytes,
    rx_packets,
    tx_packets,
    rx_errors,
    tx_errors,
    rx_dropped,
    tx_dropped,
    timestamp
FROM port_metrics
ORDER BY switch_id, port_id, timestamp DESC;
```

Use case: Traffic monitoring dashboards and performance analysis.

---

# INDEXES

| Table        | Index Name                 | Columns         | Purpose                  |
| ------------ | -------------------------- | --------------- | ------------------------ |
| switches     | idx_switches_switch_id     | switch_id       | Fast search by switch ID |
| switches     | idx_switches_type          | switch_type     | Filter by switch type    |
| switches     | idx_switches_is_active     | is_active       | Active switches          |
| port_metrics | idx_port_metrics_switch    | switch_id       | Metrics per switch       |
| port_metrics | idx_port_metrics_timestamp | timestamp DESC  | Temporal ordering        |
| anomalies    | idx_anomalies_severity     | severity        | Filter by severity       |
| events       | idx_events_created_at      | created_at DESC | Recent events            |

---

# RELATIONSHIPS (Foreign Keys)

| Source Table | FK Name                | Source Column    | Target Table | Target Column |
| ------------ | ---------------------- | ---------------- | ------------ | ------------- |
| hosts        | fk_hosts_switch        | connected_switch | switches     | switch_id     |
| port_metrics | fk_port_metrics_switch | switch_id        | switches     | switch_id     |
| flow_metrics | fk_flow_metrics_switch | switch_id        | switches     | switch_id     |
| anomalies    | fk_anomalies_switch    | switch_id        | switches     | switch_id     |
| events       | fk_events_switch       | related_switch   | switches     | switch_id     |

---

# DATA TYPES

## Numeric Types

* **INT** – 32-bit integer
* **BIGINT** – 64-bit integer
* **BIGSERIAL** – BIGINT with auto-increment
* **FLOAT** – Floating point number

## Text Types

* **VARCHAR(n)** – Variable-length string
* **TEXT** – Unlimited-length string

## Temporal Types

* **TIMESTAMPTZ** – Timestamp with time zone

## Special Types

* **BOOLEAN** – true/false
* **JSONB** – Binary JSON optimized for queries
* **SERIAL** – Auto-increment integer

---

# IMPORTANT NOTES

## Naming Conventions

* **Tables:** plural and lowercase (`switches`, `hosts`)
* **Columns:** snake_case (`switch_id`, `created_at`)
* **Indexes:** prefix `idx_`
* **Foreign Keys:** prefix `fk_`

## Data Conventions

* **Switch IDs:** `'11','12','21','22','23'`
* **Host IDs:** `'h1'..'h6'`
* **IP addresses:** `'10.1.1.1'`
* **MAC addresses:** `'00:00:00:00:00:01'`
* **Timestamps:** `TIMESTAMPTZ`

---

