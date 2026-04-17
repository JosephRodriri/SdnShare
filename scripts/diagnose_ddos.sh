#!/usr/bin/env bash
# scripts/diagnose_ddos.sh
# ─────────────────────────
# Verifica que el módulo DDoS esté cargado y funcionando.
# Ejecutar desde la VM host (no dentro de los contenedores).
#
# Uso:
#   chmod +x scripts/diagnose_ddos.sh
#   ./scripts/diagnose_ddos.sh

set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
fail() { echo -e "  ${RED}✗${NC} $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $*"; }
info() { echo -e "  ${CYAN}→${NC} $*"; }

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Diagnóstico del módulo DDoS"
echo "════════════════════════════════════════════════════════"

# 1. Controller corriendo
echo ""
echo "1. Estado del controller:"
if docker compose ps controller 2>/dev/null | grep -q "healthy\|running"; then
    ok "Controller está corriendo"
else
    fail "Controller NO está corriendo"
    info "Ejecuta: make setup  o  make up"
    exit 1
fi

# 2. Mitigador cargado
echo ""
echo "2. Módulo ddos_mitigator cargado:"
LOG=$(docker compose logs controller 2>/dev/null | tail -200)

if echo "$LOG" | grep -q "Mitigator v2 iniciado\|Mitigator started"; then
    ok "ddos_mitigator.py cargado correctamente"
    echo "$LOG" | grep -E "Mitigator|iniciado|started" | tail -3 | while read -r l; do info "$l"; done
else
    fail "ddos_mitigator.py NO está cargado"
    echo ""
    warn "El command: en docker-compose.yaml probablemente no incluye ddos_mitigator.py"
    info "Verifica que el bloque controller tenga:"
    info "  command: infra/controller/dc_switch.py infra/controller/ddos_mitigator.py --observe-links"
    info ""
    info "Luego reinicia: docker compose up -d --force-recreate controller"
    exit 1
fi

# 3. Datapaths registrados
echo ""
echo "3. Switches (datapaths) registrados:"
DP_COUNT=$(echo "$LOG" | grep -c "Switch registrado\|Registered datapath" || true)
if [ "$DP_COUNT" -gt 0 ]; then
    ok "$DP_COUNT switch(es) registrados"
    echo "$LOG" | grep -E "registrado|Registered datapath" | tail -5 | while read -r l; do info "$l"; done
else
    warn "0 switches registrados — ¿está la topología Mininet corriendo?"
    info "Ejecuta: make topo"
fi

# 4. hping3 en contenedor mininet
echo ""
echo "4. hping3 en el contenedor Mininet:"
if docker compose exec -T mininet which hping3 > /dev/null 2>&1; then
    ok "hping3 disponible"
else
    fail "hping3 NO disponible"
    warn "El demo usará fallback (ping -f para ICMP flood)"
    info "Para instalar ahora:"
    info "  docker compose exec mininet apt-get install -y hping3"
    info ""
    info "Para instalación permanente edita infra/docker/Dockerfile.mininet:"
    info "  RUN apt-get install -y hping3"
    info "Luego: docker compose build mininet && make setup"
fi

# 5. Variables de entorno DDoS
echo ""
echo "5. Thresholds configurados:"
ENV_OUT=$(docker compose exec -T controller env 2>/dev/null | grep DDOS || true)
if [ -n "$ENV_OUT" ]; then
    ok "Variables DDOS_ encontradas:"
    echo "$ENV_OUT" | while read -r l; do info "  $l"; done
else
    warn "No se encontraron variables DDOS_ en el controller"
    info "Se usarán los valores por defecto: SYN=5 UDP=10 ICMP=5 pps"
fi

# 6. Eventos DDoS recientes
echo ""
echo "6. Eventos DDoS recientes en los logs:"
EVENTS=$(docker compose logs controller 2>/dev/null | grep "DDOS_EVENT\|ATAQUE DETECTADO\|ATTACK DETECTED\|BLOQUEADO\|BLOCKED" | tail -10)
if [ -n "$EVENTS" ]; then
    ok "Eventos encontrados:"
    echo "$EVENTS" | while read -r l; do info "$l"; done
else
    info "Sin eventos DDoS aún — ejecuta la demo para generar ataques:"
    info "  make topo"
    info "  mininet> py exec(open('infra/attacks/ddos_demo.py').read())"
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Monitor en tiempo real:"
echo "  ./scripts/watch_ddos.sh"
echo ""
echo "  Reinstalar controller con cambios:"
echo "  docker compose up -d --force-recreate controller"
echo "════════════════════════════════════════════════════════"
echo ""