#!/usr/bin/env python3
"""
ddos_demo.py
────────────
Interactive DDoS demonstration script for the Spine-Leaf SDN lab.
Run from INSIDE the Mininet container after the topology is up:

  docker compose exec -it mininet bash
  # mn_spineleaf_topo.py already running...
  mininet> py exec(open('infra/attacks/ddos_demo.py').read())

Or as a standalone script (requires Mininet CLI already running):
  mininet> py exec(open('infra/attacks/ddos_demo.py').read())

What it does:
  1. Verifies baseline connectivity (pingall)
  2. Launches a SYN flood from h1 → h4
  3. Pauses so you can observe controller logs
  4. Stops the attack
  5. Verifies h1 is now blocked (ping from h1 should fail)
  6. Optionally repeats for UDP and ICMP floods

Prerequisites inside the mininet container:
  apt-get install -y hping3   (already in the lab image)
"""

import time

# ── helpers ───────────────────────────────────────────────────────────────────

def banner(msg):
    print("\n" + "=" * 60)
    print(f"  {msg}")
    print("=" * 60)


def run(host, cmd, background=False):
    """Run a command on a Mininet host."""
    if background:
        host.cmd(cmd + " &")
        print(f"  [{host.name}] (bg) {cmd}")
    else:
        out = host.cmd(cmd)
        print(f"  [{host.name}] {cmd}")
        if out.strip():
            print(f"    → {out.strip()[:200]}")
        return out


# ── topology handles (net is available in Mininet CLI context) ────────────────

h1 = net.get("h1")
h2 = net.get("h2")
h3 = net.get("h3")
h4 = net.get("h4")   # attack target
h5 = net.get("h5")
h6 = net.get("h6")

TARGET_IP = h4.IP()

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — Baseline connectivity
# ─────────────────────────────────────────────────────────────────────────────

banner("STEP 1: Baseline connectivity check")
print("  Running pingall — all 30 pairs should succeed...")
net.pingAll()

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — SYN Flood (h1 → h4)
# ─────────────────────────────────────────────────────────────────────────────

banner("STEP 2: Launching TCP SYN flood  h1 → h4")
print(f"  Target: {TARGET_IP}  |  Duration: 15 s")
print("  Watch the controller logs:  docker compose logs -f controller")
print()

# --faster makes hping3 send as fast as possible; -S = SYN flag
# -p 80 = destination port 80; -c limits to N packets
run(h1, f"hping3 -S --faster -p 80 -c 5000 {TARGET_IP}", background=True)

print("  Attack running for 8 s …")
time.sleep(8)

banner("STEP 2b: SYN flood from h2 as well (multi-source)")
run(h2, f"hping3 -S --faster -p 80 -c 5000 {TARGET_IP}", background=True)
time.sleep(8)

# Stop attackers
run(h1, "pkill hping3")
run(h2, "pkill hping3")
print("  Attack stopped.")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — Verify block
# ─────────────────────────────────────────────────────────────────────────────

banner("STEP 3: Verify that h1 and h2 are now blocked")
print("  Ping from h1 → h4 (should FAIL if mitigator worked):")
out1 = run(h1, f"ping -c 3 -W 1 {TARGET_IP}")
if "0 received" in out1 or "100% packet loss" in out1:
    print("  ✓ h1 is BLOCKED — mitigation successful!")
else:
    print("  ✗ h1 can still reach h4 — check controller logs / thresholds")

print()
print("  Ping from h5 → h4 (should SUCCEED — innocent host):")
out5 = run(h5, f"ping -c 3 -W 1 {TARGET_IP}")
if "0 received" in out5 or "100% packet loss" in out5:
    print("  ✗ h5 is also blocked — collateral damage!")
else:
    print("  ✓ h5 can still reach h4 — only attacker was blocked")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — UDP Flood (h3 → h4)
# ─────────────────────────────────────────────────────────────────────────────

banner("STEP 4: Launching UDP flood  h3 → h4")
print(f"  Target: {TARGET_IP}  |  port 53")
run(h3, f"hping3 --udp --faster -p 53 -c 8000 {TARGET_IP}", background=True)
time.sleep(10)
run(h3, "pkill hping3")

print()
print("  Ping from h3 → h4 (should FAIL):")
out3 = run(h3, f"ping -c 3 -W 1 {TARGET_IP}")
if "0 received" in out3 or "100% packet loss" in out3:
    print("  ✓ h3 is BLOCKED (UDP flood detected)")
else:
    print("  ✗ h3 not blocked — adjust DDOS_THRESH_UDP threshold")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 — ICMP Flood (h5 → h4)
# ─────────────────────────────────────────────────────────────────────────────

banner("STEP 5: Launching ICMP flood  h5 → h4")
run(h5, f"hping3 --icmp --faster -c 3000 {TARGET_IP}", background=True)
time.sleep(8)
run(h5, "pkill hping3")

print()
print("  Ping from h5 → h4 (should FAIL):")
out5 = run(h5, f"ping -c 3 -W 1 {TARGET_IP}")
if "0 received" in out5 or "100% packet loss" in out5:
    print("  ✓ h5 is BLOCKED (ICMP flood detected)")
else:
    print("  ✗ h5 not blocked — adjust DDOS_THRESH_ICMP threshold")

# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────────────────

banner("DEMO COMPLETE")
print("""
  Summary of what happened:
  ─────────────────────────
  1. Baseline: all 6 hosts connected (0% drop)
  2. SYN flood from h1, h2 → h4  →  controller detected & blocked h1, h2
  3. UDP flood from h3 → h4       →  controller detected & blocked h3
  4. ICMP flood from h5 → h4      →  controller detected & blocked h5
  5. h4, h6 remain unaffected

  Check controller logs for DDOS_EVENT lines:
    docker compose logs controller | grep DDOS_EVENT

  Block rules expire after BLOCK_IDLE_TIMEOUT seconds (default 120 s).
  To unblock immediately: restart the controller.
""")