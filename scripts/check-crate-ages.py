#!/usr/bin/env python3
"""Supply-chain check: every crate in Cargo.lock must have been published at least DAYS ago,
and none may be yanked. Freshly published versions are where hijacked releases appear.

    python3 scripts/check-crate-ages.py            # 7 days
    python3 scripts/check-crate-ages.py --days 14

Uses only the standard library and the public crates.io API (one request per second, as its
crawler policy asks). Exits 1 when something is too new or yanked.
"""
import argparse
import datetime as dt
import json
import pathlib
import re
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
UA = {"User-Agent": "berth-studio supply-chain check (https://github.com/berth-studio)"}

# Releases that fix a security advisory skip the wait: an older version would be the bigger risk.
# Keep the advisory id next to each entry, and remove the entry once the version is a week old.
SECURITY_FIXES = {
    ("rustls", "0.23.46"): "RUSTSEC-2026-0346, RUSTSEC-2026-0347",
}


def locked():
    text = (ROOT / "Cargo.lock").read_text()
    for block in text.split("[[package]]")[1:]:
        if 'source = "registry+https://github.com/rust-lang/crates.io-index"' in block:
            yield re.search(r'name = "([^"]+)"', block).group(1), re.search(r'version = "([^"]+)"', block).group(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    args = ap.parse_args()
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=args.days)).isoformat()
    bad = []
    crates = sorted(set(locked()))
    for i, (name, version) in enumerate(crates, 1):
        url = f"https://crates.io/api/v1/crates/{name}/{version}"
        for attempt in range(3):
            try:
                info = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20))["version"]
                break
            except Exception as err:  # network hiccup: retry, then report
                info, last = None, err
                time.sleep(2)
        if info is None:
            bad.append(f"{name} {version}: could not check ({last})")
        elif info["yanked"]:
            bad.append(f"{name} {version}: yanked")
        elif info["created_at"] > cutoff and (name, version) not in SECURITY_FIXES:
            bad.append(f"{name} {version}: published {info['created_at'][:10]}, less than {args.days} days ago")
        print(f"\r{i}/{len(crates)}", end="", file=sys.stderr)
        time.sleep(1)
    print(file=sys.stderr)
    if bad:
        print("\n".join(bad))
        print("Pin each one to an older version: cargo update -p <name>@<version> --precise <older>")
        return 1
    print(f"All {len(crates)} crates are at least {args.days} days old and none is yanked.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
