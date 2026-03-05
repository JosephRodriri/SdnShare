package com.example.SdnShare.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.OffsetDateTime;


@Entity
@Table(name = "switches")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Switch {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "switch_id", nullable = false, unique = true)
    private String switchId;           // "11", "12", "21", "22", "23"

    @Column(nullable = false)
    private String name;               // "s11", "s21"

    @Column(name = "switch_type", nullable = false)
    private String switchType;         // "spine" | "leaf"

    @Column(name = "is_active")
    private Boolean isActive = true;

    @Column(name = "last_seen")
    private OffsetDateTime lastSeen;

    @Column(name = "created_at")
    private OffsetDateTime createdAt = OffsetDateTime.now();
}