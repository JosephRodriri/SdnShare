package com.example.SdnShare.repository;

import com.example.SdnShare.model.Switch;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;


@Repository
public interface SwitchRepository extends JpaRepository<Switch, Long> {
    Optional<Switch> findBySwitchId(String switchId);
    List<Switch> findBySwitchType(String switchType);
    List<Switch> findByIsActiveTrue();
}

