#!/bin/bash
#
# Script de instalación de dependencias para el proyecto SDN DDoS Detection.
#
# Este script automatiza la instalación de paquetes del sistema, Docker y
# las dependencias de Python necesarias para ejecutar el laboratorio.
#
# Diseñado para sistemas basados en Debian (Ubuntu, Kali, etc.).

set -e # Salir inmediatamente si un comando falla

# --- Colores para la salida ---
RED='\033[1;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# --- Verificación de privilegios ---
# Si no se ejecuta como root, vuelve a ejecutar el script con sudo.
# Nota: Comprobamos si 'sudo' existe más adelante, pero esto maneja el caso común.
if [[ $EUID -ne 0 ]]; then
    echo -e "${YELLOW}Este script necesita privilegios de superusuario para instalar paquetes.${NC}"
    if command -v sudo &> /dev/null; then
        echo "Volviendo a ejecutar con sudo..."
        sudo -E "$0" "$@"
        exit $?
    else
        echo -e "${RED}Error: No eres root y 'sudo' no está instalado.${NC}"
        echo "Por favor, ejecuta este script como root: 'su -' y luego ./install_deps.sh"
        exit 1
    fi
fi

# El usuario que ejecutó 'sudo'
# Si el script se inició como root, $SUDO_USER estará vacío.
# Usamos 'whoami' como fallback seguro si logname falla en entornos no interactivos.
ORIGINAL_USER=${SUDO_USER:-$(whoami)}
USER_HOME=$(eval echo "~$ORIGINAL_USER")

# --- Funciones ---

detect_os() {
    echo -e "${BLUE}🔎 Detectando sistema operativo...${NC}"
    if ! command -v apt-get &> /dev/null; then
        echo -e "${RED}Error: Gestor de paquetes 'apt-get' no encontrado.${NC}"
        echo "Este script está optimizado para Debian/Ubuntu/Kali."
        echo "Para otros sistemas (Fedora, CentOS), necesitarás instalar los paquetes equivalentes manualmente."
        exit 1
    fi
    echo -e "${GREEN}✓ Sistema compatible detectado (basado en Debian).${NC}\n"
}

install_system_deps() {
    echo -e "${BLUE}📦 Instalando dependencias del sistema...${NC}"
    echo "Esto puede tardar varios minutos."

    # Paquetes identificados en los scripts del proyecto
    # Herramientas de red para ataques y pruebas
    PACKAGES=(
        git
        make
        sudo
        tmux
        openvswitch-switch
        bc
        python3
        python3-pip
        python3-venv
        # Herramientas de ataque (necesarias para auto_attack.sh)
        hping3
        iperf3
        nmap
        apache2-utils  # Para la herramienta 'ab'
        # Herramientas adicionales para ataques específicos
        build-essential
        libssl-dev
        curl
        wget
    )

    apt-get update
    apt-get install -y "${PACKAGES[@]}"
    echo -e "${GREEN}✓ Dependencias del sistema instaladas correctamente.${NC}\n"
    
    # Verificar que Python se instaló correctamente
    if ! command -v python3 &> /dev/null; then
         echo -e "${RED}Error crítico: Python3 no se pudo instalar.${NC}"; exit 1;
    fi
}

install_docker() {
    echo -e "${BLUE}🐳 Instalando Docker y Docker Compose...${NC}"
    if command -v docker &> /dev/null; then
        echo -e "${YELLOW}Docker ya parece estar instalado. Omitiendo.${NC}"
    else
        echo "Instalando Docker desde el script oficial..."
        curl -fsSL https://get.docker.com -o get-docker.sh
        sh get-docker.sh
        rm get-docker.sh
        echo -e "${GREEN}✓ Docker instalado.${NC}"
    fi

    apt-get install -y docker-compose-plugin

    if id -nG "$ORIGINAL_USER" | grep -qw "docker"; then
        echo -e "${YELLOW}El usuario '$ORIGINAL_USER' ya pertenece al grupo 'docker'.${NC}"
    else
        echo "Añadiendo al usuario '$ORIGINAL_USER' al grupo 'docker'..."
        usermod -aG docker "$ORIGINAL_USER"
        echo -e "${GREEN}✓ Usuario añadido. Necesitarás cerrar sesión y volver a iniciar para que los cambios surtan efecto.${NC}"
    fi
    echo ""
}

setup_python_env() {
    echo -e "${BLUE}🐍 Configurando entorno virtual de Python...${NC}"
    
    # Asegurar que estamos en el directorio del script
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
    PROJECT_ROOT="$SCRIPT_DIR"
    VENV_DIR="$PROJECT_ROOT/venv"
    REQ_FILE="$PROJECT_ROOT/requirements.txt"

    # Cambiar al directorio del proyecto para asegurar rutas relativas
    cd "$PROJECT_ROOT"

    if [ -d "$VENV_DIR" ]; then
        echo -e "${YELLOW}El directorio del entorno virtual '$VENV_DIR' ya existe. Omitiendo creación.${NC}"
    else
        echo "Creando entorno virtual en '$VENV_DIR'..."
        sudo -u "$ORIGINAL_USER" python3 -m venv "$VENV_DIR"
        echo -e "${GREEN}✓ Entorno virtual creado.${NC}"
    fi

    echo "Instalando dependencias de Python desde el proyecto..."
    
    # Actualizar pip primero
    sudo -u "$ORIGINAL_USER" "$VENV_DIR/bin/pip" install --upgrade pip

    if [ -f "$REQ_FILE" ]; then
        sudo -u "$ORIGINAL_USER" "$VENV_DIR/bin/pip" install -r "$REQ_FILE"
        echo -e "${GREEN}✓ Dependencias instaladas desde requirements.txt.${NC}\n"
    else
        echo -e "${YELLOW}Aviso: No se encontró requirements.txt. Intentando instalación setup.py (si existe)...${NC}"
        sudo -u "$ORIGINAL_USER" "$VENV_DIR/bin/pip" install -e . || echo "⚠️ No se encontraron definiciones de dependencias."
    fi
}

main() {
    detect_os
    install_system_deps
    install_docker
    setup_python_env
    echo -e "${GREEN}🎉 ¡Instalación completada! 🎉${NC}\n${YELLOW}⚠️  Acción requerida:${NC} Cierra sesión y vuelve a iniciarla para usar Docker sin 'sudo'.\n\n${BLUE}Próximos pasos:${NC}\n1. Activa el entorno virtual: ${CYAN}source venv/bin/activate${NC}\n2. Levanta el laboratorio: ${CYAN}make up${NC}"
}

main