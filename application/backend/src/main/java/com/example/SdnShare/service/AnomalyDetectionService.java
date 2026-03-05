package com.example.SdnShare.service;


import com.example.SdnShare.model.Anomaly;
import com.example.SdnShare.model.PortMetric;

import com.example.SdnShare.repository.AnomalyRepository;
import com.example.SdnShare.repository.PortMetricRepository;
import com.example.SdnShare.websocket.SdnWebSocketHandler;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Detecta anomalías DDoS comparando métricas recientes.
 * Replica la lógica de ddos_monitor.sh pero en Java con persistencia.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AnomalyDetectionService {

    private final PortMetricRepository portMetricRepository;
    private final AnomalyRepository anomalyRepository;
    private final SdnWebSocketHandler webSocketHandler;

    @Value("${sdn.anomaly.ddos-critical-threshold:1000}")
    private int criticalThreshold;

    @Value("${sdn.anomaly.ddos-high-threshold:500}")
    private int highThreshold;

    // Mapa de últimos paquetes por switch+puerto para calcular pps
    private final Map<String, Long> lastRxPackets = new HashMap<>();
    private final Map<String, Long> lastTxPackets = new HashMap<>();
    private final Map<String, OffsetDateTime> lastCheck = new HashMap<>();

    /**
     * Se ejecuta cada 5 segundos para analizar métricas recientes.
     */
    @Scheduled(fixedDelayString = "${sdn.anomaly.check-interval-ms:5000}")
    public void detectAnomalies() {
        OffsetDateTime since = OffsetDateTime.now().minusSeconds(30);
        List<PortMetric> recentMetrics = portMetricRepository.findAllSince(since);

        for (PortMetric metric : recentMetrics) {
            analyzeMetric(metric);
        }
    }

    private void analyzeMetric(PortMetric metric) {
        String key = metric.getSwitchId() + ":" + metric.getPortId();
        OffsetDateTime now = OffsetDateTime.now();

        Long prevRx = lastRxPackets.get(key);
        Long prevTx = lastTxPackets.get(key);
        OffsetDateTime prev = lastCheck.get(key);

        // Actualizar estado previo
        lastRxPackets.put(key, metric.getRxPackets());
        lastTxPackets.put(key, metric.getTxPackets());
        lastCheck.put(key, now);

        if (prevRx == null || prev == null) return;

        // Calcular pps en el intervalo
        double seconds = java.time.Duration.between(prev, now).toMillis() / 1000.0;
        if (seconds <= 0) return;

        int rxPps = (int) ((metric.getRxPackets() - prevRx) / seconds);
        int txPps = (int) ((metric.getTxPackets() - prevTx) / seconds);

        // Evitar negativos por reset de contadores
        if (rxPps < 0 || txPps < 0) return;

        evaluateThresholds(metric, rxPps, txPps);
    }

    private void evaluateThresholds(PortMetric metric, int rxPps, int txPps) {
        String severity = null;
        String anomalyType = null;
        double metricValue = Math.max(rxPps, txPps);

        if (metricValue >= criticalThreshold) {
            severity = "CRITICAL";
            anomalyType = "DDOS";
        } else if (metricValue >= highThreshold) {
            severity = "HIGH";
            anomalyType = "HIGH_TRAFFIC";
        }

        if (severity == null) return;

        final String anomalyTypeFinal = anomalyType; // correccion  anomalyType se usa dentro de una lambda (anyMatch) y Java exige que esa variable sea final o effectively final.
        // Verificar si ya existe una anomalía activa para este switch+puerto
        boolean alreadyActive = anomalyRepository
                .findByResolvedAtIsNullOrderByDetectedAtDesc()
                .stream()
                .anyMatch(a -> metric.getSwitchId().equals(a.getSwitchId())
                        && metric.getPortId().equals(a.getPortId())
                        && anomalyTypeFinal.equals(a.getAnomalyType()));

        if (alreadyActive) return;

        // Determinar host afectado por switch+puerto
        String hostName = resolveHost(metric.getSwitchId(), metric.getPortId());

        Map<String, Object> details = new HashMap<>();
        details.put("switch_type", metric.getSwitchType());
        details.put("rx_bytes_total", metric.getRxBytes());
        details.put("tx_bytes_total", metric.getTxBytes());

        Anomaly anomaly = Anomaly.builder()
                .anomalyType(anomalyType)
                .severity(severity)
                .switchId(metric.getSwitchId())
                .portId(metric.getPortId())
                .hostName(hostName)
                .rxPps(rxPps)
                .txPps(txPps)
                .metricValue(metricValue)
                .threshold((double) (severity.equals("CRITICAL") ? criticalThreshold : highThreshold))
                .details(details)
                .detectedAt(OffsetDateTime.now())
                .build();

        anomalyRepository.save(anomaly);
        webSocketHandler.broadcastAnomaly(anomaly);

        log.warn("!  Anomaly detected [{}] {} on switch {} port {} — rx:{} tx:{} pps",
                severity, anomalyType, metric.getSwitchId(), metric.getPortId(), rxPps, txPps);
    }

    /**
     * Resuelve qué host está conectado a un switch+puerto específico.
     * Basado en network_config.yaml: leaf switches (21,22,23) puertos 3 y 4 son hosts.
     */
    private String resolveHost(String switchId, int portId) {
        Map<String, String> hostMap = Map.of(
                "21:3", "h1", "21:4", "h2",
                "22:3", "h3", "22:4", "h4",
                "23:3", "h5", "23:4", "h6"
        );
        return hostMap.getOrDefault(switchId + ":" + portId, null);
    }

    /**
     * Marca una anomalía como resuelta (llamado desde el REST controller).
     */
    public Optional<Anomaly> resolveAnomaly(Long id, String resolvedBy, String note) {
        return anomalyRepository.findById(id).map(anomaly -> {
            anomaly.setResolvedAt(OffsetDateTime.now());
            anomaly.setResolvedBy(resolvedBy);
            anomaly.setResolutionNote(note);
            return anomalyRepository.save(anomaly);
        });
    }
}









