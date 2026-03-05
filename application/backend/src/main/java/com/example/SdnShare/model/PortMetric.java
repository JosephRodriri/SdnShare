package com.example.SdnShare.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.OffsetDateTime;

@Entity
@Table(name = "port_metrics")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PortMetric {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "switch_id", nullable = false)
    private String switchId;

    @Column(name = "switch_type", nullable = false)
    private String switchType;         // "spine" | "leaf"

    @Column(name = "port_id", nullable = false)
    private Integer portId;

    @Column(name = "tx_bytes")
    private Long txBytes = 0L;

    @Column(name = "rx_bytes")
    private Long rxBytes = 0L;

    @Column(name = "tx_packets")
    private Long txPackets = 0L;

    @Column(name = "rx_packets")
    private Long rxPackets = 0L;

    @Column(name = "tx_errors")
    private Integer txErrors = 0;

    @Column(name = "rx_errors")
    private Integer rxErrors = 0;

    @Column(name = "tx_dropped")
    private Integer txDropped = 0;

    @Column(name = "rx_dropped")
    private Integer rxDropped = 0;

    @Column(name = "duration_sec")
    private Integer durationSec = 0;

    @Column(nullable = false)
    private OffsetDateTime timestamp = OffsetDateTime.now();
}