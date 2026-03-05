package com.example.SdnShare.controller;

import com.example.SdnShare.model.AlertRule;
import com.example.SdnShare.repository.AlertRuleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/alert-rules")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
// Reglas de alerta
class AlertRuleController {

    private final AlertRuleRepository alertRuleRepository;

    //Todas las reglas
    @GetMapping
    public List<AlertRule> getAll() {
        return alertRuleRepository.findAll();
    }

    // Crear regla
    @PostMapping
    public AlertRule create(@RequestBody AlertRule rule) {
        return alertRuleRepository.save(rule);
    }

    //Actualizar
    @PutMapping("/{id}")
    public ResponseEntity<AlertRule> update(
            @PathVariable Long id,
            @RequestBody AlertRule rule) {

        return alertRuleRepository.findById(id).map(existing -> {
            rule.setId(id);
            return ResponseEntity.ok(alertRuleRepository.save(rule));
        }).orElse(ResponseEntity.notFound().build());
    }

    // Eliminar regla
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        if (!alertRuleRepository.existsById(id)) return ResponseEntity.notFound().build();
        alertRuleRepository.deleteById(id);
        return ResponseEntity.noContent().build();
    }

    //Activar/desactivar
    @PatchMapping("/{id}/toggle")
    public ResponseEntity<AlertRule> toggle(@PathVariable Long id) {
        return alertRuleRepository.findById(id).map(rule -> {
            rule.setEnabled(!rule.getEnabled());
            return ResponseEntity.ok(alertRuleRepository.save(rule));
        }).orElse(ResponseEntity.notFound().build());
    }
}









