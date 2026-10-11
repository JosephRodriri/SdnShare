#!/usr/bin/env python3
"""
01_extract.py — Extract network capture from Docker container and convert to CSV.

If the input is a .pcap file, runs tshark inside the Docker container to produce
a CSV with the 10 standard fields used by this pipeline.

If the input is already a .csv file, copies it directly to the output path.

The script is idempotent: if the output already exists, it skips processing unless
--force is passed.

Usage:
    python 01_extract.py --input /tmp/capture.pcap [--service mininet]
                         [--output datasets/raw/capture_raw.csv] [--force]

    python 01_extract.py --input /tmp/capture.csv
                         --output datasets/raw/capture_raw.csv --force
"""
import argparse
import logging
import shutil
import subprocess
import sys
from pathlib import Path

TSHARK_FIELDS = [
    "frame.number",
    "frame.time_relative",
    "ip.src",
    "ip.dst",
    "ip.proto",
    "tcp.srcport",
    "tcp.dstport",
    "tcp.flags.str",
    "tcp.window_size",
    "frame.len",
]


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def build_tshark_cmd(service: str, pcap_path: str) -> list:
    fields_args = []
    for f in TSHARK_FIELDS:
        fields_args += ["-e", f]
    return (
        ["docker", "compose", "exec", service, "tshark", "-r", pcap_path,
         "-T", "fields", "-E", "header=y", "-E", "separator=,"]
        + fields_args
    )


def extract(input_path: str, service: str, output_path: Path, force: bool) -> None:
    log = logging.getLogger(__name__)

    if output_path.exists() and not force:
        log.info("Output already exists: %s. Use --force to overwrite.", output_path)
        return

    output_path.parent.mkdir(parents=True, exist_ok=True)

    if input_path.lower().endswith(".pcap"):
        log.info("Converting %s via tshark in Docker service '%s'", input_path, service)
        cmd = build_tshark_cmd(service, input_path)
        log.info("Running: %s", " ".join(cmd))

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            log.error("tshark failed (exit %d): %s", result.returncode, result.stderr.strip())
            sys.exit(1)

        output_path.write_text(result.stdout, encoding="utf-8")
        row_count = len(result.stdout.splitlines()) - 1  # subtract header
        log.info("Saved %d rows to %s", row_count, output_path)

    elif input_path.lower().endswith(".csv"):
        log.info("Input is CSV, copying to %s", output_path)
        shutil.copy2(input_path, output_path)
        log.info("Copied %s -> %s", input_path, output_path)

    else:
        log.error("Unsupported input format: %s. Expected .pcap or .csv", input_path)
        sys.exit(1)


def main():
    setup_logging()
    parser = argparse.ArgumentParser(description="Extract network capture to standard CSV")
    parser.add_argument("--input", required=True, help="Path to .pcap or .csv file (inside Docker for pcap)")
    parser.add_argument("--service", default="mininet", help="Docker Compose service with tshark (default: mininet)")
    parser.add_argument("--output", default="datasets/raw/capture_raw.csv", help="Output CSV path")
    parser.add_argument("--force", action="store_true", help="Overwrite existing output")
    args = parser.parse_args()

    extract(args.input, args.service, Path(args.output), args.force)


if __name__ == "__main__":
    main()
