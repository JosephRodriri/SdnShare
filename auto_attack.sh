#!/usr/bin/env bash
# auto_attack.sh
# Detecta hosts en Mininet (dentro del contenedor) y ejecuta un ataque seleccionado
# Uso: ./auto_attack.sh <attack> [--attacker hX] [--victim hY] [--duration N]
# ataques: icmp syn udp http

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
      if [[ $# -lt 2 ]]; then echo "Missing value for --attacker"; exit 1; fi
      ATTACKER="$2"; shift 2;;
    --victim)
      if [[ $# -lt 2 ]]; then echo "Missing value for --victim"; exit 1; fi
      VICTIM="$2"; shift 2;;
    --duration)
      if [[ $# -lt 2 ]]; then echo "Missing value for --duration"; exit 1; fi
      DURATION="$2"; shift 2;;
    -h|--help) echo "Usage: $0 <icmp|syn|udp|http> [--attacker h1] [--victim h2] [--duration 10]"; exit 0;;
    *) echo "Unknown arg $1"; exit 1;;
  esac
done

if [[ -z "$ATTACK" ]]; then
  echo "Specify attack type: icmp|syn|udp|http"
  exit 1
fi

# Ensure mininet container is running
if ! docker compose ps --services --filter "status=running" | grep -q "mininet"; then
  echo "Mininet container not running. Start with: docker compose up -d" >&2
  exit 1
fi

# Helper to run commands inside mininet container
dc_exec() { docker compose exec -T mininet bash -lc "$*"; }

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
  # Get all IPv4 addresses in the host namespace (one per line)
  ips=$(dc_exec "mnexec -a $pid ip -4 addr show 2>/dev/null | awk '/inet/ {print \$2}' | cut -d'/' -f1 || true")

  # Prefer the first non-loopback address
  ip_non_loop=$(echo "$ips" | tr '\n' '\n' | grep -v '^127\.' | head -n1 || true)
  if [[ -n "$ip_non_loop" ]]; then
    name_to_ip[$name]="$ip_non_loop"
  else
    # Fallback: use first address if available (may be loopback)
    ip_first=$(echo "$ips" | head -n1 || true)
    name_to_ip[$name]="${ip_first:-}"
  fi
done

# Show discovered hosts
echo "Discovered hosts (name -> pid -> ip):"
for name in $(echo "${!name_to_pid[@]}" | tr ' ' '\n' | sort); do
  echo "  $name -> pid=${name_to_pid[$name]} ip=${name_to_ip[$name]:-N/A}"
done

# Choose attacker and victim defaults if not provided
all_hosts=($(for n in "${!name_to_pid[@]}"; do echo $n; done | sort))
if [[ -z "$ATTACKER" ]]; then
  ATTACKER=${all_hosts[0]}
fi
if [[ -z "$VICTIM" ]]; then
  # pick first host that is not attacker and has an IP
  for h in "${all_hosts[@]}"; do
    if [[ "$h" != "$ATTACKER" && -n "${name_to_ip[$h]}" ]]; then
      VICTIM=$h
      break
    fi
  done
  # fallback to second host name if none found
  if [[ -z "$VICTIM" && ${#all_hosts[@]} -gt 1 ]]; then
    VICTIM=${all_hosts[1]}
  fi
fi

if [[ -z "$VICTIM" ]]; then
  echo "Could not determine victim host." >&2
  exit 1
fi

ATTACKER_PID=${name_to_pid[$ATTACKER]}
VICTIM_PID=${name_to_pid[$VICTIM]}
ATTACKER_IP=${name_to_ip[$ATTACKER]}
VICTIM_IP=${name_to_ip[$VICTIM]}

if [[ -z "$VICTIM_IP" ]]; then
  echo "Victim $VICTIM has no IP assigned. Aborting." >&2
  exit 1
fi

echo "Using attacker=$ATTACKER (pid=$ATTACKER_PID ip=${ATTACKER_IP:-N/A})"
echo "Using victim=$VICTIM (pid=$VICTIM_PID ip=$VICTIM_IP)"

# Helper to check tool existence
check_tool() {
  if ! dc_exec "command -v $1 >/dev/null"; then
    echo "❌ Error: Tool '$1' not found inside Mininet container. Install it in the Dockerfile." >&2
    echo "   Quick fix: docker compose exec mininet apt-get update && docker compose exec mininet apt-get install -y $1" >&2
    exit 1
  fi
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
    dc_exec "mnexec -a $VICTIM_PID iperf3 -s &"
    dc_exec "mnexec -a $ATTACKER_PID hping3 -S -p 5001 --flood $VICTIM_IP >/tmp/auto_hping.log 2>&1 & sleep $DURATION; pkill hping3 || true; pkill iperf3 || true"
    ;;
  udp)
    check_tool hping3
    check_tool iperf3
    # iperf3 server no usa -u y por defecto va al 5201. Forzamos 5001 para coincidir con hping3.
    dc_exec "mnexec -a $VICTIM_PID iperf3 -s -p 5001 >/dev/null 2>&1 &"
    dc_exec "mnexec -a $ATTACKER_PID hping3 --udp -p 5001 --flood $VICTIM_IP >/tmp/auto_hping.log 2>&1 & sleep $DURATION; pkill hping3 || true; pkill -f iperf3 || true"
    ;;
  http)
    dc_exec "mnexec -a $VICTIM_PID python3 -m http.server 80 >/dev/null 2>&1 &"
    # try to use ab if available, otherwise wget loop
    # Usamos timeout para el loop de wget y -t para ab
    dc_exec "mnexec -a $ATTACKER_PID bash -lc 'if command -v ab >/dev/null 2>&1; then ab -t $DURATION -n 1000000 -c 50 http://$VICTIM_IP/ >/tmp/auto_ab.log 2>&1; elif command -v curl >/dev/null 2>&1; then end=\$((SECONDS + $DURATION)); while [ \$SECONDS -lt \$end ]; do curl -s http://$VICTIM_IP/ >/dev/null; done; elif command -v wget >/dev/null 2>&1; then end=\$((SECONDS + $DURATION)); while [ \$SECONDS -lt \$end ]; do wget -qO- http://$VICTIM_IP/ >/dev/null; done; else end=\$((SECONDS + $DURATION)); while [ \$SECONDS -lt \$end ]; do python3 -c \"import urllib.request; urllib.request.urlopen('\''http://$VICTIM_IP/'\'')\" >/dev/null 2>&1; done; fi'"
    dc_exec "mnexec -a $VICTIM_PID pkill -f http.server || true"
    ;;
  *) echo "Unknown attack '$ATTACK'"; exit 2;;
esac

echo "Attack finished. Logs: /tmp/auto_hping.log (inside mininet container)"
echo "--- Last logs ---"
dc_exec "tail -n 5 /tmp/auto_hping.log 2>/dev/null || tail -n 5 /tmp/auto_ab.log 2>/dev/null || echo 'No logs found'"
echo "-----------------"

echo "To inspect victim counters:"
echo "  PID_VICTIM=$VICTIM_PID"
echo "  docker compose exec -T mininet mnexec -a $VICTIM_PID cat /proc/net/dev"

exit 0