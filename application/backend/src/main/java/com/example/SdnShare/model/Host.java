package com.example.SdnShare.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.OffsetDateTime;

@Entity
@Table(name = "hosts")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Host {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String name;               // "h1".."h6"

    @Column(nullable = false, unique = true)
    private String ip;                 // "10.1.1.1"

    @Column(nullable = false, unique = true)
    private String mac;                // "00:00:00:00:00:01"

    @Column(name = "connected_switch")
    private String connectedSwitch;    // switch_id

    @Column(name = "connected_port")
    private Integer connectedPort;

    @Column(name = "is_active")
    private Boolean isActive = true;

    @Column(name = "last_seen")
    private OffsetDateTime lastSeen;

    @Column(name = "created_at")
    private OffsetDateTime createdAt = OffsetDateTime.now();
}