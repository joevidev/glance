#!/usr/bin/env bash
# One-shot progress snapshot for the follow-up checks. Prints numbers only, never secrets.
cd "$(dirname "$0")/.." || exit 1
now=$(date +%s)
age() { f="$1"; [ -e "$f" ] && echo $(( now - $(stat -f %m "$f") ))s || echo "-"; }
cnt() { find "$@" -type f -not -name '.DS_Store' -not -path '*/node_modules/*' -not -path '*/__pycache__/*' -not -path '*/.venv/*' 2>/dev/null | wc -l | tr -d ' '; }
lines() { [ -e "$1" ] && wc -l < "$1" | tr -d ' ' || echo 0; }
newest() { find "$@" -type f -not -name '.DS_Store' -not -path '*/node_modules/*' -not -path '*/__pycache__/*' -not -path '*/.venv/*' -print0 2>/dev/null | xargs -0 stat -f '%m %N' 2>/dev/null | sort -rn | head -1 | awk -v n="$now" '{printf "%ds ago", n-$1}'; }

echo "== $(date '+%H:%M:%S') glance watch =="
echo "lab-data     files=$(cnt packages/lab/glance_lab/data data packages/elements)  newest=$(newest packages/lab/glance_lab/data data packages/elements)"
echo "  sites crawled=$(ls data/sites/*.json 2>/dev/null | wc -l | tr -d ' ')  train rows=$(lines data/dataset/train.jsonl)  test rows=$(lines data/dataset/test.jsonl)  locked=$(grep -o '"locked": *[a-z]*' data/dataset/manifest.json 2>/dev/null | head -1)"
echo "lab-systems  files=$(cnt packages/lab/glance_lab/systems packages/lab/glance_lab/stats)  newest=$(newest packages/lab/glance_lab/systems packages/lab/glance_lab/stats)"
for f in results/rows/*.jsonl; do [ -e "$f" ] && echo "  rows $(basename "$f" .jsonl)=$(lines "$f") (age $(age "$f"))"; done
echo "  summary.json=$( [ -e results/summary.json ] && echo present || echo missing )"
echo "lab-train    files=$(cnt packages/lab/glance_lab/train results/train)  newest=$(newest packages/lab/glance_lab/train results/train)"
[ -e results/train/status.json ] && echo "  status: $(tr -d '\n' < results/train/status.json | cut -c1-300)  (age $(age results/train/status.json))"
echo "desktop      files=$(cnt apps/desktop packages/ui packages/brain packages/contracts/src packages/input)  newest=$(newest apps/desktop packages/ui packages/brain packages/contracts/src packages/input)"
echo "gaze         files=$(cnt packages/gaze)  newest=$(newest packages/gaze)"
echo "-- tests --"
(cd packages/lab && ls tests 2>/dev/null | tr '\n' ' '); echo
echo "-- out of bounds (files changed in the last 20 min outside any lane) --"
find . -type f -mmin -20 -not -path './node_modules/*' -not -path '*/node_modules/*' -not -path '*/.venv/*' -not -path '*/__pycache__/*' -not -path './.turbo/*' -not -path '*/.next/*' -not -path '*/out/*' -not -path '*/dist/*' -not -name '.DS_Store' \
  -not -path './pnpm-lock.yaml' -not -path './ARCHITECTURE.md' -not -path './turbo.json' -not -path './README.md' -not -path './.gitignore' -not -path './package.json' -not -path './pnpm-workspace.yaml' -not -path './.env.example' -not -path './scripts/*' -not -path './packages/typescript-config/*' \
  -not -path './packages/lab/*' -not -path './data/*' -not -path './results/*' -not -path './packages/elements/*' \
  -not -path './apps/*' -not -path './packages/ui/*' -not -path './packages/brain/*' -not -path './packages/contracts/*' -not -path './packages/input/*' -not -path './packages/gaze/*' 2>/dev/null | head -10
