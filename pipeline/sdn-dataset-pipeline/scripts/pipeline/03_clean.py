#!/usr/bin/env python3
"""
03_clean.py — Clean and validate the labeled capture CSV.

Cleaning steps (in order):
  1. Drop rows missing ip.src or ip.dst  (non-IP packets: raw ARP, 802.3, etc.)
  2. Convert tcp.flags.str to integer bitmask  → new column tcp_flags_num
  3. Normalize ip.proto, port fields, frame.len to integers; fill 0 for non-TCP rows
  4. Optionally drop exact duplicate rows
  5. Report out-of-range values (ports > 65535, negative lengths, etc.)
  6. Write a quality report JSON alongside the output

Why each step matters:
  - Non-IP rows have no ip.src/dst and can't contribute to IP-based features — keep
    them would introduce NaN and confuse the model.
  - The flags bitmask (tcp_flags_num) lets us compute syn_ratio numerically in step 4.
  - All-integer types are required for scikit-learn compatibility.

Usage:
    python 03_clean.py --input datasets/raw/capture_labeled.csv
                       --output datasets/raw/capture_clean.csv
                       [--drop-duplicates] [--force]
"""
import argparse
import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd

# Standard TCP flag bit positions (RFC 793 + extensions)
FLAG_BITS = {
    "F": 0x001,   # FIN
    "S": 0x002,   # SYN
    "R": 0x004,   # RST
    "P": 0x008,   # PSH
    "A": 0x010,   # ACK
    "U": 0x020,   # URG
    "E": 0x040,   # ECE
    "C": 0x080,   # CWR
    "N": 0x100,   # NS
}

KNOWN_PROTOS = {0, 1, 2, 6, 17, 41, 47, 50, 51, 58, 89, 112, 132}


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def parse_flags(flag_str) -> int:
    """Convert tshark tcp.flags.str to integer bitmask.

    Handles:
      - NaN / empty string → 0
      - Hex string '0x0002' → 2
      - Character string '·······S······' or '........S.......' → 2  (SYN)
    """
    if pd.isna(flag_str) or str(flag_str).strip() == "":
        return 0
    s = str(flag_str).strip()
    if s.startswith("0x") or s.startswith("0X"):
        try:
            return int(s, 16)
        except ValueError:
            return 0
    result = 0
    for ch in s.upper():
        if ch in FLAG_BITS:
            result |= FLAG_BITS[ch]
    return result


def main():
    setup_logging()
    log = logging.getLogger(__name__)

    parser = argparse.ArgumentParser(description="Clean and validate capture CSV")
    parser.add_argument("--input",  required=True, help="Labeled CSV (from 02_label.py)")
    parser.add_argument("--output", required=True, help="Clean output CSV")
    parser.add_argument("--drop-duplicates", action="store_true",
                        help="Drop exact duplicate rows (default: report only)")
    parser.add_argument("--force", action="store_true", help="Overwrite existing output")
    args = parser.parse_args()

    out_path = Path(args.output)
    if out_path.exists() and not args.force:
        log.info("Output exists: %s. Use --force to overwrite.", out_path)
        return

    log.info("Loading %s", args.input)
    df = pd.read_csv(args.input, low_memory=False)
    total_raw = len(df)
    log.info("Loaded %d rows", total_raw)

    # 1. Drop non-IP rows
    before = len(df)
    ip_present = df["ip.src"].notna() & (df["ip.src"].astype(str).str.strip() != "") & \
                 df["ip.dst"].notna() & (df["ip.dst"].astype(str).str.strip() != "")
    df = df[ip_present].copy()
    dropped_no_ip = before - len(df)
    log.info("Dropped %d non-IP rows (%.1f%%)", dropped_no_ip, 100 * dropped_no_ip / max(before, 1))

    # 2. Convert tcp.flags.str → tcp_flags_num
    df["tcp_flags_num"] = df["tcp.flags.str"].apply(parse_flags).astype(np.int32)
    log.info("Converted tcp.flags.str -> tcp_flags_num")

    # 3. Normalize numeric columns
    int_cols = {
        "ip.proto":       0,
        "tcp.srcport":    0,
        "tcp.dstport":    0,
        "tcp.window_size": 0,
        "frame.len":      0,
        "frame.number":   0,
    }
    for col, fill in int_cols.items():
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(fill).astype(np.int32)

    if "frame.time_relative" in df.columns:
        df["frame.time_relative"] = pd.to_numeric(df["frame.time_relative"], errors="coerce").fillna(0.0)

    # 4. Duplicate handling
    n_dups = int(df.duplicated().sum())
    log.info("Exact duplicates: %d", n_dups)
    if args.drop_duplicates and n_dups > 0:
        df = df.drop_duplicates()
        log.info("Dropped %d duplicate rows", n_dups)

    # 5. Out-of-range validation (report only, don't drop)
    issues = {
        "ports_out_of_range":  int(((df["tcp.srcport"] > 65535) | (df["tcp.dstport"] > 65535)).sum()),
        "negative_frame_len":  int((df["frame.len"] < 0).sum()),
        "unknown_ip_proto":    int((~df["ip.proto"].isin(KNOWN_PROTOS)).sum()),
    }
    if any(v > 0 for v in issues.values()):
        log.warning("Data quality issues found: %s", issues)
    else:
        log.info("No out-of-range issues found")

    # 6. Quality report
    label_dist  = df["label"].value_counts().to_dict() if "label" in df.columns else {}
    proto_dist  = df["ip.proto"].value_counts().to_dict()
    report = {
        "total_raw":            total_raw,
        "total_clean":          len(df),
        "dropped_no_ip":        dropped_no_ip,
        "duplicates_found":     n_dups,
        "duplicates_dropped":   n_dups if args.drop_duplicates else 0,
        "validation_issues":    issues,
        "label_distribution":   label_dist,
        "protocol_distribution": {str(k): int(v) for k, v in proto_dist.items()},
    }

    report_path = out_path.parent / (out_path.stem + "_quality_report.json")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    log.info("Quality report saved to %s", report_path)
    log.info("Label distribution: %s", label_dist)
    log.info("Protocol distribution (proto_id: count): %s", proto_dist)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_path, index=False)
    log.info("Saved clean CSV to %s (%d rows)", out_path, len(df))


if __name__ == "__main__":
    main()
