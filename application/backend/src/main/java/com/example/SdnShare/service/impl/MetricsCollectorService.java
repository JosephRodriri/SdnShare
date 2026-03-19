package com.example.SdnShare.service.impl;

import com.example.SdnShare.model.PortMetric;
import com.example.SdnShare.model.Switch;
import com.example.SdnShare.repository.PortMetricRepository;
import com.example.SdnShare.repository.SwitchRepository;

import com.example.SdnShare.websocket.SdnWebSocketHandler;
import jakarta.annotation.PostConstruct;
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

    // WebClients inicializados en @PostConstruct con baseUrl correcta
    private WebClient influxClient;
    private WebClient prometheusClient;

    @PostConstruct
    public void init() {
        this.influxClient     = WebClient.builder().baseUrl(influxHost).build();
        this.prometheusClient = WebClient.builder().baseUrl(prometheusHost).build();
        log.info("=== MetricsCollectorService iniciado ===");
        log.info("=== InfluxDB  : {}", influxHost);
        log.info("=== Prometheus: {}", prometheusHost);
    }

    
    // POLLING INFLUXDB
    

    @Scheduled(fixedDelayString = "${sdn.influxdb.poll-interval-ms:10000}")
    public void collectFromInfluxDB() {
        log.info(">>> [InfluxDB] Polling...");

        String query = "SELECT last(rx_bytes), last(tx_bytes), last(rx_packets), " +
                "last(tx_packets), last(tx_errors), last(rx_errors) " +
                "FROM port_stats GROUP BY datapath, port_no";

        // CORRECTO - baseUrl ya está en el cliente, solo agregar path y params
        influxClient.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/query")
                        .queryParam("db", influxDatabase)
                        .queryParam("q", query)
                        .build())
                .retrieve()
                .bodyToMono(Map.class)
                .subscribe(
                        response -> {
                            log.info(">>> [InfluxDB] Respuesta recibida");
                            parseAndSaveInfluxResponse(response);
                        },
                        error -> log.error(">>> [InfluxDB] Error: {}", error.getMessage())
                );
    }

    
    // POLLING PROMETHEUS
    

    @Scheduled(fixedDelayString = "${sdn.prometheus.poll-interval-ms:15000}")
    public void collectFromPrometheus() {
        log.info(">>> [Prometheus] Polling...");

        List<String> datapaths = List.of("11", "12", "21", "22", "23");
        datapaths.forEach(dpId -> {
            String query = String.format(
                    "ryu_flow_count{datapath_id=\"%s\",table_id=\"0\"}", dpId);

            // CORRECTO
            prometheusClient.get()
                    .uri(uriBuilder -> uriBuilder
                            .path("/api/v1/query")
                            .queryParam("query", query)
                            .build(true))
                    .retrieve()
                    .bodyToMono(Map.class)
                    .subscribe(
                            response -> log.info(">>> [Prometheus] switch={} → {}", dpId, response),
                            error -> log.error(">>> [Prometheus] Error switch={}: {}", dpId, error.getMessage())
                    );
        });
    }

    
    // INGESTA DIRECTA (desde Ryu vía POST)


    public PortMetric ingestPortMetric(String switchId, Integer portId,
                                       Long rxBytes,    Long txBytes,
                                       Long rxPackets,  Long txPackets,
                                       Long txErrors,   Long rxErrors,   //  Long
                                       Long txDropped,  Long rxDropped,
                                       Integer durationSec)  {

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
        log.info(">>> [DB] Métrica guardada → switch={} port={} rx={} tx={}",
                switchId, portId, rxBytes, txBytes);

        // Actualizar last_seen del switch
        switchRepository.findBySwitchId(switchId).ifPresent(sw -> {
            sw.setLastSeen(OffsetDateTime.now());
            sw.setIsActive(true);
            switchRepository.save(sw);
        });

        webSocketHandler.broadcastPortMetric(saved);
        return saved;
    }

    
    // PARSEO RESPUESTA INFLUXDB


    private void parseAndSaveInfluxResponse(Map<?, ?> response) {
        try {
            var results = (List<?>) response.get("results");
            if (results == null || results.isEmpty()) {
                log.warn(">>> [InfluxDB] Sin resultados");
                return;
            }

            var result = (Map<?, ?>) results.get(0);
            var series = (List<?>) result.get("series");

            if (series == null) {
                log.warn(">>> [InfluxDB] Series null — ¿Mininet está corriendo?");
                return;
            }

            log.info(">>> [InfluxDB] {} series encontradas", series.size());

            for (Object s : series) {
                try {
                    Map<?, ?> serie  = (Map<?, ?>) s;
                    Map<?, ?> tags   = (Map<?, ?>) serie.get("tags");
                    List<?>   values = (List<?>) serie.get("values");

                    if (tags == null || values == null || values.isEmpty()) continue;

                    String switchId    = String.valueOf(tags.get("datapath"));
                    String portNoStr   = String.valueOf(tags.get("port_no"));

                    //  Filtrar puertos especiales de OpenFlow
                    // 4294967294 = 0xFFFFFFFE = OFPP_LOCAL
                    // 4294967293 = 0xFFFFFFFD = OFPP_NORMAL
                    // 4294967040 = 0xFFFFFF00 = OFPP_MAX
                    long portNoLong = Long.parseLong(portNoStr);
                    if (portNoLong > 65535) {
                        log.debug(">>> [InfluxDB] Saltando puerto especial OpenFlow: {}", portNoStr);
                        continue;  // ← saltar en lugar de lanzar excepción
                    }

                    Integer portId = (int) portNoLong;
                    List<?> row    = (List<?>) values.get(0);

                    log.info(">>> [InfluxDB] switch={} port={} rx_bytes={} tx_bytes={}",
                            switchId, portId, row.get(1), row.get(2));

                    ingestPortMetric(switchId, portId,
                            toLong(row.get(1)), toLong(row.get(2)),
                            toLong(row.get(3)), toLong(row.get(4)),
                            toLong(row.get(5)), toLong(row.get(6)),
                            0L, 0L, 0);

                } catch (Exception e) {
                    log.warn(">>> [InfluxDB] Error procesando serie: {} — continuando", e.getMessage());
                }
            }

        } catch (Exception e) {
            log.error(">>> [InfluxDB] Error parseando respuesta: {}", e.getMessage(), e);
        }
    }

    
    // HELPERS
    

    private String resolveSwitchType(String switchId) {
        return switchRepository.findBySwitchId(switchId)
                .map(Switch::getSwitchType)
                .orElse(switchId.startsWith("1") ? "spine" : "leaf");
    }

    private Long toLong(Object val) {
        if (val == null) return 0L;
        if (val instanceof Number n) return n.longValue();
        return Long.parseLong(val.toString());
    }

    private Integer toInt(Object val) {
        if (val == null) return 0;
        if (val instanceof Number n) return n.intValue();
        return Integer.parseInt(val.toString());
    }
}