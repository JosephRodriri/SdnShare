package com.example.SdnShare.model;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.time.OffsetDateTime;
import java.util.Map;

@Entity
@Table(name = "anomalies")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Anomaly {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "anomaly_type", nullable = false)
    private String anomalyType;        // "DDOS", "PACKET_LOSS", "HIGH_TRAFFIC"

    @Column(nullable = false)
    private String severity;           // "LOW", "MEDIUM", "HIGH", "CRITICAL"

    @Column(name = "switch_id")
    private String switchId;

    @Column(name = "port_id")
    private Integer portId;

    @Column(name = "host_name")
    private String hostName;           // "h1".."h6"

    @Column(name = "rx_pps")
    private Integer rxPps;

    @Column(name = "tx_pps")
    private Integer txPps;

    @Column(name = "metric_value")
    private Double metricValue;

    @Column(name = "threshold")
    private Double threshold;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> details;

    @Column(name = "detected_at", nullable = false)
    private OffsetDateTime detectedAt = OffsetDateTime.now();

    @Column(name = "resolved_at")
    private OffsetDateTime resolvedAt;

    @Column(name = "resolved_by")
    private String resolvedBy;         // "auto" | "admin"

    @Column(name = "resolution_note")
    private String resolutionNote;

    public boolean isResolved() {
        return resolvedAt != null;
    }
}