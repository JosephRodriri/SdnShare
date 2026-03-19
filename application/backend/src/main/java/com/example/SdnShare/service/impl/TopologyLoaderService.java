package com.example.SdnShare.service.impl;

import com.example.SdnShare.model.Host;
import com.example.SdnShare.model.Switch;
import com.example.SdnShare.repository.HostRepository;
import com.example.SdnShare.repository.SwitchRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.yaml.snakeyaml.Yaml;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class TopologyLoaderService {

    private final SwitchRepository switchRepository;
    private final HostRepository hostRepository;

    @Value("${sdn.topology.config-file:scripts/network_config.yaml}")
    private String configFile;

    @PostConstruct
    public void loadTopology() {
        try {
            log.info(">>> [Topology] Cargando topología desde: {}", configFile);

            InputStream input = Files.newInputStream(Paths.get(configFile));
            Yaml yaml = new Yaml();
            Map<String, Object> config = yaml.load(input);

            loadSwitches(config);
            loadHosts(config);

            log.info(">>> [Topology] Topología cargada correctamente");

        } catch (Exception e) {
            log.warn(">>> [Topology] No se pudo cargar el archivo: {} — usando datos existentes en DB",
                    e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private void loadSwitches(Map<String, Object> config) {
        List<Map<String, Object>> switches =
                (List<Map<String, Object>>) config.get("switches");

        if (switches == null) return;

        for (Map<String, Object> sw : switches) {
            String switchId = String.valueOf(sw.get("id"));
            String name     = String.valueOf(sw.get("name"));
            String type     = String.valueOf(sw.get("type"));

            switchRepository.findBySwitchId(switchId).orElseGet(() -> {
                log.info(">>> [Topology] Registrando switch: {} ({})", name, type);
                return switchRepository.save(
                        Switch.builder()
                                .switchId(switchId)
                                .name(name)
                                .switchType(type)
                                .isActive(true)
                                .createdAt(OffsetDateTime.now())
                                .build()
                );
            });
        }
    }

    @SuppressWarnings("unchecked")
    private void loadHosts(Map<String, Object> config) {
        List<Map<String, Object>> hosts =
                (List<Map<String, Object>>) config.get("hosts");

        if (hosts == null) return;

        for (Map<String, Object> h : hosts) {
            String name  = String.valueOf(h.get("name"));
            String ip    = String.valueOf(h.get("ip"));
            String mac   = String.valueOf(h.get("mac"));
            Integer port = h.get("port") != null
                    ? Integer.parseInt(String.valueOf(h.get("port")))
                    : null;

            // connected_to viene como "s21" → extraer solo el número "21"
            String connectedTo = h.get("connected_to") != null
                    ? String.valueOf(h.get("connected_to")).replace("s", "")
                    : null;

            hostRepository.findByName(name).orElseGet(() -> {
                log.info(">>> [Topology] Registrando host: {} ({}) → switch {}",
                        name, ip, connectedTo);
                return hostRepository.save(
                        Host.builder()
                                .name(name)
                                .ip(ip)
                                .mac(mac)
                                .connectedSwitch(connectedTo)
                                .connectedPort(port)
                                .isActive(true)
                                .createdAt(OffsetDateTime.now())
                                .build()
                );
            });
        }
    }
}