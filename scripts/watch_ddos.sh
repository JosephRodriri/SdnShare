#!/usr/bin/env bash
# scripts/watch_ddos.sh
# ---------------------------
# Tail de logs del controller con eventos DDoS coloreados.
# Ejecutar desde la VM host.
#
# Uso:
#   chmod +x scripts/watch_ddos.sh
#   ./scripts/watch_ddos.sh

RED='\033[1;31m'; YELLOW='\033[1;33m'; GREEN='\033[1;32m'
CYAN='\033[1;36m'; BLUE='\033[1;34m'; NC='\033[0m'

echo ""
echo "--------------------------------------------------------------------------"
echo -e "  ${CYAN}Monitor DDoS — controller logs en tiempo real${NC}"
echo "  Ctrl-C para detener"
echo "--------------------------------------------------------------------------"
echo ""

docker compose logs -f controller 2>&1 | while IFS= read -r line; do
    if echo "$line" | grep -qE "ATAQUE DETECTADO|ATTACK DETECTED"; then
        printf "${RED}%s${NC}\n" "$line"
    elif echo "$line" | grep -qE "BLOQUEADO|BLOCKED"; then
        printf "${YELLOW}%s${NC}\n" "$line"
    elif echo "$line" | grep -q "DDOS_EVENT"; then
        printf "${CYAN}%s${NC}\n" "$line"
    elif echo "$line" | grep -qE "expirado|expired"; then
        printf "${GREEN}%s${NC}\n" "$line"
    elif echo "$line" | grep -q "registrado\|Registered datapath"; then
        printf "${BLUE}%s${NC}\n" "$line"
    elif echo "$line" | grep -q "Mitigator"; then
        printf "${CYAN}%s${NC}\n" "$line"
    else
        echo "$line"
    fi
done