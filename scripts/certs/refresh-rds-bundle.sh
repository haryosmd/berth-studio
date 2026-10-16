#!/usr/bin/env bash
# Re-downloads the Amazon RDS global CA bundle that berth-postgres ships for RDS and Aurora
# hosts, and writes the download date, SHA-256 and certificate count to the README next to it.
# Run it before a release when AWS announces new RDS roots:
#   scripts/certs/refresh-rds-bundle.sh
# Then review the diff and commit both files.
set -euo pipefail
cd "$(dirname "$0")/../.."

url=https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
dir=crates/berth-postgres/certs
bundle=$dir/rds-global-bundle.pem

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --output "$tmp" "$url"

count=$(grep -c -- '-----BEGIN CERTIFICATE-----' "$tmp" || true)
if [ "$count" -lt 1 ]; then
  echo "refresh-rds-bundle: the download holds no certificate; the bundle was not replaced" >&2
  exit 1
fi
# Every block must be a certificate openssl can read, or a truncated download would ship.
for i in $(seq 1 "$count"); do
  awk -v n="$i" '/-----BEGIN CERTIFICATE-----/{c++} c==n' "$tmp" | openssl x509 -noout >/dev/null
done

mv "$tmp" "$bundle"
trap - EXIT
chmod 644 "$bundle"
sha=$(shasum -a 256 "$bundle" | cut -d ' ' -f 1)
date=$(date -u +%Y-%m-%d)

cat > "$dir/README.md" <<README
# Amazon RDS root certificates

\`rds-global-bundle.pem\` is Amazon's global CA bundle for RDS and Aurora, downloaded unchanged from
<$url>.

\`berth-postgres\` embeds it with \`include_str!\` and trusts its roots, besides the system trust
store, for hosts under \`rds.amazonaws.com\` and \`rds.amazonaws.com.cn\` only. A user's own CA
certificate file still adds to it. Every other host sees only the system trust store.

| | |
| --- | --- |
| Downloaded | $date |
| SHA-256 | \`$sha\` |
| Certificates | $count |

Refresh it before a release when AWS adds roots, then commit both files:

\`\`\`bash
scripts/certs/refresh-rds-bundle.sh
\`\`\`
README

echo "refresh-rds-bundle: $count certificates, sha256 $sha, downloaded $date"
