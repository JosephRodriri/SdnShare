package com.example.SdnShare.controller;

import com.example.SdnShare.model.Anomaly;
import com.example.SdnShare.repository.AnomalyRepository;
import com.example.SdnShare.service.impl.AnomalyDetectionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/anomalies")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
class AnomalyController {

    private final AnomalyRepository anomalyRepository;
    private final AnomalyDetectionService detectionService;


    // lista de todas las anomalias activas
    @GetMapping
    public List<Anomaly> getAll(
            @RequestParam(required = false) String severity,
            @RequestParam(defaultValue = "false") boolean unresolvedOnly) {


        if (unresolvedOnly) {
            return severity != null
                    ? anomalyRepository.findBySeverityAndResolvedAtIsNullOrderByDetectedAtDesc(severity)
                    : anomalyRepository.findByResolvedAtIsNullOrderByDetectedAtDesc();
        }
        return anomalyRepository.findAll();
    }


    // por switch
    @GetMapping("/switch/{switchId}")
    public List<Anomaly> getBySwitchId(@PathVariable String switchId) {
        return anomalyRepository.findBySwitchIdOrderByDetectedAtDesc(switchId);
    }

    // Por host (h1..h6)
    @GetMapping("/host/{hostName}")
    public List<Anomaly> getByHost(@PathVariable String hostName) {
        return anomalyRepository.findByHostNameOrderByDetectedAtDesc(hostName);
    }

    //Estadísticas 24h
    @GetMapping("/stats")
    public Map<String, Object> getStats() {
        OffsetDateTime since = OffsetDateTime.now().minusHours(24);
        List<Object[]> byType = anomalyRepository.countByTypeSince(since);
        long unresolved = anomalyRepository.countByResolvedAtIsNull();
        return Map.of(
                "unresolved", unresolved,
                "byType24h", byType
        );
    }

    // Resolver anomalía
    @PatchMapping("/{id}/resolve")
    public ResponseEntity<Anomaly> resolve(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {

        return detectionService
                .resolveAnomaly(id, body.get("resolvedBy"), body.get("note"))
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }
}
