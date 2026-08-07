#!/usr/bin/env python3
"""Export SDN metrics and mitigation events into one completed capture run."""

import argparse
import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
EVENTS_FILE = DATA_DIR / "mitigation_events.jsonl"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def export_measurement(base_url: str, database: str, measurement: str,
                       started_at: str, finished_at: str, destination: Path) -> None:
    query = (
        f"SELECT * FROM {measurement} WHERE time >= '{started_at}' "
        f"AND time <= '{finished_at}'"
    )
    params = urllib.parse.urlencode({"db": database, "q": query})
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/query?{params}",
        headers={"Accept": "application/csv"},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        payload = response.read().decode("utf-8")
    # Influx returns an error as a CSV response too; fail rather than write it
    # as if it were measurement data.
    if payload.startswith("error"):
        raise RuntimeError(payload.strip())
    destination.write_text(payload, encoding="utf-8")


def event_is_in_range(event: dict, started_at: str, finished_at: str) -> bool:
    timestamp = event.get("timestamp", "")
    return started_at <= timestamp <= finished_at


def export_events(started_at: str, finished_at: str, destination: Path) -> int:
    count = 0
    with destination.open("w", encoding="utf-8") as output:
        if not EVENTS_FILE.exists():
            return count
        for line in EVENTS_FILE.read_text(encoding="utf-8").splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                print("Advertencia: evento de mitigación inválido omitido", file=sys.stderr)
                continue
            if event_is_in_range(event, started_at, finished_at):
                json.dump(event, output, sort_keys=True)
                output.write("\n")
                count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Finaliza una captura: exporta InfluxDB y eventos de mitigación."
    )
    parser.add_argument("run_id", help="Identificador creado con generate_run_id.py")
    parser.add_argument("--influx-url", default="http://localhost:8086")
    parser.add_argument("--influx-db", default="ryu_monitor")
    args = parser.parse_args()

    run_dir = DATA_DIR / "raw" / args.run_id
    metadata_path = run_dir / "metadata.json"
    if not metadata_path.exists():
        parser.error(f"No existe {metadata_path}")

    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    started_at = metadata.get("capture_started_at") or metadata.get("created_at")
    if not started_at:
        parser.error("metadata.json no contiene capture_started_at ni created_at")
    finished_at = utc_now()

    metrics_files = []
    for measurement in ("port_stats", "flow_stats"):
        filename = f"{measurement}.csv"
        export_measurement(
            args.influx_url, args.influx_db, measurement, started_at, finished_at,
            run_dir / filename,
        )
        metrics_files.append(filename)

    events_file = "mitigation_events.jsonl"
    event_count = export_events(started_at, finished_at, run_dir / events_file)
    metadata.update({
        "metrics_files": metrics_files,
        "mitigation_events_file": events_file,
        "mitigation_events_count": event_count,
        "capture_finished_at": finished_at,
    })
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"Captura finalizada: {run_dir}")
    print(f"  Métricas: {', '.join(metrics_files)}")
    print(f"  Eventos de mitigación: {event_count}")


if __name__ == "__main__":
    main()
