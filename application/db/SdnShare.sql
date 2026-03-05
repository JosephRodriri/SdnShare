
-- ============================================================
-- TOPOLOGÍA
-- ============================================================

CREATE TABLE IF NOT EXISTS switches (
                                        id          SERIAL PRIMARY KEY,
                                        switch_id   VARCHAR(50)  NOT NULL UNIQUE,   -- '11','12','21','22','23'
    name        VARCHAR(50)  NOT NULL,           -- 's11','s21'
    switch_type VARCHAR(10)  NOT NULL,           -- 'spine' | 'leaf'
    is_active   BOOLEAN      DEFAULT true,
    last_seen   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ  DEFAULT NOW()
    );

CREATE TABLE IF NOT EXISTS hosts (
                                     id                SERIAL PRIMARY KEY,
                                     name              VARCHAR(50)  NOT NULL UNIQUE,  -- 'h1'..'h6'
    ip                VARCHAR(15)  NOT NULL UNIQUE,  -- '10.1.1.1'
    mac               VARCHAR(17)  NOT NULL UNIQUE,  -- '00:00:00:00:00:01'
    connected_switch  VARCHAR(50)  REFERENCES switches(switch_id),
    connected_port    INT,
    is_active         BOOLEAN      DEFAULT true,
    last_seen         TIMESTAMPTZ,
    created_at        TIMESTAMPTZ  DEFAULT NOW()
    );

-- ============================================================
-- MÉTRICAS
-- ============================================================

CREATE TABLE IF NOT EXISTS port_metrics (
                                            id           BIGSERIAL PRIMARY KEY,
                                            switch_id    VARCHAR(50)  NOT NULL REFERENCES switches(switch_id),
    switch_type  VARCHAR(10)  NOT NULL,           -- 'spine' | 'leaf'
    port_id      INT          NOT NULL,
    tx_bytes     BIGINT       NOT NULL DEFAULT 0,
    rx_bytes     BIGINT       NOT NULL DEFAULT 0,
    tx_packets   BIGINT       NOT NULL DEFAULT 0,
    rx_packets   BIGINT       NOT NULL DEFAULT 0,
    tx_errors    INT          NOT NULL DEFAULT 0,
    rx_errors    INT          NOT NULL DEFAULT 0,
    tx_dropped   INT          NOT NULL DEFAULT 0,
    rx_dropped   INT          NOT NULL DEFAULT 0,
    duration_sec INT          NOT NULL DEFAULT 0,
    timestamp    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_port_metric UNIQUE (switch_id, port_id, timestamp)
    );

CREATE TABLE IF NOT EXISTS flow_metrics (
                                            id            BIGSERIAL PRIMARY KEY,
                                            switch_id     VARCHAR(50)  NOT NULL REFERENCES switches(switch_id),
    table_id      INT          NOT NULL DEFAULT 0,
    eth_dst       VARCHAR(17),                    -- MAC destino
    dest          VARCHAR(50),                    -- 'controller' | 'host'
    packet_count  BIGINT       NOT NULL DEFAULT 0,
    byte_count    BIGINT       NOT NULL DEFAULT 0,
    timestamp     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_flow_metric UNIQUE (switch_id, table_id, eth_dst, timestamp)
    );

-- ============================================================
-- ANOMALÍAS Y ALERTAS
-- ============================================================

CREATE TABLE IF NOT EXISTS anomalies (
                                         id              BIGSERIAL PRIMARY KEY,
                                         anomaly_type    VARCHAR(50)  NOT NULL,   -- 'DDOS','PACKET_LOSS','HIGH_TRAFFIC'
    severity        VARCHAR(20)  NOT NULL,   -- 'LOW','MEDIUM','HIGH','CRITICAL'
    switch_id       VARCHAR(50)  REFERENCES switches(switch_id),
    port_id         INT,
    host_name       VARCHAR(10),             -- 'h1'..'h6'
    rx_pps          INT,                     -- paquetes/seg recibidos
    tx_pps          INT,                     -- paquetes/seg enviados
    metric_value    FLOAT,
    threshold       FLOAT,
    details         JSONB,
    detected_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ,
    resolved_by     VARCHAR(100),            -- 'auto' | 'admin'
    resolution_note TEXT
    );

CREATE TABLE IF NOT EXISTS alert_rules (
                                           id           BIGSERIAL PRIMARY KEY,
                                           name         VARCHAR(255) NOT NULL UNIQUE,
    description  TEXT,
    metric_type  VARCHAR(50)  NOT NULL,      -- 'tx_bytes','rx_packets', etc.
    operator     VARCHAR(10)  NOT NULL,      -- '>','<','>=','<='
    threshold    FLOAT        NOT NULL,
    duration_sec INT          NOT NULL DEFAULT 60,
    severity     VARCHAR(20)  NOT NULL DEFAULT 'MEDIUM',
    applies_to   VARCHAR(20)  DEFAULT 'ALL', -- 'ALL','SPINE','LEAF','HOST'
    target_id    VARCHAR(50),                -- switch o host específico
    enabled      BOOLEAN      DEFAULT true,
    created_at   TIMESTAMPTZ  DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  DEFAULT NOW()
    );

CREATE TABLE IF NOT EXISTS events (
                                      id             BIGSERIAL PRIMARY KEY,
                                      event_type     VARCHAR(50)  NOT NULL,  -- 'ALERT','ANOMALY','TOPOLOGY_CHANGE'
    source         VARCHAR(100) NOT NULL,  -- 'ryu','springboot','grafana'
    message        TEXT         NOT NULL,
    severity       VARCHAR(20),
    related_switch VARCHAR(50)  REFERENCES switches(switch_id),
    related_port   INT,
    related_host   VARCHAR(10),
    metadata       JSONB,
    created_at     TIMESTAMPTZ  DEFAULT NOW()
    );

-- ============================================================
-- ÍNDICES
-- ============================================================

-- port_metrics
CREATE INDEX IF NOT EXISTS idx_pm_switch_time  ON port_metrics (switch_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_pm_port_time    ON port_metrics (port_id,   timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_pm_timestamp    ON port_metrics (timestamp  DESC);

-- flow_metrics
CREATE INDEX IF NOT EXISTS idx_fm_switch_time  ON flow_metrics (switch_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_fm_timestamp    ON flow_metrics (timestamp  DESC);

-- anomalies
CREATE INDEX IF NOT EXISTS idx_an_type_time    ON anomalies (anomaly_type, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_an_severity     ON anomalies (severity);
CREATE INDEX IF NOT EXISTS idx_an_unresolved   ON anomalies (resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_an_switch       ON anomalies (switch_id);

-- events
CREATE INDEX IF NOT EXISTS idx_ev_type_time    ON events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ev_source       ON events (source);

-- ============================================================
-- DATOS INICIALES - Topología del lab
-- ============================================================

INSERT INTO switches (switch_id, name, switch_type) VALUES
                                                        ('11', 's11', 'spine'),
                                                        ('12', 's12', 'spine'),
                                                        ('21', 's21', 'leaf'),
                                                        ('22', 's22', 'leaf'),
                                                        ('23', 's23', 'leaf')
    ON CONFLICT (switch_id) DO NOTHING;

INSERT INTO hosts (name, ip, mac, connected_switch, connected_port) VALUES
                                                                        ('h1', '10.1.1.1', '00:00:00:00:00:01', '21', 3),
                                                                        ('h2', '10.1.1.2', '00:00:00:00:00:02', '21', 4),
                                                                        ('h3', '10.1.1.3', '00:00:00:00:00:03', '22', 3),
                                                                        ('h4', '10.1.1.4', '00:00:00:00:00:04', '22', 4),
                                                                        ('h5', '10.1.1.5', '00:00:00:00:00:05', '23', 3),
                                                                        ('h6', '10.1.1.6', '00:00:00:00:00:06', '23', 4)
    ON CONFLICT (name) DO NOTHING;

INSERT INTO alert_rules (name, description, metric_type, operator, threshold, duration_sec, severity, applies_to) VALUES
                                                                                                                      ('DDoS crítico',       'Tráfico RX supera 1000 pps',  'rx_pps',    '>',  1000, 30,  'CRITICAL', 'ALL'),
                                                                                                                      ('Tráfico alto',       'Tráfico RX supera 500 pps',   'rx_pps',    '>',  500,  60,  'HIGH',     'ALL'),
                                                                                                                      ('Errores TX spine',   'Errores TX en spines',        'tx_errors', '>',  100,  120, 'MEDIUM',   'SPINE'),
                                                                                                                      ('Paquetes perdidos',  'Dropped packets excesivos',   'tx_dropped','>',  50,   60,  'HIGH',     'ALL')
    ON CONFLICT (name) DO NOTHING;