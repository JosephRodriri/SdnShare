#!/usr/bin/env python3
"""
04_features.py — Compute rolling time-window features for intrusion detection.

For each packet i, aggregates all packets in the window [t_i - W, t_i] where W is
the window size in seconds (default 5.0).

Features added:
  pkt_count      number of packets in the window
  byte_sum       total bytes (sum of frame.len)
  unique_src     number of distinct source IP addresses
  unique_dst_port number of distinct destination ports (TCP/UDP only)
  syn_ratio      fraction of packets with SYN flag set
  avg_pkt_size   mean frame.len in the window

Why these features matter:
  SYN Flood:  high pkt_count, syn_ratio close to 1.0, low unique_src
  Port Scan:  high unique_dst_port, moderate pkt_count, low byte_sum
  Normal:     balanced pkt_count, low syn_ratio, moderate avg_pkt_size
  ARP Spoof:  low pkt_count of surrounding traffic (ARP rows were dropped,
              but IP traffic anomalies around the event are visible)

Implementation uses searchsorted for O(n log n) window boundary lookup, avoiding
Python loops over rows. For very large captures (>5M rows), consider chunked
processing or using a time-indexed groupby approach instead.

Usage:
    python 04_features.py --input datasets/raw/capture_clean.csv
                          --output datasets/processed/capture_features.csv
                          [--window 5.0] [--force]
"""
import argparse
import logging
from pathlib import Path

import numpy as np
import pandas as pd

SYN_FLAG = 0x002


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def compute_window_features(df: pd.DataFrame, window_sec: float) -> pd.DataFrame:
    """Add 6 rolling time-window feature columns to df.

    Sorts by frame.time_relative in-place, then uses searchsorted to find the
    left boundary of each window, avoiding an O(n^2) nested loop.
    """
    df = df.sort_values("frame.time_relative").reset_index(drop=True)

    t          = df["frame.time_relative"].to_numpy(dtype=np.float64)
    src        = df["ip.src"].to_numpy(dtype=str)
    dst_port   = df["tcp.dstport"].to_numpy(dtype=np.int32)
    pkt_len    = df["frame.len"].to_numpy(dtype=np.float64)
    flags      = df["tcp_flags_num"].to_numpy(dtype=np.int32)

    n = len(df)
    pkt_count      = np.empty(n, dtype=np.int32)
    byte_sum       = np.empty(n, dtype=np.float64)
    unique_src     = np.empty(n, dtype=np.int32)
    unique_dst_port = np.empty(n, dtype=np.int32)
    syn_ratio      = np.empty(n, dtype=np.float64)
    avg_pkt_size   = np.empty(n, dtype=np.float64)

    # Precompute left boundary indices for all windows at once
    left_bounds = np.searchsorted(t, t - window_sec, side="left")

    for i in range(n):
        lo = left_bounds[i]
        hi = i + 1  # include current packet

        w_src      = src[lo:hi]
        w_len      = pkt_len[lo:hi]
        w_flags    = flags[lo:hi]
        w_dst_port = dst_port[lo:hi]

        count = hi - lo
        pkt_count[i]       = count
        byte_sum[i]        = w_len.sum()
        unique_src[i]      = len(set(w_src))
        # Only count non-zero ports (zero = non-TCP/UDP placeholder)
        unique_dst_port[i] = len(set(w_dst_port[w_dst_port > 0]))
        syn_count          = int(np.sum((w_flags & SYN_FLAG) != 0))
        syn_ratio[i]       = syn_count / count if count > 0 else 0.0
        avg_pkt_size[i]    = float(w_len.mean()) if count > 0 else 0.0

    df = df.copy()
    df["pkt_count"]       = pkt_count
    df["byte_sum"]        = byte_sum
    df["unique_src"]      = unique_src
    df["unique_dst_port"] = unique_dst_port
    df["syn_ratio"]       = np.round(syn_ratio, 6)
    df["avg_pkt_size"]    = np.round(avg_pkt_size, 3)

    return df


def main():
    setup_logging()
    log = logging.getLogger(__name__)

    parser = argparse.ArgumentParser(description="Compute rolling time-window features")
    parser.add_argument("--input",  required=True, help="Clean CSV (from 03_clean.py)")
    parser.add_argument("--output", required=True, help="Output CSV with feature columns")
    parser.add_argument("--window", type=float, default=5.0,
                        help="Rolling window size in seconds (default: 5.0)")
    parser.add_argument("--force", action="store_true", help="Overwrite existing output")
    args = parser.parse_args()

    out_path = Path(args.output)
    if out_path.exists() and not args.force:
        log.info("Output exists: %s. Use --force to overwrite.", out_path)
        return

    log.info("Loading %s", args.input)
    df = pd.read_csv(args.input, low_memory=False)
    log.info("Loaded %d rows. Computing %.1fs window features...", len(df), args.window)

    if "tcp_flags_num" not in df.columns:
        log.error("Column 'tcp_flags_num' not found. Run 03_clean.py first.")
        raise SystemExit(1)

    df_out = compute_window_features(df, args.window)

    feature_cols = ["pkt_count", "byte_sum", "unique_src", "unique_dst_port", "syn_ratio", "avg_pkt_size"]
    for col in feature_cols:
        log.info("  %-18s mean=%.3f  max=%.3f", col, df_out[col].mean(), df_out[col].max())

    out_path.parent.mkdir(parents=True, exist_ok=True)
    df_out.to_csv(out_path, index=False)
    log.info("Saved features CSV to %s", out_path)


if __name__ == "__main__":
    main()
