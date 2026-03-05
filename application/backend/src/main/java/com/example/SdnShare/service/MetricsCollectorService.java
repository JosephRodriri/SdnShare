package com.example.SdnShare.service;

import com.example.SdnShare.model.PortMetric;
import com.example.SdnShare.model.Switch;
import com.example.SdnShare.repository.PortMetricRepository;
import com.example.SdnShare.repository.SwitchRepository;

import com.example.SdnShare.websocket.SdnWebSocketHandler;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

/**
 * Consulta métricas desde InfluxDB y Prometheus periódicamente
 * y las persiste en PostgreSQL.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MetricsCollectorService {

    private final PortMetricRepository portMetricRepository;
    private final SwitchRepository switchRepository;
    private final SdnWebSocketHandler webSocketHandler;

    @Value("${sdn.influxdb.host}")
    private String influxHost;

    @Value("${sdn.influxdb.database}")
    private String influxDatabase;

    @Value("${sdn.prometheus.host}")
    private String prometheusHost;

    private final WebClient webClient = WebClient.builder().build();

    /**
     * Polling a InfluxDB cada 10 segundos.
     * Consulta port_stats de todos los switches.
     */
    @Scheduled(fixedDelayString = "${sdn.influxdb.poll-interval-ms:10000}")
    public void collectFromInfluxDB() {
        log.debug("Polling InfluxDB...");

        // Query: últimas métricas de cada switch+puerto
        String query = "SELECT last(rx_bytes), last(tx_bytes), last(rx_packets), " +
                "last(tx_packets), last(tx_errors), last(rx_errors) " +
                "FROM port_stats GROUP BY datapath, port_no";

        webClient.get()
                .uri(influxHost + "/query", uriBuilder -> uriBuilder
                        .queryParam("db", influxDatabase)
                        .queryParam("q", query)
                        .build())
                .retrieve()
                .bodyToMono(Map.class)
                .subscribe(
                        response -> parseAndSaveInfluxResponse(response),
                        error -> log.error("InfluxDB polling error: {}", error.getMessage())
                );
    }

    /**
     * Recibe métricas directamente del controlador Ryu via POST.
     * El controlador puede enviar stats cuando las recibe de los switches.
     */
    public PortMetric ingestPortMetric(String switchId, Integer portId,
                                       Long rxBytes, Long txBytes,
                                       Long rxPackets, Long txPackets,
                                       Integer txErrors, Integer rxErrors,
                                       Integer txDropped, Integer rxDropped,
                                       Integer durationSec) {

        String switchType = resolveSwitchType(switchId);

        PortMetric metric = PortMetric.builder()
                .switchId(switchId)
                .switchType(switchType)
                .portId(portId)
                .rxBytes(rxBytes)
                .txBytes(txBytes)
                .rxPackets(rxPackets)
                .txPackets(txPackets)
                .txErrors(txErrors)
                .rxErrors(rxErrors)
                .txDropped(txDropped)
                .rxDropped(rxDropped)
                .durationSec(durationSec)
                .timestamp(OffsetDateTime.now())
                .build();

        PortMetric saved = portMetricRepository.save(metric);

        // Actualizar last_seen del switch
        switchRepository.findBySwitchId(switchId).ifPresent(sw -> {
            sw.setLastSeen(OffsetDateTime.now());
            sw.setIsActive(true);
            switchRepository.save(sw);
        });

        // Broadcast al frontend via WebSocket
        webSocketHandler.broadcastPortMetric(saved);

        return saved;
    }

    /**
     * Polling a Prometheus cada 15 segundos para flow counts.
     */
    @Scheduled(fixedDelayString = "${sdn.prometheus.poll-interval-ms:15000}")
    public void collectFromPrometheus() {
        log.debug("Polling Prometheus...");

        // Consultar ryu_flow_count por datapath
        List<String> datapaths = List.of("11", "12", "21", "22", "23");
        datapaths.forEach(dpId -> {
            String query = String.format("ryu_flow_count{datapath_id=\"%s\",table_id=\"0\"}", dpId);
            webClient.get()
                    .uri(prometheusHost + "/api/v1/query", uriBuilder -> uriBuilder
                            .queryParam("query", query)
                            .build())
                    .retrieve()
                    .bodyToMono(Map.class)
                    .subscribe(
                            response -> log.debug("Prometheus response for {}: {}", dpId, response),
                            error -> log.error("Prometheus polling error for {}: {}", dpId, error.getMessage())
                    );
        });
    }

    private void parseAndSaveInfluxResponse(Map<?, ?> response) {
        // Parsear respuesta InfluxDB y guardar en PostgreSQL
        // La respuesta tiene estructura: {results: [{series: [{tags: {datapath, port_no}, values: [...]}]}]}
        try {
            var results = (List<?>) response.get("results");
            if (results == null || results.isEmpty()) return;

            var result = (Map<?, ?>) results.get(0);
            var series = (List<?>) result.get("series");
            if (series == null) return;

            for (Object s : series) {
                Map<?, ?> serie = (Map<?, ?>) s;
                Map<?, ?> tags = (Map<?, ?>) serie.get("tags");
                List<?> values = (List<?>) serie.get("values");

                if (tags == null || values == null || values.isEmpty()) continue;

                String switchId = String.valueOf(tags.get("datapath"));
                Integer portId  = Integer.parseInt(String.valueOf(tags.get("port_no")));
                List<?> row     = (List<?>) values.get(0);

                // row: [timestamp, rx_bytes, tx_bytes, rx_packets, tx_packets, tx_errors, rx_errors]
                ingestPortMetric(switchId, portId,
                        toLong(row.get(1)), toLong(row.get(2)),
                        toLong(row.get(3)), toLong(row.get(4)),
                        toInt(row.get(5)),  toInt(row.get(6)),
                        0, 0, 0);
            }
        } catch (Exception e) {
            log.error("Error parsing InfluxDB response: {}", e.getMessage());
        }
    }

    private String resolveSwitchType(String switchId) {
        return switchRepository.findBySwitchId(switchId)
                .map(Switch::getSwitchType)
                .orElse(switchId.startsWith("1") ? "spine" : "leaf");
    }

    private Long toLong(Object val) {
        if (val == null) return 0L;
        if (val instanceof Number) return ((Number) val).longValue();
        return Long.parseLong(val.toString());
    }

    private Integer toInt(Object val) {
        if (val == null) return 0;
        if (val instanceof Number) return ((Number) val).intValue();
        return Integer.parseInt(val.toString());
    }
}
