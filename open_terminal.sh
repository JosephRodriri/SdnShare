#!/bin/bash

echo "🚀 Iniciando lab DDoS con tmux..."

# Crear sesión tmux
tmux new-session -d -s ddos_lab

# Panel 0: Monitor
tmux send-keys -t ddos_lab:0 'cd ~/Desktop/a && ./scripts/ddos_monitor.sh' C-m

# Panel 1: Mininet
tmux split-window -v -t ddos_lab:0
tmux send-keys -t ddos_lab:0.1 'cd ~/Desktop/a && docker compose exec -it mininet ./scripts/mn_spineleaf_topo.py scripts/network_config.yaml' C-m

# Panel 2: Comandos de ataque (espera a que mininet inicie)
tmux split-window -h -t ddos_lab:0.0
tmux send-keys -t ddos_lab:0.2 'sleep 5 && echo "Panel de ataques listo. Ejecuta comandos aqui."' C-m

# Adjuntar a la sesión
tmux attach-session -t ddos_lab