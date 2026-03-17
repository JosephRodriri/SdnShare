# =============================================================================
# Makefile.sniff — Módulo de captura de tráfico con tshark
# Incluir desde el Makefile principal con: include scripts/Makefile.sniff
#
# Uso:
#   make sniff                              Menú interactivo
#   make sniff-normal                       Tráfico general (todos los hosts)
#   make sniff-ddos                         Detecta SYN flood
#   make sniff-portscan                     Detecta escaneo de puertos
#   make sniff-arp                          Detecta ARP spoofing
#   make sniff-icmp                         Solo ping / ICMP
#   make sniff-udp                          Solo UDP / streaming
#   make sniff-host H=10.1.1.10             Filtra por host específico
#   make sniff-between S=10.1.1.10 D=10.1.1.30   Entre dos hosts
#   make sniff-save                         Guarda captura a .pcap
#   make sniff-replay                       Reproduce .pcap guardado
#
# Variables override:
#   IFACE   Interfaz a capturar (default: any)
#   COUNT   Número de paquetes (default: 0 = infinito)
#   PCAP    Ruta del archivo de salida (default: /tmp/capture.pcap)
#   H       IP del host a filtrar (default: 10.1.1.10)
#   S / D   IP origen / destino para sniff-between
# =============================================================================

# --- Colores ---
CYAN   := \033[36m
GREEN  := \033[32m
YELLOW := \033[33m
RED    := \033[31m
RESET  := \033[0m

# --- Defaults ---
IFACE ?= any
COUNT ?= 0
H     ?= 10.1.1.10
S     ?= 10.1.1.10
D     ?= 10.1.1.20
PCAP  ?= /tmp/capture.pcap

# --- Campos base reutilizables ---
FIELDS_TCP = \
	-e frame.number \
	-e frame.time_relative \
	-e ip.src \
	-e ip.dst \
	-e ip.proto \
	-e tcp.srcport \
	-e tcp.dstport \
	-e tcp.flags.str \
	-e tcp.window_size \
	-e frame.len

FIELDS_ARP = \
	-e frame.number \
	-e frame.time_relative \
	-e arp.src.hw_mac \
	-e arp.src.proto_ipv4 \
	-e arp.dst.hw_mac \
	-e arp.dst.proto_ipv4 \
	-e arp.opcode

FORMAT = -T fields -E header=y -E separator=, -E quote=d

# =============================================================================
# MENÚ — make sniff
# =============================================================================
.PHONY: sniff
sniff:
	@echo ""
	@echo "$(CYAN)╔══════════════════════════════════════════════╗$(RESET)"
	@echo "$(CYAN)║     🦈  SDN Packet Sniffer — SdnShare       ║$(RESET)"
	@echo "$(CYAN)╚══════════════════════════════════════════════╝$(RESET)"
	@echo ""
	@echo "  $(GREEN)Modos de captura:$(RESET)"
	@echo ""
	@echo "  $(YELLOW)make sniff-normal$(RESET)                       Tráfico general"
	@echo "  $(YELLOW)make sniff-ddos$(RESET)                         Detectar SYN Flood"
	@echo "  $(YELLOW)make sniff-portscan$(RESET)                     Detectar Port Scan"
	@echo "  $(YELLOW)make sniff-arp$(RESET)                          Detectar ARP Spoofing"
	@echo "  $(YELLOW)make sniff-icmp$(RESET)                         Solo ICMP / ping"
	@echo "  $(YELLOW)make sniff-udp$(RESET)                          Solo UDP / streaming"
	@echo "  $(YELLOW)make sniff-host H=10.1.1.40$(RESET)             Filtrar por host"
	@echo "  $(YELLOW)make sniff-between S=10.1.1.10 D=10.1.1.30$(RESET)  Entre dos hosts"
	@echo "  $(YELLOW)make sniff-save COUNT=1000$(RESET)              Guardar a .pcap"
	@echo "  $(YELLOW)make sniff-replay$(RESET)                       Reproducir .pcap"
	@echo ""
	@echo "  $(CYAN)Variables disponibles:$(RESET)"
	@echo "  IFACE=s21-eth3      Interfaz específica  (default: any)"
	@echo "  COUNT=500           Capturar N paquetes  (default: 0=infinito)"
	@echo "  PCAP=/tmp/ddos.pcap Ruta de archivo      (default: /tmp/capture.pcap)"
	@echo ""
	@echo "  $(CYAN)Interfaces de tu topología:$(RESET)"
	@echo "  s21-eth3 → h1    s21-eth4 → h2"
	@echo "  s22-eth3 → h3    s22-eth4 → h4"
	@echo "  s23-eth3 → h5    s23-eth4 → h6"
	@echo ""

# =============================================================================
# NORMAL — tráfico general
# =============================================================================
.PHONY: sniff-normal
sniff-normal:
	@echo "$(GREEN)🦈 [NORMAL] Tráfico general en $(IFACE) — $(COUNT) paquetes$(RESET)"
	@echo "$(CYAN)frame# | tiempo | src | dst | proto | sport | dport | flags | win | len$(RESET)"
	@echo "──────────────────────────────────────────────────────────────────────────"
	docker compose exec -T mininet tshark -l -i $(IFACE) -c $(COUNT) \
		$(FIELDS_TCP) \
		$(FORMAT)

# =============================================================================
# DDOS — detecta SYN flood
# Firma: muchos SYN sin ACK hacia mismo destino/puerto
# =============================================================================
.PHONY: sniff-ddos
sniff-ddos:
	@echo "$(RED)🔴 [DDoS] Detectando SYN Flood en $(IFACE)$(RESET)"
	@echo "$(CYAN)Filtro activo: tcp.flags.syn==1 AND tcp.flags.ack==0$(RESET)"
	@echo "$(CYAN)Señal de ataque: mismo dst + dstport con miles de paquetes/seg$(RESET)"
	@echo "──────────────────────────────────────────────────────────────────────────"
	docker compose exec -T mininet tshark -l -i $(IFACE) -c $(COUNT) \
		-Y "tcp.flags.syn==1 and tcp.flags.ack==0" \
		-e frame.number \
		-e frame.time_relative \
		-e ip.src \
		-e ip.dst \
		-e tcp.dstport \
		-e tcp.flags.str \
		-e frame.len \
		$(FORMAT)

# =============================================================================
# PORT SCAN — detecta nmap
# Firma: SYN hacia puertos consecutivos desde mismo origen
# =============================================================================
.PHONY: sniff-portscan
sniff-portscan:
	@echo "$(YELLOW)🟡 [PORTSCAN] Detectando escaneo de puertos en $(IFACE)$(RESET)"
	@echo "$(CYAN)Filtro activo: tcp.flags.syn==1$(RESET)"
	@echo "$(CYAN)Señal de ataque: mismo src, mismo dst, dstport incrementando$(RESET)"
	@echo "──────────────────────────────────────────────────────────────────────────"
	docker compose exec -T mininet tshark -l -i $(IFACE) -c $(COUNT) \
		-Y "tcp.flags.syn==1" \
		-e frame.number \
		-e frame.time_relative \
		-e ip.src \
		-e ip.dst \
		-e tcp.srcport \
		-e tcp.dstport \
		-e tcp.flags.str \
		-e frame.len \
		$(FORMAT)

# =============================================================================
# ARP SPOOF — detecta envenenamiento ARP
# Firma: ARP reply no solicitado, misma IP con diferente MAC
# =============================================================================
.PHONY: sniff-arp
sniff-arp:
	@echo "$(YELLOW)🟠 [ARP] Detectando ARP Spoofing en $(IFACE)$(RESET)"
	@echo "$(CYAN)Filtro activo: arp$(RESET)"
	@echo "$(CYAN)Señal de ataque: arp.opcode==2 (reply) con MAC distinta para misma IP$(RESET)"
	@echo "──────────────────────────────────────────────────────────────────────────"
	docker compose exec -T mininet tshark -l -i $(IFACE) -c $(COUNT) \
		-Y "arp" \
		$(FIELDS_ARP) \
		$(FORMAT)

# =============================================================================
# ICMP — solo ping
# =============================================================================
.PHONY: sniff-icmp
sniff-icmp:
	@echo "$(GREEN)🟢 [ICMP] Capturando ICMP en $(IFACE)$(RESET)"
	docker compose exec -T mininet tshark -l -i $(IFACE) -c $(COUNT) \
		-Y "icmp" \
		-e frame.number \
		-e frame.time_relative \
		-e ip.src \
		-e ip.dst \
		-e icmp.type \
		-e icmp.code \
		-e frame.len \
		$(FORMAT)

# =============================================================================
# UDP — streaming / iperf3
# =============================================================================
.PHONY: sniff-udp
sniff-udp:
	@echo "$(GREEN)🟢 [UDP] Capturando tráfico UDP en $(IFACE)$(RESET)"
	docker compose exec -T mininet tshark -l -i $(IFACE) -c $(COUNT) \
		-Y "udp" \
		-e frame.number \
		-e frame.time_relative \
		-e ip.src \
		-e ip.dst \
		-e udp.srcport \
		-e udp.dstport \
		-e frame.len \
		$(FORMAT)

# =============================================================================
# HOST — filtra por IP específica
# Uso: make sniff-host H=10.1.1.40
# =============================================================================
.PHONY: sniff-host
sniff-host:
	@echo "$(CYAN)🎯 [HOST] Filtrando tráfico de/hacia $(H) en $(IFACE)$(RESET)"
	docker compose exec -T mininet tshark -l -i $(IFACE) -c $(COUNT) \
		-Y "ip.src==$(H) or ip.dst==$(H)" \
		$(FIELDS_TCP) \
		$(FORMAT)

# =============================================================================
# BETWEEN — entre dos hosts
# Uso: make sniff-between S=10.1.1.10 D=10.1.1.30
# =============================================================================
.PHONY: sniff-between
sniff-between:
	@echo "$(CYAN)↔️  [BETWEEN] Capturando entre $(S) y $(D) en $(IFACE)$(RESET)"
	docker compose exec -T mininet tshark -l -i $(IFACE) -c $(COUNT) \
		-Y "(ip.src==$(S) and ip.dst==$(D)) or (ip.src==$(D) and ip.dst==$(S))" \
		$(FIELDS_TCP) \
		$(FORMAT)

# =============================================================================
# SAVE — guarda a .pcap para CICFlowMeter / análisis offline
# Uso: make sniff-save COUNT=5000 PCAP=/tmp/ddos_capture.pcap IFACE=s21-eth3
# =============================================================================
.PHONY: sniff-save
sniff-save:
	@echo "$(GREEN)💾 [SAVE] Guardando en $(PCAP) — interfaz $(IFACE) — $(COUNT) paquetes$(RESET)"
	@echo "$(CYAN)Detener con Ctrl+C cuando tengas suficientes paquetes$(RESET)"
	docker compose exec -T mininet tshark -i $(IFACE) -c $(COUNT) -w $(PCAP)
	@echo "$(GREEN)✅ Archivo guardado: $(PCAP)$(RESET)"
	@echo "$(CYAN)Para analizar: make sniff-replay PCAP=$(PCAP)$(RESET)"

# =============================================================================
# REPLAY — lee y muestra un .pcap guardado
# Uso: make sniff-replay PCAP=/tmp/ddos_capture.pcap
# =============================================================================
.PHONY: sniff-replay
sniff-replay:
	@echo "$(CYAN)▶️  [REPLAY] Leyendo $(PCAP)$(RESET)"
	docker compose exec -T mininet tshark -r $(PCAP) \
		$(FIELDS_TCP) \
		$(FORMAT)