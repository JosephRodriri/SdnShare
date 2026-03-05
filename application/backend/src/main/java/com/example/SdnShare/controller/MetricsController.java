package com.example.SdnShare.controller;

import com.example.SdnShare.model.PortMetric;
import com.example.SdnShare.repository.PortMetricRepository;
import com.example.SdnShare.service.MetricsCollectorService;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/metrics")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
class MetricsController {

    private final PortMetricRepository portMetricRepository;
    private final MetricsCollectorService collectorService;

    //  Metricas de un switch
    @GetMapping("/ports/{switchId}")
    public List<PortMetric> getPortMetrics(
            @PathVariable String switchId,
            @RequestParam(defaultValue = "30") int minutes) {

        OffsetDateTime since = OffsetDateTime.now().minusMinutes(minutes);
        return portMetricRepository.findRecentBySwitchId(switchId, since);
    }

    // Historial con rango de fechas
    @GetMapping("/ports/{switchId}/{portId}")
    public List<PortMetric> getPortHistory(
            @PathVariable String switchId,
            @PathVariable Integer portId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime to) {

        return portMetricRepository
                .findBySwitchIdAndPortIdAndTimestampBetweenOrderByTimestampDesc(
                        switchId, portId, from, to);
    }

    // Último valor
    @GetMapping("/ports/{switchId}/{portId}/latest")
    public ResponseEntity<PortMetric> getLatestMetric(
            @PathVariable String switchId,
            @PathVariable Integer portId) {

        return portMetricRepository
                .findTopBySwitchIdAndPortIdOrderByTimestampDesc(switchId, portId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    // Endpoint para que Ryu haga POST con métricas directamente
    @PostMapping("/ingest")
    public ResponseEntity<PortMetric> ingestMetric(@RequestBody Map<String, Object> body) {
        PortMetric saved = collectorService.ingestPortMetric(
                String.valueOf(body.get("switchId")),
                (Integer) body.get("portId"),
                toLong(body.get("rxBytes")),   toLong(body.get("txBytes")),
                toLong(body.get("rxPackets")), toLong(body.get("txPackets")),
                toInt(body.get("txErrors")),   toInt(body.get("rxErrors")),
                toInt(body.get("txDropped")),  toInt(body.get("rxDropped")),
                toInt(body.get("durationSec"))
        );
        return ResponseEntity.ok(saved);
    }

    private Long toLong(Object v) { return v == null ? 0L : ((Number) v).longValue(); }
    private Integer toInt(Object v) { return v == null ? 0 : ((Number) v).intValue(); }
}