/*DROP TABLE IF EXISTS 
  events,
  alert_rules,
  anomalies,
  flow_metrics,
  port_metrics,
  hosts,
  switches
CASCADE;
*/

-- TOPOLOGÍA

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
    connected_switch  VARCHAR(50),
    connected_port    INT,
    is_active         BOOLEAN      DEFAULT true,
    last_seen         TIMESTAMPTZ,
    created_at        TIMESTAMPTZ  DEFAULT NOW()
    );


select*from hosts;
-- MÉTRICAS


CREATE TABLE IF NOT EXISTS port_metrics (
                                            id           BIGSERIAL PRIMARY KEY,
                                            switch_id    VARCHAR(50)  NOT NULL,
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
                                            switch_id     VARCHAR(50)  NOT NULL,
    table_id      INT          NOT NULL DEFAULT 0,
    eth_dst       VARCHAR(17),                    -- MAC destino
    dest          VARCHAR(50),                    -- 'controller' | 'host'
    packet_count  BIGINT       NOT NULL DEFAULT 0,
    byte_count    BIGINT       NOT NULL DEFAULT 0,
    timestamp     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_flow_metric UNIQUE (switch_id, table_id, eth_dst, timestamp)

    );



-- ANOMALÍAS Y ALERTAS


CREATE TABLE IF NOT EXISTS anomalies (
                                         id              BIGSERIAL PRIMARY KEY,
                                         anomaly_type    VARCHAR(50)  NOT NULL,   -- 'DDOS','PACKET_LOSS','HIGH_TRAFFIC'
    severity        VARCHAR(20)  NOT NULL,   -- 'LOW','MEDIUM','HIGH','CRITICAL'
    switch_id       VARCHAR(50),
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
    related_switch VARCHAR(50),
    related_port   INT,
    related_host   VARCHAR(10),
    metadata       JSONB,
    created_at     TIMESTAMPTZ  DEFAULT NOW()
    );




--- Relaciones

-- Hosts -> Switches
ALTER TABLE hosts ADD CONSTRAINT fk_hosts_switch FOREIGN KEY (connected_switch) REFERENCES switches(switch_id);


-- Port metrics -> Switches
ALTER TABLE port_metrics ADD CONSTRAINT fk_port_metrics_switch FOREIGN KEY (switch_id) REFERENCES switches(switch_id);


-- Flow metrics -> Switches
ALTER TABLE flow_metrics  ADD CONSTRAINT fk_flow_metrics_switch FOREIGN KEY (switch_id) REFERENCES switches(switch_id);


-- Anomalies -> Switches
ALTER TABLE anomalies ADD CONSTRAINT fk_anomalies_switch FOREIGN KEY (switch_id) REFERENCES switches(switch_id);


-- Events -> Switches
ALTER TABLE events ADD CONSTRAINT fk_events_switch FOREIGN KEY (related_switch) REFERENCES switches(switch_id);

-- INDICES

-- TOPOLOGÍA
CREATE INDEX idx_switches_switch_id ON switches(switch_id);
CREATE INDEX idx_switches_type ON switches(switch_type);
CREATE INDEX idx_switches_is_active ON switches(is_active);

-- MÉTRICAS

CREATE INDEX idx_port_metrics_switch ON port_metrics(switch_id);
CREATE INDEX idx_port_metrics_timestamp ON port_metrics(timestamp DESC);
CREATE INDEX idx_port_metrics_switch_timestamp ON port_metrics(switch_id, timestamp DESC);
CREATE INDEX idx_port_metrics_port_id ON port_metrics(port_id);

-- flow_metrics
CREATE INDEX idx_flow_metrics_switch ON flow_metrics(switch_id);
CREATE INDEX idx_flow_metrics_timestamp ON flow_metrics(timestamp DESC);
CREATE INDEX idx_flow_metrics_eth_dst ON flow_metrics(eth_dst);
CREATE INDEX idx_flow_metrics_table_id ON flow_metrics(table_id);

-- ANOMALÍAS Y ALERTAS

CREATE INDEX idx_anomalies_switch ON anomalies(switch_id);
CREATE INDEX idx_anomalies_detected_at ON anomalies(detected_at DESC);
CREATE INDEX idx_anomalies_severity ON anomalies(severity);
CREATE INDEX idx_anomalies_type ON anomalies(anomaly_type);
CREATE INDEX idx_anomalies_unresolved ON anomalies(resolved_at) WHERE resolved_at IS NULL;


-- alert_rules
CREATE INDEX idx_alert_rules_enabled ON alert_rules(enabled);
CREATE INDEX idx_alert_rules_applies_to ON alert_rules(applies_to);
CREATE INDEX idx_alert_rules_name ON alert_rules(name);


-- events

CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_source ON events(source);
CREATE INDEX idx_events_created_at ON events(created_at DESC);
CREATE INDEX idx_events_severity ON events(severity);
CREATE INDEX idx_events_related_switch ON events(related_switch);



SELECT switch_id, COUNT(*) as registros
FROM port_metrics
GROUP BY switch_id
ORDER BY switch_id;


-- VIEWS (vistas)
-- Vista: Topología actual (switches activos y sus hosts)
CREATE OR REPLACE VIEW v_topology_summary AS
SELECT
    s.switch_id,
    s.name,
    s.switch_type,
    s.is_active,
    COUNT(h.id) as host_count,
    STRING_AGG(h.name, ', ' ORDER BY h.name) as connected_hosts,
    MAX(s.last_seen) as last_activity
FROM
    switches s
        LEFT JOIN
    hosts h ON s.switch_id = h.connected_switch AND h.is_active = true
GROUP BY
    s.switch_id, s.name, s.switch_type, s.is_active
ORDER BY
    s.switch_type DESC, s.switch_id;

select*from v_topology_summary;

-- Vista: Anomalías activas (sin resolver)
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
FROM
    anomalies
WHERE
    resolved_at IS NULL
ORDER BY
    severity DESC, detected_at DESC;


-- Vista: Tráfico actual por switch (últimas métricas)
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
FROM
    port_metrics
ORDER BY
    switch_id, port_id, timestamp DESC;


select*from v_latest_port_traffic;



-- 7. COMENTARIOS DE DOCUMENTACIÓN


COMMENT ON TABLE switches IS 'Tabla maestra de switches SDN (spine y leaf)';
COMMENT ON TABLE hosts IS 'Servidores y máquinas virtuales conectadas a leafs';
COMMENT ON TABLE port_metrics IS 'Serie temporal de métricas de puertos (histórico)';
COMMENT ON TABLE flow_metrics IS 'Estadísticas OpenFlow por tabla y MAC destino';
COMMENT ON TABLE anomalies IS 'Registro de anomalías detectadas (ciclo de vida completo)';
COMMENT ON TABLE alert_rules IS 'Reglas configurables para motor de alertas';
COMMENT ON TABLE events IS 'Log de auditoría central de todos los eventos';



-- DATOS INICIALES - Topología del lab


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





ALTER TABLE switches
ALTER COLUMN id TYPE BIGINT;

ALTER TABLE hosts
ALTER COLUMN id TYPE BIGINT;

DROP VIEW v_topology_summary;




ALTER TABLE port_metrics
ALTER COLUMN tx_errors TYPE BIGINT,
    ALTER COLUMN rx_errors TYPE BIGINT,
    ALTER COLUMN tx_dropped TYPE BIGINT,
    ALTER COLUMN rx_dropped TYPE BIGINT;
