#!/usr/bin/env bash
# scripts/watch_ddos.sh
# ─────────────────────
# Tail controller logs and highlight DDoS detection events.
# Run from the host VM (not inside any container).
#
# Usage:
#   chmod +x scripts/watch_ddos.sh
#   ./scripts/watch_ddos.sh

set -euo pipefail

echo "════════════════════════════════════════════════════════"
echo "  DDoS Event Monitor — watching controller logs"
echo "  Press Ctrl-C to stop"
echo "════════════════════════════════════════════════════════"
echo ""

docker compose logs -f controller 2>&1 | while IFS= read -r line; do
    # Highlight ATTACK DETECTED lines in red
    if echo "$line" | grep -q "ATTACK DETECTED"; then
        printf "\033[1;31m%s\033[0m\n" "$line"
    # Highlight BLOCKED lines in yellow
    elif echo "$line" | grep -q "BLOCKED"; then
        printf "\033[1;33m%s\033[0m\n" "$line"
    # Highlight DDOS_EVENT structured lines in cyan
    elif echo "$line" | grep -q "DDOS_EVENT"; then
        printf "\033[1;36m%s\033[0m\n" "$line"
    # Highlight block expiry in green
    elif echo "$line" | grep -q "Block expired"; then
        printf "\033[1;32m%s\033[0m\n" "$line"
    else
        echo "$line"
    fi
done