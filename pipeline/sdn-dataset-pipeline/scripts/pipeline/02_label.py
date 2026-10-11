#!/usr/bin/env python3
"""
02_label.py — Assign attack labels to packets.

Adds a 'label' column with values: NORMAL, DDOS, PORTSCAN, ARP_SPOOF.

Two labeling methods:

  filename  (default)
    Infers the label from the input filename prefix.
    Mapping: ddos_* | syn_* | synflood_* → DDOS
             portscan_* | scan_*         → PORTSCAN
             arp_* | arpspoof_*          → ARP_SPOOF
             normal_* | (anything else)  → NORMAL

  timestamp
    Assigns labels to time ranges using a JSON intervals file.
    Packets outside any interval get --default-label (default: NORMAL).

    Intervals JSON format:
        [
            {"label": "DDOS",     "start": 10.5, "end": 45.2},
            {"label": "PORTSCAN", "start": 60.0, "end": 90.0}
        ]
    Times are in seconds (frame.time_relative).

Usage:
    python 02_label.py --input datasets/raw/ddos_raw.csv
                       --output datasets/raw/ddos_labeled.csv
                       --method filename

    python 02_label.py --input datasets/raw/combined_raw.csv
                       --output datasets/raw/combined_labeled.csv
                       --method timestamp
                       --intervals intervals.json
                       --default-label NORMAL
"""
import argparse
import json
import logging
import sys
from pathlib import Path

import pandas as pd

FILENAME_PREFIX_MAP = {
    "ddos":      "DDOS",
    "syn":       "DDOS",
    "synflood":  "DDOS",
    "portscan":  "PORTSCAN",
    "scan":      "PORTSCAN",
    "arp":       "ARP_SPOOF",
    "arpspoof":  "ARP_SPOOF",
    "normal":    "NORMAL",
}

VALID_LABELS = {"NORMAL", "DDOS", "PORTSCAN", "ARP_SPOOF"}


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def infer_label_from_filename(filename: str) -> str:
    """Return the label implied by the file's name prefix (case-insensitive)."""
    stem = Path(filename).stem.lower()
    for prefix, label in FILENAME_PREFIX_MAP.items():
        if stem == prefix or stem.startswith(prefix + "_") or stem.startswith(prefix + "-"):
            return label
    return "NORMAL"


def label_by_timestamp(df: pd.DataFrame, intervals: list, default_label: str) -> pd.Series:
    """Assign labels based on frame.time_relative falling within each interval."""
    labels = pd.Series(default_label, index=df.index, dtype=str)
    time_col = pd.to_numeric(df["frame.time_relative"], errors="coerce")

    for interval in intervals:
        lbl = interval["label"].upper()
        if lbl not in VALID_LABELS:
            logging.getLogger(__name__).warning(
                "Unknown label '%s' in intervals file — will be used as-is.", lbl
            )
        mask = (time_col >= interval["start"]) & (time_col <= interval["end"])
        labels[mask] = lbl

    return labels


def main():
    setup_logging()
    log = logging.getLogger(__name__)

    parser = argparse.ArgumentParser(description="Label packets with attack type")
    parser.add_argument("--input",  required=True, help="Input CSV (from 01_extract.py)")
    parser.add_argument("--output", required=True, help="Output CSV with 'label' column")
    parser.add_argument("--method", choices=["filename", "timestamp"], default="filename",
                        help="Labeling method (default: filename)")
    parser.add_argument("--intervals", help="JSON file with timestamp intervals (--method timestamp)")
    parser.add_argument("--default-label", default="NORMAL",
                        help="Label for packets outside any interval (default: NORMAL)")
    parser.add_argument("--force", action="store_true", help="Overwrite existing output")
    args = parser.parse_args()

    out_path = Path(args.output)
    if out_path.exists() and not args.force:
        log.info("Output exists: %s. Use --force to overwrite.", out_path)
        return

    log.info("Loading %s", args.input)
    df = pd.read_csv(args.input, low_memory=False)
    log.info("Loaded %d rows", len(df))

    if args.method == "filename":
        label = infer_label_from_filename(args.input)
        log.info("Filename method: assigning label '%s' to all %d rows", label, len(df))
        df["label"] = label

    elif args.method == "timestamp":
        if not args.intervals:
            log.error("--intervals is required when --method timestamp is used")
            sys.exit(1)
        if "frame.time_relative" not in df.columns:
            log.error("Column 'frame.time_relative' not found in input CSV")
            sys.exit(1)

        intervals = json.loads(Path(args.intervals).read_text(encoding="utf-8"))
        log.info("Timestamp method: %d intervals loaded", len(intervals))
        df["label"] = label_by_timestamp(df, intervals, args.default_label.upper())

    dist = df["label"].value_counts().to_dict()
    log.info("Label distribution: %s", dist)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_path, index=False)
    log.info("Saved labeled CSV to %s", out_path)


if __name__ == "__main__":
    main()
