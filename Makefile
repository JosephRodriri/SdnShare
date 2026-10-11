# ═══════════════════════════════════════════════════════════
# SDN Detection Lab — Makefile
# ═══════════════════════════════════════════════════════════
include scripts/Makefile

.DEFAULT_GOAL := help

.PHONY: help setup up down restart topo topo-clean monitor capture train predict test lint clean
.PHONY: dataset-run dataset-step dataset-validate dataset-clean

# Colores
CYAN   := \033[36m
GREEN  := \033[32m
YELLOW := \033[33m
RED    := \033[31m
RESET  := \033[0m

help: ## Muestra esta ayuda interactiva
	@echo ""
	@echo "$(CYAN)════════════ SDN DDoS Detection Lab ════════════$(RESET)"
	@echo ""
	@grep -h -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-22s$(RESET) %s\n", $$1, $$2}'
	@echo ""

# ─── Infraestructura ──────────────────────────────────────

setup: ## Levanta servicios base (controller + mininet)
	@echo "$(CYAN)🚀 Levantando servicios base...$(RESET)"
	@docker compose up -d controller mininet
	@echo "$(CYAN)⏳ Esperando a que el controller esté listo...$(RESET)"
	@until docker compose exec -T controller python3 -c "import socket; s=socket.socket(); s.settimeout(2); s.connect(('localhost',8080)); s.close()" 2>/dev/null; do sleep 2; done
	@echo "$(GREEN)✓ Lab SDN listo$(RESET)"
	@echo "  FlowManager: http://localhost:8080"

up: ## Levanta todos los servicios (infra + monitor)
	@echo "$(CYAN)🚀 Levantando todos los servicios...$(RESET)"
	@docker compose --profile monitor up -d
	@echo "$(CYAN)⏳ Esperando a que el controller esté listo...$(RESET)"
	@until docker compose exec -T controller python3 -c "import socket; s=socket.socket(); s.settimeout(2); s.connect(('localhost',8080)); s.close()" 2>/dev/null; do sleep 2; done
	@echo "$(GREEN)✓ Lab completo listo$(RESET)"
	@echo "  FlowManager: http://localhost:8080"
	@echo "  Grafana:     http://localhost:3000"
	@echo "  Prometheus:  http://localhost:9090"

down: ## Detiene todos los servicios
	@echo "$(RED)🛑 Deteniendo servicios...$(RESET)"
	@docker compose --profile monitor down

restart: ## Reinicia controller + mininet (soluciona desconexiones)
	@echo "$(CYAN)🔄 Reiniciando controller...$(RESET)"
	@docker compose restart controller
	@echo "$(CYAN)⏳ Esperando a que el controller esté listo...$(RESET)"
	@until docker compose exec -T controller python3 -c "import socket; s=socket.socket(); s.settimeout(2); s.connect(('localhost',8080)); s.close()" 2>/dev/null; do sleep 2; done
	@docker compose exec -T mininet mn -c 2>/dev/null || true
	@echo "$(GREEN)✓ Controller listo — ejecuta 'make topo'$(RESET)"

topo: ## Inicia topología spine-leaf en Mininet
	@echo "$(CYAN)🧹 Limpiando topología anterior...$(RESET)"
	@docker compose exec -T mininet mn -c 2>/dev/null || true
	@echo "$(CYAN)⏳ Verificando controller...$(RESET)"
	@until docker compose exec -T controller python3 -c "import socket; s=socket.socket(); s.settimeout(2); s.connect(('localhost',8080)); s.close()" 2>/dev/null; do sleep 2; done
	@echo "$(GREEN)✓ Controller listo — iniciando topología$(RESET)"
	@docker compose exec -it mininet ./infra/topology/mn_spineleaf_topo.py infra/configs/network_config.yaml

topo-clean: ## Limpia topología Mininet
	@echo "$(CYAN)🧹 Limpiando topología...$(RESET)"
	@docker compose exec -T mininet mn -c 2>/dev/null || true

monitor: ## Abre terminal tmux con monitor DDoS
	@echo "$(CYAN)📊 Abriendo monitor tmux...$(RESET)"
	@./open_terminal.sh

# ─── Pipeline de Datos ────────────────────────────────────

# Asegura que RUN_ID se genere en silencio (o usa UNK si falla)
RUN_ID := $(shell python3 scripts/generate_run_id.py 2>/dev/null || echo "UNK")

# Variables del pipeline de datasets (override con: make dataset-run NAME=ddos_lab1 INPUT=...)
PIPELINE_PY  := pipeline/.venv/bin/python
PIPELINE_DIR := pipeline/sdn-dataset-pipeline/scripts/pipeline
INPUT        ?= /tmp/capture.pcap
NAME         ?= capture
SERVICE      ?= mininet
WINDOW       ?= 5.0

capture: ## Inicia captura de datos (genera run_id automático)
	@echo "$(CYAN)🏷️  Run ID: $(RUN_ID)$(RESET)"
	@python3 scripts/generate_run_id.py --create-dir
	@echo "$(GREEN)✓ Directorio de captura creado en data/raw/$(RUN_ID)$(RESET)"
	@echo "  Inicia la captura manualmente y guarda los datos en ese directorio"

dataset-run: ## Corre el pipeline completo  (INPUT=pcap/csv NAME=nombre SERVICE=mininet)
	@echo ""
	@echo "$(CYAN)╔══════════════════════════════════════════════╗$(RESET)"
	@echo "$(CYAN)║     📦  SDN Dataset Pipeline                ║$(RESET)"
	@echo "$(CYAN)╚══════════════════════════════════════════════╝$(RESET)"
	@echo "  Input:   $(INPUT)"
	@echo "  Name:    $(NAME)"
	@echo "  Service: $(SERVICE)"
	@echo "  Window:  $(WINDOW)s"
	@echo ""
	@mkdir -p datasets/raw datasets/processed datasets/splits datasets/metadata
	@$(PIPELINE_PY) $(PIPELINE_DIR)/01_extract.py \
		--input   "$(INPUT)" \
		--service "$(SERVICE)" \
		--output  datasets/raw/$(NAME)_raw.csv
	@$(PIPELINE_PY) $(PIPELINE_DIR)/02_label.py \
		--input  datasets/raw/$(NAME)_raw.csv \
		--output datasets/raw/$(NAME)_labeled.csv \
		--method filename
	@$(PIPELINE_PY) $(PIPELINE_DIR)/03_clean.py \
		--input           datasets/raw/$(NAME)_labeled.csv \
		--output          datasets/raw/$(NAME)_clean.csv \
		--drop-duplicates
	@$(PIPELINE_PY) $(PIPELINE_DIR)/04_features.py \
		--input  datasets/raw/$(NAME)_clean.csv \
		--output datasets/processed/$(NAME)_features.csv \
		--window $(WINDOW)
	@$(PIPELINE_PY) $(PIPELINE_DIR)/05_split_export.py \
		--input datasets/processed/$(NAME)_features.csv \
		--name  "$(NAME)"
	@echo ""
	@echo "$(GREEN)✅ Dataset listo:$(RESET)"
	@echo "   datasets/splits/train.csv"
	@echo "   datasets/splits/test.csv"
	@echo "   datasets/metadata/$(NAME)_manifest.json"

dataset-step: ## Corre un paso individual  (STEP=01..05 INPUT=... OUTPUT=... NAME=...)
	@echo "$(CYAN)▶ Ejecutando paso $(STEP)...$(RESET)"
	@$(PIPELINE_PY) $(PIPELINE_DIR)/0$(STEP)_*.py $(ARGS)

dataset-validate: ## Valida los CSVs generados con RandomForest rápido
	@echo "$(CYAN)🤖 Validando train/test con RandomForest...$(RESET)"
	@$(PIPELINE_PY) -c "\
import pandas as pd; \
from sklearn.ensemble import RandomForestClassifier; \
train = pd.read_csv('datasets/splits/train.csv'); \
test  = pd.read_csv('datasets/splits/test.csv'); \
FEATS = ['ip.proto','tcp.srcport','tcp.dstport','tcp.window_size', \
         'tcp_flags_num','frame.len','pkt_count','byte_sum', \
         'unique_src','unique_dst_port','syn_ratio','avg_pkt_size']; \
clf = RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1); \
clf.fit(train[FEATS], train['label_enc']); \
acc = clf.score(test[FEATS], test['label_enc']); \
print(f'Clases: {list(train[\"label\"].unique())}'); \
print(f'Train rows: {len(train)}  |  Test rows: {len(test)}'); \
print(f'Test accuracy: {acc:.3f}') \
"

dataset-clean: ## Borra outputs del pipeline (mantiene raw)
	@echo "$(RED)🗑️  Borrando datasets procesados...$(RESET)"
	@rm -rf datasets/splits datasets/processed datasets/metadata
	@echo "$(GREEN)✓ Limpiado (datasets/raw intacto)$(RESET)"

# ─── ML (futuro) ──────────────────────────────────────────

train: ## Entrena modelo ML
	@echo "$(YELLOW)⚠️  Aún no implementado. Ver ml/train.py$(RESET)"

predict: ## Ejecuta inferencia
	@echo "$(YELLOW)⚠️  Aún no implementado. Ver ml/predict.py$(RESET)"

# ─── Calidad ──────────────────────────────────────────────

test: ## Ejecuta tests
	@echo "$(CYAN)🧪 Ejecutando tests...$(RESET)"
	@python3 -m pytest tests/ -v

lint: ## Ejecuta linter
	@echo "$(CYAN)🔍 Ejecutando ruff...$(RESET)"
	@python3 -m ruff check .

# ─── Limpieza ─────────────────────────────────────────────

clean: ## Limpia datos temporales y cache Python
	@echo "$(CYAN)🗑️  Limpiando cache recursivamente...$(RESET)"
	@find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	@find . -type f -name "*.pyc" -delete 2>/dev/null || true
	@echo "$(GREEN)✓ Cache limpiado$(RESET)"
