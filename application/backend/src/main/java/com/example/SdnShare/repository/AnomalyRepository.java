package com.example.SdnShare.repository;

import com.example.SdnShare.model.Anomaly;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;


@Repository
public interface AnomalyRepository extends JpaRepository<Anomaly, Long> {

    // Anomalías no resueltas
    List<Anomaly> findByResolvedAtIsNullOrderByDetectedAtDesc();

    // Por severidad sin resolver
    List<Anomaly> findBySeverityAndResolvedAtIsNullOrderByDetectedAtDesc(String severity);

    // Por switch
    List<Anomaly> findBySwitchIdOrderByDetectedAtDesc(String switchId);

    // Por host
    List<Anomaly> findByHostNameOrderByDetectedAtDesc(String hostName);

    // Historial en rango de tiempo
    @Query("SELECT a FROM Anomaly a WHERE a.detectedAt BETWEEN :from AND :to " +
            "ORDER BY a.detectedAt DESC")
    List<Anomaly> findByDateRange(
            @Param("from") OffsetDateTime from,
            @Param("to") OffsetDateTime to);

    // Conteo por tipo en últimas N horas
    @Query("SELECT a.anomalyType, COUNT(a) FROM Anomaly a " +
            "WHERE a.detectedAt >= :since GROUP BY a.anomalyType")
    List<Object[]> countByTypeSince(@Param("since") OffsetDateTime since);

    long countByResolvedAtIsNull();
}