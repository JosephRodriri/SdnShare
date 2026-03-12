# SDN DDoS Detection Lab

Laboratorio para detección de ataques DDoS en redes SDN (Software Defined Networking) con capacidades de monitoreo y Machine Learning.

## Requisitos del Sistema

- **Sistema Operativo**: Linux (Debian/Ubuntu/Kali Linux)
- **Python**: 3.10 o superior
- **Docker**: 20.10 o superior
- **Docker Compose**: 2.0 o superior
- **Memoria RAM**: Mínimo 4GB (recomendado 8GB)
- **Privilegios**: Acceso sudo/root para instalación

##快速开始 (Quick Start)

```bash
# 1. Instalar todas las dependencias
sudo ./install_deps.sh

# 2. Iniciar sesión y cerrar para que Docker funcione sin sudo
logout

# 3. Activar entorno virtual (opcional)
source venv/bin/activate

# 4. Levantar servicios de monitoreo
make up

# 5. Abrir terminal con tmux (opcional)
./open_terminal.sh
```

## Estructura del Proyecto

```
SdnShare/
├── auto_attack.sh           # Script de ataques automáticos
├── docker-compose.yaml      # Orquestación de contenedores
├── install_deps.sh          # Script de instalación
├── Makefile                 # Comandos útiles
├── open_terminal.sh         # Terminal tmux
├── requirements.txt         # Dependencias Python
├── pyproject.toml          # Configuración del proyecto
├── infra/
│   ├── attacks/             # Escenarios de ataque
│   ├── configs/            # Configuraciones de red
│   ├── controller/         # Controlador SDN Ryu
│   ├── dashboards/         # Dashboards Grafana
│   ├── docker/            # Dockerfiles
│   ├── monitoring/         # Scripts de monitoreo
│   └── topology/           # Topologías Mininet
├── ml/                     # Modelos Machine Learning
├── pipeline/               # Pipeline de datos
├── scripts/                # Scripts auxiliares
├── tests/                  # Tests unitarios
├── graphite/               # Datos Graphite
├── influxdb/               # Datos InfluxDB
├── grafana/                # Datos Grafana
└── prometheus/             # Datos Prometheus
```

## Servicios Disponibles

| Servicio | URL | Descripción |
|----------|-----|-------------|
| FlowManager | http://localhost:8080 | Interfaz del controlador SDN |
| Grafana | http://localhost:3000 | Dashboard de métricas |
| Prometheus | http://localhost:9090 | Monitor de métricas |
| Graphite | http://localhost:9000 | Almacenamiento de series temporales |

**Credenciales Grafana**: admin / admin

## Comandos Principales (Makefile)

```bash
# Instalación
make setup              # Levanta controller + mininet
make up               # Levanta todos los servicios (monitor + infra)
make down             # Detiene todos los servicios

# Topología
make topo             # Inicia topología spine-leaf en Mininet
make topo-clean       # Limpia topología Mininet

# Monitoreo
make monitor          # Abre terminal tmux con monitor DDoS

# Calidad de código
make test             # Ejecuta tests
make lint             # Ejecuta linter
make clean            # Limpia cache
```

## Uso de Scripts de Ataque

### Ataque Automático

```bash
# Ver ayuda
./auto_attack.sh --help

# Ataque ICMP flood
./auto_attack.sh icmp --duration 30

# Ataque TCP SYN flood
./auto_attack.sh syn --duration 30

# Ataque UDP flood
./auto_attack.sh udp --duration 30

# Ataque HTTP
./auto_attack.sh http --duration 30

# Escaneo de puertos
./auto_attack.sh portscan --duration 60

# Slowloris attack
./auto_attack.sh slowloris --duration 30
```

### Captura de Métricas

```bash
# Capturar configuración de Grafana
./scripts/capture_attack.sh
```

## Dependencias

### Sistema (automáticamente instalado por install_deps.sh)

- git, make, sudo, tmux
- openvswitch-switch
- python3, python3-pip, python3-venv
- hping3, iperf3, nmap, apache2-utils
- curl, wget

### Python (requirements.txt)

- Ryu (controlador SDN)
- Mininet (emulador de red)
- Pandas, NumPy, Scikit-learn (ML)
- Graphite, InfluxDB, Prometheus (monitoreo)
- PyYAML, Pydantic (configuración)

### Docker

- martimy/ryu-flowmanager (controlador)
- martimy/mininet (emulador)
- graphiteapp/graphite-statsd
- prom/prometheus
- influxdb:1.8
- grafana/grafana:10.4.3

## Solución de Problemas

### Docker no funciona sin sudo

```bash
# Cerrar sesión y volver a iniciar
logout

# O añadir usuario al grupo docker
sudo usermod -aG docker $USER
```

### Error de permisos en el entorno virtual

```bash
# Recrear el entorno virtual
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Los contenedores no inician

```bash
# Ver logs de Docker
docker compose logs

# Reconstruir imágenes
docker compose build --no-cache
```

### Conflictos de puertos

```bash
# Ver qué está usando los puertos
sudo netstat -tulpn | grep -E ':(3000|6633|6653|8080|9090|2003)'
```

## Arquitectura

El laboratorio utiliza una arquitectura SDN con:

1. **Controlador Ryu**: Implementa OpenFlow para gestionar flujos
2. **Mininet**: Emula la topología de red
3. **Grafana**: Visualización de métricas
4. **Prometheus/Graphite/InfluxDB**: Almacenamiento de métricas

Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para más detalles.

## Licencia

MIT
