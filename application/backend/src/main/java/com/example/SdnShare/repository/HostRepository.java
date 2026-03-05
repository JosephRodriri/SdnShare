package com.example.SdnShare.repository;


import com.example.SdnShare.model.Host;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface HostRepository extends JpaRepository<Host, Long> {
    Optional<Host> findByName(String name);
    Optional<Host> findByMac(String mac);
    List<Host> findByConnectedSwitch(String switchId);
    List<Host> findByIsActiveTrue();
}