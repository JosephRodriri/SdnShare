---
name: sdn-dataset-pipeline
description: >
  End-to-end preprocessing pipeline for network capture files (pcap, tshark CSV) from SDN
  labs (Mininet + Ryu) into scikit-learn-ready train/test datasets for intrusion detection.
  Use this skill whenever the user mentions: pcap files, tshark captures, Mininet traffic,
  SDN network datasets, labeling packets with attack types (SYN Flood, DDOS, Port Scan,
  ARP Spoofing), feature engineering on network flows, converting captures to ML datasets,
  or wants to produce train.csv/test.csv for a RandomForest or similar classifier.
  Also trigger when the user wants to run any individual pipeline step: extract, label,
  clean, feature engineering, or split/export. Trigger even if the user just says
  "process my pcap" or "prepare my network data for ML".
---

# SDN Dataset Pipeline

This skill guides the full preprocessing workflow from raw network captures to
train/test CSVs ready for `sklearn.ensemble.RandomForestClassifier` — no manual
data wrangling required.

**Acceptance criterion:** Given a `.pcap` or tshark `.csv` as input, the pipeline
produces `datasets/splits/train.csv` and `datasets/splits/test.csv` with all-numeric
features, no NaN values, and an integer `label_enc` column.

## Bundled scripts

All processing code lives in `scripts/pipeline/` inside this skill directory.
Copy or reference them from the user's project repository (typically `SdnShare/scripts/pipeline/`).

| Script | Purpose |
|--------|---------|
| `01_extract.py` | pcap → CSV via Docker/tshark |
| `02_label.py` | Add `label` column (filename or timestamp method) |
| `03_clean.py` | Drop invalid rows, normalize types, quality report |
| `04_features.py` | 5-second rolling window features |
| `05_split_export.py` | 80/20 stratified split + manifest JSON |
| `run_pipeline.sh` | Runs all 5 steps in sequence |

**Dependencies:** `pandas`, `numpy`, `scikit-learn`. Install with:
```bash
pip install pandas numpy scikit-learn
```

---

## Step 0 — Gather context from the user

Before running anything, ask the user:

1. **Input file**: path to the `.pcap` or `.csv` file (inside Docker at `/tmp/`, or local).
2. **Dataset name**: short identifier for output files (e.g., `ddos_lab1`).
3. **Labeling method** (see Step 2 below):
   - *Filename*: file is named `ddos_capture.pcap`, `portscan_run2.pcap`, etc.
   - *Timestamp*: user can provide attack start/end times (in seconds relative to capture start).
4. **Docker service name**: usually `mininet` (default).

If the user is running a quick test or already has a labeled CSV, adapt accordingly.

---

## Step 1 — Extraction

**Goal:** Get a consistent CSV with the 10 standard fields from tshark.

```bash
python scripts/pipeline/01_extract.py \
  --input /tmp/capture.pcap \
  --service mininet \
  --output datasets/raw/capture_raw.csv
```

This runs tshark inside the Docker container and streams the CSV out. If the input
is already a CSV (exported previously), the script simply copies it — no Docker call needed.

**Standard fields extracted:**
`frame.number`, `frame.time_relative`, `ip.src`, `ip.dst`, `ip.proto`,
`tcp.srcport`, `tcp.dstport`, `tcp.flags.str`, `tcp.window_size`, `frame.len`

If the user has multiple pcap files (one per attack type), run extraction on each,
then combine the CSVs before labeling:
```python
import pandas as pd, glob
dfs = [pd.read_csv(f) for f in glob.glob("datasets/raw/*_raw.csv")]
pd.concat(dfs, ignore_index=True).to_csv("datasets/raw/combined_raw.csv", index=False)
```

---

## Step 2 — Labeling

**Goal:** Add a `label` column: `NORMAL`, `DDOS`, `PORTSCAN`, or `ARP_SPOOF`.

### Method A — Filename inference (simplest)
File prefixes are auto-mapped: `ddos_*` → `DDOS`, `portscan_*` → `PORTSCAN`,
`arp_*` → `ARP_SPOOF`, `normal_*` → `NORMAL`.

```bash
python scripts/pipeline/02_label.py \
  --input datasets/raw/ddos_raw.csv \
  --output datasets/raw/ddos_labeled.csv \
  --method filename
```

### Method B — Timestamp intervals
When a single capture contains mixed traffic, the user provides a JSON intervals file:

```json
[
  {"label": "DDOS",     "start": 10.5, "end": 45.2},
  {"label": "PORTSCAN", "start": 60.0, "end": 90.0}
]
```
Packets outside intervals get `--default-label NORMAL`.

```bash
python scripts/pipeline/02_label.py \
  --input datasets/raw/combined_raw.csv \
  --output datasets/raw/combined_labeled.csv \
  --method timestamp \
  --intervals intervals.json
```

Help the user create `intervals.json` if needed — ask for the timestamps of each
attack segment from their Mininet scenario log or run notes.

---

## Step 3 — Cleaning & Validation

**Goal:** Produce a clean, fully-typed CSV; surface data quality issues.

```bash
python scripts/pipeline/03_clean.py \
  --input datasets/raw/capture_labeled.csv \
  --output datasets/raw/capture_clean.csv \
  --drop-duplicates
```

What happens:
- **Drops** rows where `ip.src` or `ip.dst` is empty — these are non-IP packets
  (pure ARP, 802.3 LLC, etc.) that can't be used for IP-level features.
- **Converts** `tcp.flags.str` to a numeric bitmask (`tcp_flags_num`). Handles both
  hex format (`0x0002`) and tshark's character representation (`·······S······`).
- **Normalizes** `ip.proto`, port fields, and `frame.len` to integers; fills 0 for
  non-TCP packets where TCP fields are empty.
- **Reports** duplicates and out-of-range values (ports > 65535, etc.).
- **Writes** a quality report JSON alongside the output.

Show the user the quality report and flag anything unusual (e.g., >10% rows dropped,
unexpected label distributions).

---

## Step 4 — Feature Engineering

**Goal:** Compute 6 time-window aggregates that expose attack patterns.

```bash
python scripts/pipeline/04_features.py \
  --input datasets/raw/capture_clean.csv \
  --output datasets/processed/capture_features.csv \
  --window 5.0
```

For each packet, the script aggregates the preceding 5 seconds:

| Feature | Why it detects attacks |
|---------|----------------------|
| `pkt_count` | SYN flood → sudden spike |
| `byte_sum` | DDoS → high volume |
| `unique_src` | Port scan from single IP → low value |
| `unique_dst_port` | Port scan → high value |
| `syn_ratio` | SYN flood → approaches 1.0 |
| `avg_pkt_size` | Floods use small packets; file transfers use large |

The window size of 5 seconds is a good default for this lab's attack patterns.
If the user's attacks are very short bursts (< 2s) or very slow scans (minutes),
suggest adjusting `--window` accordingly.

---

## Step 5 — Split & Export

**Goal:** Produce scikit-learn-ready train/test CSVs with reproducible splits.

```bash
python scripts/pipeline/05_split_export.py \
  --input datasets/processed/capture_features.csv \
  --name capture
```

Outputs:
- `datasets/splits/train.csv` — 80% stratified by label
- `datasets/splits/test.csv` — 20% stratified by label
- `datasets/metadata/capture_manifest.json` — provenance record with MD5 hashes

The label is encoded as `label_enc` (integer) for sklearn compatibility.
The original string `label` column is preserved for interpretability.

**Quick validation** — show the user this snippet to confirm readiness:
```python
import pandas as pd
from sklearn.ensemble import RandomForestClassifier

train = pd.read_csv("datasets/splits/train.csv")
test  = pd.read_csv("datasets/splits/test.csv")

features = ["ip.proto","tcp.srcport","tcp.dstport","tcp.window_size",
            "tcp_flags_num","frame.len","pkt_count","byte_sum",
            "unique_src","unique_dst_port","syn_ratio","avg_pkt_size"]

clf = RandomForestClassifier(n_estimators=100, random_state=42)
clf.fit(train[features], train["label_enc"])
print(f"Test accuracy: {clf.score(test[features], test['label_enc']):.3f}")
print(f"Classes: {train['label'].unique()}")
```

---

## Running the full pipeline in one command

```bash
bash scripts/pipeline/run_pipeline.sh /tmp/ddos_capture.pcap ddos_lab1 mininet
```

This runs all 5 steps in sequence. Use `--force` flags on individual scripts if
re-running after changes.

---

## Common issues & fixes

**Empty output CSV**: tshark command failed. Check Docker service name and that
the pcap path is accessible inside the container (`docker compose exec mininet ls /tmp/`).

**All rows dropped in clean step**: The CSV may already be clean-formatted without
the standard 10-column header — confirm with `head -2 datasets/raw/capture_raw.csv`.

**Stratified split fails**: One label class has very few samples (< 5). The script
falls back to random split automatically, but warn the user to collect more of that
traffic type.

**syn_ratio all 0.0**: The `tcp_flags_num` column may not be populated (non-TCP-only
capture). Check with `df["ip.proto"].value_counts()`.

**ARP_SPOOF label has no rows after cleaning**: ARP packets have empty ip.src/ip.dst
and are intentionally dropped. To capture ARP spoofing behavior, use the time-window
features from *surrounding* TCP/IP traffic, or add `arp.src.proto_ipv4` as an
additional tshark field.
