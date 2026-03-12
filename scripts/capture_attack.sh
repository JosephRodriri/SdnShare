#!/bin/bash
# Script para capturar configuración de dashboards de Grafana
# Detectar el directorio del proyecto automáticamente

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

python3 - <<'EOF'
import json, urllib.request, base64, os

# Detectar directorio del proyecto
project_root = os.environ.get('PROJECT_ROOT', '/home/kali/SdnShare')

creds = base64.b64encode(b'admin:admin').decode()
headers = {'Authorization': f'Basic {creds}', 'Content-Type': 'application/json'}

def get_uid(name):
    req = urllib.request.Request(f'http://localhost:3000/api/datasources/name/{name}', headers=headers)
    return json.loads(urllib.request.urlopen(req).read())['uid']

try:
    uid_prom  = get_uid('prometheus')
    uid_graph = get_uid('graphite')
    uid_infl  = get_uid('influxdb')
    print(f"Prometheus: {uid_prom} | Graphite: {uid_graph} | InfluxDB: {uid_infl}")
    
    dashboard_path = os.path.join(project_root, 'infra/dashboards/metrics-dashboard.json')
    with open(dashboard_path) as f:
        content = f.read()
    
    # Reemplazar UIDs hardcodeados con los reales
    content = content.replace('cfefc64p8nzlsa', uid_prom)
    content = content.replace('bfefc8vr7pm9sb', uid_graph)
    content = content.replace('afefcai2avuv4e', uid_infl)
    
    dashboard = json.loads(content)
    dashboard.pop('id', None)
    dashboard['uid'] = 'sdnshare-allmetrics'
    
    payload = json.dumps({'dashboard': dashboard, 'overwrite': True, 'folderId': 0}).encode()
    req = urllib.request.Request('http://localhost:3000/api/dashboards/db', data=payload, headers=headers)
    result = json.loads(urllib.request.urlopen(req).read())
    print(f"Dashboard: http://localhost:3000{result['url']}")
except Exception as e:
    print(f"Error: {e}")
    print("Asegúrate de que Grafana esté ejecutándose en localhost:3000")

EOF
