#!/usr/bin/env bash
# run_pipeline.sh — Execute the full SDN dataset pipeline in 5 steps.
#
# Usage:
#   bash run_pipeline.sh <input_file> [dataset_name] [docker_service]
#
# Arguments:
#   input_file      Path to .pcap or .csv (pcap path is inside the Docker container)
#   dataset_name    Short identifier used for output filenames (default: capture)
#   docker_service  Docker Compose service that has tshark installed (default: mininet)
#
# Example:
#   bash run_pipeline.sh /tmp/ddos_run1.pcap ddos_lab1 mininet
#
# All outputs land under datasets/ and scripts/ relative to the current directory.
# Re-running is safe: each step checks for existing output and skips unless --force
# is added. To force a full re-run, set FORCE=1:
#   FORCE=1 bash run_pipeline.sh /tmp/ddos_run1.pcap ddos_lab1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

INPUT_FILE="${1:-}"
NAME="${2:-capture}"
SERVICE="${3:-mininet}"
FORCE_FLAG=""
[[ "${FORCE:-0}" == "1" ]] && FORCE_FLAG="--force"

if [[ -z "$INPUT_FILE" ]]; then
    echo "Usage: $0 <input.pcap|input.csv> [dataset_name] [docker_service]"
    echo ""
    echo "  input.pcap or input.csv   source capture (pcap path is inside Docker)"
    echo "  dataset_name              output file prefix           (default: capture)"
    echo "  docker_service            Docker service with tshark   (default: mininet)"
    echo ""
    echo "Set FORCE=1 to overwrite existing outputs."
    exit 1
fi

echo "============================================"
echo "  SDN Dataset Pipeline"
echo "  Input:   $INPUT_FILE"
echo "  Name:    $NAME"
echo "  Service: $SERVICE"
echo "============================================"
echo ""

echo "[1/5] Extraction — pcap/CSV -> raw CSV"
python "$SCRIPT_DIR/01_extract.py" \
    --input   "$INPUT_FILE" \
    --service "$SERVICE" \
    --output  "datasets/raw/${NAME}_raw.csv" \
    $FORCE_FLAG

echo ""
echo "[2/5] Labeling — add 'label' column"
python "$SCRIPT_DIR/02_label.py" \
    --input  "datasets/raw/${NAME}_raw.csv" \
    --output "datasets/raw/${NAME}_labeled.csv" \
    --method filename \
    $FORCE_FLAG

echo ""
echo "[3/5] Cleaning — drop invalid rows, normalize types"
python "$SCRIPT_DIR/03_clean.py" \
    --input            "datasets/raw/${NAME}_labeled.csv" \
    --output           "datasets/raw/${NAME}_clean.csv" \
    --drop-duplicates \
    $FORCE_FLAG

echo ""
echo "[4/5] Feature Engineering — 5-second rolling windows"
python "$SCRIPT_DIR/04_features.py" \
    --input  "datasets/raw/${NAME}_clean.csv" \
    --output "datasets/processed/${NAME}_features.csv" \
    --window 5.0 \
    $FORCE_FLAG

echo ""
echo "[5/5] Split & Export — 80/20 stratified split"
python "$SCRIPT_DIR/05_split_export.py" \
    --input "datasets/processed/${NAME}_features.csv" \
    --name  "$NAME" \
    $FORCE_FLAG

echo ""
echo "============================================"
echo "  Pipeline complete!"
echo ""
echo "  datasets/splits/train.csv"
echo "  datasets/splits/test.csv"
echo "  datasets/metadata/${NAME}_manifest.json"
echo "  datasets/raw/${NAME}_quality_report.json"
echo "============================================"
