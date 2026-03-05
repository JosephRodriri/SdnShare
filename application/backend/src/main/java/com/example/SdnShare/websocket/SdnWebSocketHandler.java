package com.example.SdnShare.websocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.config.annotation.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;


@Slf4j
@Component
public class SdnWebSocketHandler extends TextWebSocketHandler {

    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.put(session.getId(), session);
        log.info("WebSocket connected: {}", session.getId());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session.getId());
        log.info("WebSocket disconnected: {}", session.getId());
    }

    // Enviar alerta de anomalía a todos los clientes conectados
    public void broadcastAnomaly(Object anomaly) {
        broadcast("ANOMALY", anomaly);
    }

    // Enviar actualización de métricas de puerto
    public void broadcastPortMetric(Object metric) {
        broadcast("PORT_METRIC", metric);
    }

    // Enviar cambio de topología
    public void broadcastTopologyChange(Object change) {
        broadcast("TOPOLOGY_CHANGE", change);
    }

    private void broadcast(String type, Object payload) {
        try {
            String message = objectMapper.writeValueAsString(
                    Map.of("type", type, "payload", payload,
                            "timestamp", System.currentTimeMillis())
            );
            TextMessage wsMessage = new TextMessage(message);
            sessions.values().removeIf(session -> !session.isOpen());
            sessions.values().forEach(session -> {
                try {
                    session.sendMessage(wsMessage);
                } catch (Exception e) {
                    log.warn("Error sending to session {}: {}", session.getId(), e.getMessage());
                }
            });
        } catch (Exception e) {
            log.error("Error broadcasting {}: {}", type, e.getMessage());
        }
    }

    public int getConnectedClients() {
        return sessions.size();
    }
}