package com.example.SdnShare.repository;


import com.example.SdnShare.model.PortMetric;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;


@Repository
public interface PortMetricRepository extends JpaRepository<PortMetric, Long> {

    List<PortMetric> findBySwitchIdOrderByTimestampDesc(String switchId);

    List<PortMetric> findBySwitchIdAndPortIdAndTimestampBetweenOrderByTimestampDesc(
            String switchId, Integer portId,
            OffsetDateTime from, OffsetDateTime to);

    @Query("SELECT p FROM PortMetric p WHERE p.switchId = :switchId " +
            "AND p.timestamp >= :from ORDER BY p.timestamp DESC")
    List<PortMetric> findRecentBySwitchId(
            @Param("switchId") String switchId,
            @Param("from") OffsetDateTime from);

    @Query("SELECT p FROM PortMetric p WHERE p.timestamp >= :from " +
            "ORDER BY p.timestamp DESC")
    List<PortMetric> findAllSince(@Param("from") OffsetDateTime from);

    // Último registro por switch y puerto
    Optional<PortMetric> findTopBySwitchIdAndPortIdOrderByTimestampDesc(
            String switchId, Integer portId);
}

