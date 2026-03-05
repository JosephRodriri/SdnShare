package com.example.SdnShare.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.OffsetDateTime;

@Entity
@Table(name = "alert_rules")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AlertRule {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String name;

    private String description;

    @Column(name = "metric_type", nullable = false)
    private String metricType;         // "tx_bytes", "rx_packets", "rx_pps"

    @Column(nullable = false)
    private String operator;           // ">", "<", ">=", "<="

    @Column(nullable = false)
    private Double threshold;

    @Column(name = "duration_sec")
    private Integer durationSec = 60;

    @Column(nullable = false)
    private String severity = "MEDIUM";

    @Column(name = "applies_to")
    private String appliesTo = "ALL";  // "ALL", "SPINE", "LEAF", "HOST"

    @Column(name = "target_id")
    private String targetId;           // switch_id o host name específico

    private Boolean enabled = true;

    @Column(name = "created_at")
    private OffsetDateTime createdAt = OffsetDateTime.now();

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt = OffsetDateTime.now();

    @PreUpdate
    public void preUpdate() {
        this.updatedAt = OffsetDateTime.now();
    }
}