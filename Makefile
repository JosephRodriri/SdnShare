# ═══════════════════════════════════════════════════════════
# SDN DDoS Detection Lab — Makefile
# ═══════════════════════════════════════════════════════════
.PHONY: help setup up down topo topo-clean monitor capture process train predict test lint clean

# Colores
CYAN  := \033[36m
GREEN := \033[32m
RESET := \033[0m

help: ## Muestra esta ayuda
	@echo ""
	@echo "$(CYAN)═══════ SDN DDoS Detection Lab ═══════$(RESET)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-15s$(RESET) %s\n", $$1, $$2}'
	@echo ""

# ─── Infraestructura ──────────────────────────────────────

setup: ## Levanta servicios base (controller + mininet)
	docker compose up -d controller mininet
	@echo "$(GREEN)✓ Lab SDN listo$(RESET)"
	@echo "  FlowManager: http://localhost:8080"

up: ## Levanta todos los servicios (infra + monitor)
	docker compose --profile monitor up -d
	@echo "$(GREEN)✓ Lab completo listo$(RESET)"
	@echo "  FlowManager: http://localhost:8080"
	@echo "  Grafana:     http://localhost:3000"
	@echo "  Prometheus:  http://localhost:9090"

down: ## Detiene todos los servicios
	docker compose --profile monitor down

topo: ## Inicia topología spine-leaf en Mininet
	docker compose exec -it mininet ./infra/topology/mn_spineleaf_topo.py infra/configs/network_config.yaml

topo-clean: ## Limpia topología Mininet
	docker compose exec -T mininet mn -c 2>/dev/null || true

monitor: ## Abre terminal tmux con monitor DDoS
	./open_terminal.sh

# ─── Pipeline de Datos ────────────────────────────────────

RUN_ID := $(shell python3 scripts/generate_run_id.py)

capture: ## Inicia captura de datos (genera run_id automático)
	@echo "$(CYAN)Run ID: $(RUN_ID)$(RESET)"
	python3 scripts/generate_run_id.py --create-dir
	@echo "$(GREEN)✓ Directorio de captura creado en data/raw/$(RUN_ID)$(RESET)"
	@echo "  Inicia la captura manualmente y guarda los datos en ese directorio"

# ─── ML (futuro) ──────────────────────────────────────────

train: ## Entrena modelo ML
	@echo "⚠️  Aún no implementado. Ver ml/train.py"

predict: ## Ejecuta inferencia
	@echo "⚠️  Aún no implementado. Ver ml/predict.py"

# ─── Calidad ──────────────────────────────────────────────

test: ## Ejecuta tests
	python3 -m pytest tests/ -v

lint: ## Ejecuta linter
	python3 -m ruff check .

# ─── Limpieza ─────────────────────────────────────────────

clean: ## Limpia datos temporales y cache Python
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	@echo "$(GREEN)✓ Cache limpiado$(RESET)"
