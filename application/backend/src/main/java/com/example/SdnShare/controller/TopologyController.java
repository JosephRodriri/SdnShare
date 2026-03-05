package com.example.SdnShare.controller;

import com.example.SdnShare.model.Host;
import com.example.SdnShare.model.Switch;
import com.example.SdnShare.repository.HostRepository;
import com.example.SdnShare.repository.SwitchRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;


@RestController
@RequestMapping("/api/topology")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
class TopologyController {

    private final SwitchRepository switchRepository;
    private final HostRepository hostRepository;

    // Todos los switches
    @GetMapping("/switches")
    public List<Switch> getAllSwitches() {
        return switchRepository.findAll();
    }

    //  Switches activos
    @GetMapping("/switches/active")
    public List<Switch> getActiveSwitches() {
        return switchRepository.findByIsActiveTrue();
    }

   //  Switches por id
    @GetMapping("/switches/{switchId}")
    public ResponseEntity<Switch> getSwitch(@PathVariable String switchId) {
        return switchRepository.findBySwitchId(switchId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    //Todos los hosts
    @GetMapping("/hosts")
    public List<Host> getAllHosts() {
        return hostRepository.findAll();
    }

    // Switches activos
    @GetMapping("/hosts/active")
    public List<Host> getActiveHosts() {
        return hostRepository.findByIsActiveTrue();
    }

    // buscar host por nombre
    @GetMapping("/hosts/{name}")
    public ResponseEntity<Host> getHost(@PathVariable String name) {
        return hostRepository.findByName(name)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    // Endpoint para que Ryu notifique cambios de topología
    // Actualizar estado (desde Ryu)
    @PostMapping("/switches/{switchId}/status")
    public ResponseEntity<?> updateSwitchStatus(
            @PathVariable String switchId,
            @RequestBody Map<String, Object> body) {

        return switchRepository.findBySwitchId(switchId).map(sw -> {
            sw.setIsActive((Boolean) body.getOrDefault("active", true));
            sw.setLastSeen(OffsetDateTime.now());
            switchRepository.save(sw);
            return ResponseEntity.ok(sw);
        }).orElse(ResponseEntity.notFound().build());
    }
}

