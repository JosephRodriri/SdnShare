#!/usr/bin/env python3
"""
05_split_export.py — Stratified 80/20 train/test split and final export.

Produces files ready for sklearn.ensemble.RandomForestClassifier:
  - datasets/splits/train.csv          80% of rows, stratified by label
  - datasets/splits/test.csv           20% of rows, stratified by label
  - datasets/metadata/<name>_manifest.json  provenance record

Scikit-learn compatibility guarantees:
  - All feature columns are numeric (int or float)
  - No NaN values (filled with 0)
  - Label encoded as integer column 'label_enc' (original string kept as 'label')

Quick usage after export:
    import pandas as pd
    from sklearn.ensemble import RandomForestClassifier

    train = pd.read_csv("datasets/splits/train.csv")
    test  = pd.read_csv("datasets/splits/test.csv")
    FEATURES = ["ip.proto","tcp.srcport","tcp.dstport","tcp.window_size",
                "tcp_flags_num","frame.len","pkt_count","byte_sum",
                "unique_src","unique_dst_port","syn_ratio","avg_pkt_size"]
    clf = RandomForestClassifier(n_estimators=100, random_state=42)
    clf.fit(train[FEATURES], train["label_enc"])
    print(clf.score(test[FEATURES], test["label_enc"]))

Usage:
    python 05_split_export.py --input datasets/processed/capture_features.csv
                              --name capture
                              [--test-size 0.2] [--random-state 42] [--force]
"""
import argparse
import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder

FEATURE_COLS = [
    "ip.proto",
    "tcp.srcport",
    "tcp.dstport",
    "tcp.window_size",
    "tcp_flags_num",
    "frame.len",
    "pkt_count",
    "byte_sum",
    "unique_src",
    "unique_dst_port",
    "syn_ratio",
    "avg_pkt_size",
]


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def md5_file(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def main():
    setup_logging()
    log = logging.getLogger(__name__)

    parser = argparse.ArgumentParser(description="Stratified split and sklearn-ready export")
    parser.add_argument("--input",        required=True, help="Features CSV (from 04_features.py)")
    parser.add_argument("--name",         required=True, help="Dataset identifier for output filenames")
    parser.add_argument("--test-size",    type=float, default=0.2, help="Test fraction (default: 0.2)")
    parser.add_argument("--random-state", type=int,   default=42,  help="Random seed (default: 42)")
    parser.add_argument("--force", action="store_true", help="Overwrite existing splits")
    args = parser.parse_args()

    train_path = Path("datasets/splits/train.csv")
    test_path  = Path("datasets/splits/test.csv")

    if train_path.exists() and test_path.exists() and not args.force:
        log.info("Splits already exist. Use --force to overwrite.")
        return

    log.info("Loading %s", args.input)
    df = pd.read_csv(args.input, low_memory=False)
    log.info("Loaded %d rows", len(df))

    if "label" not in df.columns:
        log.error("Column 'label' not found. Run 02_label.py first.")
        raise SystemExit(1)

    # Fill any missing feature columns with 0 (and warn)
    missing_cols = [c for c in FEATURE_COLS if c not in df.columns]
    if missing_cols:
        log.warning("Missing feature columns (filling with 0): %s", missing_cols)
        for col in missing_cols:
            df[col] = 0

    # Ensure all features are numeric; fill NaN
    for col in FEATURE_COLS:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    # Encode labels to integers
    le = LabelEncoder()
    df["label_enc"] = le.fit_transform(df["label"])
    label_classes = list(le.classes_)
    encoding_map = {cls: int(le.transform([cls])[0]) for cls in label_classes}
    log.info("Label encoding: %s", encoding_map)

    export_cols = FEATURE_COLS + ["label", "label_enc"]
    df_export = df[export_cols]

    # Stratified split; fall back to random if a class is too small
    try:
        train_df, test_df = train_test_split(
            df_export,
            test_size=args.test_size,
            random_state=args.random_state,
            stratify=df_export["label_enc"],
        )
        log.info("Stratified split: %d train / %d test", len(train_df), len(test_df))
    except ValueError as exc:
        log.warning("Stratified split failed (%s) — falling back to random split", exc)
        train_df, test_df = train_test_split(
            df_export,
            test_size=args.test_size,
            random_state=args.random_state,
        )

    Path("datasets/splits").mkdir(parents=True, exist_ok=True)
    train_df.to_csv(train_path, index=False)
    test_df.to_csv(test_path,  index=False)
    log.info("Train -> %s", train_path)
    log.info("Test  -> %s", test_path)

    # Log label distribution in each split
    log.info("Train label distribution: %s", train_df["label"].value_counts().to_dict())
    log.info("Test  label distribution: %s", test_df["label"].value_counts().to_dict())

    # Manifest
    manifest = {
        "name":               args.name,
        "created_at":         datetime.now(timezone.utc).isoformat(),
        "source":             str(args.input),
        "total_rows":         int(len(df)),
        "train_rows":         int(len(train_df)),
        "test_rows":          int(len(test_df)),
        "test_size":          args.test_size,
        "random_state":       args.random_state,
        "label_distribution": {k: int(v) for k, v in df["label"].value_counts().items()},
        "label_encoding":     encoding_map,
        "features":           FEATURE_COLS,
        "md5_train":          md5_file(train_path),
        "md5_test":           md5_file(test_path),
    }

    meta_dir = Path("datasets/metadata")
    meta_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = meta_dir / f"{args.name}_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    log.info("Manifest saved to %s", manifest_path)
    log.info("Done. Load with: train[%s] -> RandomForestClassifier", FEATURE_COLS[:3] + ["..."])


if __name__ == "__main__":
    main()
