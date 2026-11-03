#!/usr/bin/env bash
# Glance demo preflight: is this Mac ready to record?   Run:  pnpm preflight
#
#   ✔ ok     ✖ critical problem (exit code 1, fix line printed)     ⚠ warning or a manual check
#
# CRITICAL items (any ✖ makes the exit code 1):
#   node >= 22, pnpm, cargo, uv, dependencies installed, Rust input helper builds,
#   `pnpm check-types` passes, MediaPipe face model present, OPENAI_API_KEY set and one real call returns 200.
# Everything else (Fireworks, permissions, display, battery, disk, Do Not Disturb) is ⚠ at most.
#
# Safe to run any time: it reads no secret into the terminal (keys are checked inside one Python
# process; only "set / not set" and an HTTP status are printed), never touches git, installs nothing,
# and the one model call costs a fraction of a cent.
# No `set -e` on purpose: every check runs, then the whole list prints, then the exit code is decided.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; D=$'\033[2m'; B=$'\033[1m'; Z=$'\033[0m'
else
  G=""; R=""; Y=""; D=""; B=""; Z=""
fi

FAILS=0
WARNS=0
CRIT_FAILED=()

ok()    { printf '  %s✔%s %s\n' "$G" "$Z" "$1"; }
bad()   { printf '  %s✖%s %s\n' "$R" "$Z" "$1"; [ -n "${2:-}" ] && printf '      %sfix:%s %s\n' "$R" "$Z" "$2"; FAILS=$((FAILS+1)); CRIT_FAILED+=("$1"); }
warn()  { printf '  %s⚠%s %s\n' "$Y" "$Z" "$1"; [ -n "${2:-}" ] && printf '      %s%s%s\n' "$D" "$2" "$Z"; WARNS=$((WARNS+1)); }
note()  { printf '      %s%s%s\n' "$D" "$1" "$Z"; }
head_() { printf '\n%s%s%s\n' "$B" "$1" "$Z"; }
TMP="$(mktemp -d 2>/dev/null || echo /tmp)"
trap 'rm -rf "$TMP"' EXIT

printf '%sGlance demo preflight%s  %s(%s, %s)%s\n' "$B" "$Z" "$D" "$(date '+%Y-%m-%d %H:%M %Z')" "${TERM_PROGRAM:-unknown terminal}" "$Z"

# ---------------------------------------------------------------- power first: it ends recordings
head_ "Power and disk (a retina screen recording drains both)"
BATT="$(pmset -g batt 2>/dev/null)"
if [ -n "$BATT" ]; then
  PCT="$(printf '%s' "$BATT" | grep -Eo '[0-9]+%' | head -1 | tr -d '%')"
  if printf '%s' "$BATT" | grep -q "AC Power"; then
    ok "On AC power (battery ${PCT:-?}%)"
  elif printf '%s' "$BATT" | grep -qi "discharging"; then
    warn "On BATTERY at ${PCT:-?}%, discharging: plug in the charger before recording" "A webcam, a model call loop and a screen recording drain fast. Plug in now."
  else
    ok "Battery ${PCT:-?}% (not discharging)"
  fi
else
  ok "No battery information (desktop Mac)"
fi

FREE_KB="$(df -k "$ROOT" 2>/dev/null | awk 'NR==2{print $4}')"
if [ -n "$FREE_KB" ]; then
  FREE_GB=$(( FREE_KB / 1024 / 1024 ))
  if [ "$FREE_GB" -lt 5 ]; then
    warn "Free disk: ${FREE_GB} GB (very low; a screen recording can need several GB)" "Empty the Trash and delete old recordings or downloads before you record."
  elif [ "$FREE_GB" -lt 15 ]; then
    warn "Free disk: ${FREE_GB} GB (enough for a short recording, but tight)" "Do not leave old recordings or large downloads on the disk; keep takes short."
  else
    ok "Free disk: ${FREE_GB} GB"
  fi
fi

# ---------------------------------------------------------------- toolchain
head_ "Toolchain"
if command -v node >/dev/null 2>&1; then
  NV="$(node -v)"; NMAJ="${NV#v}"; NMAJ="${NMAJ%%.*}"
  if [ "${NMAJ:-0}" -ge 22 ] 2>/dev/null; then ok "node $NV (needs 22 or newer)"; else bad "node $NV is too old (needs 22 or newer)" "Install Node 22+ (https://nodejs.org or: brew install node)"; fi
else
  bad "node not found" "Install Node 22+ (https://nodejs.org or: brew install node)"
fi
if command -v pnpm >/dev/null 2>&1; then ok "pnpm $(pnpm -v 2>/dev/null)"; else bad "pnpm not found" "corepack enable && corepack prepare pnpm@10.30.3 --activate   (or: npm i -g pnpm@10.30.3)"; fi
if command -v cargo >/dev/null 2>&1; then ok "$(cargo -V 2>/dev/null)"; else bad "cargo (Rust) not found" "Install Rust: curl https://sh.rustup.rs -sSf | sh   then open a NEW terminal"; fi
if command -v uv >/dev/null 2>&1; then ok "$(uv --version 2>/dev/null)"; else bad "uv not found" "brew install uv   (or: curl -LsSf https://astral.sh/uv/install.sh | sh)"; fi

if [ -d node_modules ] && [ -d apps/desktop/node_modules ] && [ -e apps/desktop/node_modules/electron ]; then
  ok "JavaScript dependencies installed (node_modules, electron)"
  DEPS_OK=1
else
  bad "JavaScript dependencies are not installed" "pnpm install   (once, needs network)"
  DEPS_OK=0
fi

# ---------------------------------------------------------------- build and types
head_ "Build and types"
if command -v cargo >/dev/null 2>&1; then
  if (cd packages/input && cargo build --release -q) >"$TMP/cargo.log" 2>&1; then
    ok "Rust input helper builds (packages/input, release)"
  else
    bad "Rust input helper does NOT build" "cd packages/input && cargo build --release   (last lines: $(tail -n 3 "$TMP/cargo.log" | tr '\n' ' ' | cut -c1-220))"
  fi
fi

if command -v pnpm >/dev/null 2>&1 && [ "$DEPS_OK" = 1 ]; then
  START=$SECONDS
  if pnpm check-types >"$TMP/types.log" 2>&1; then
    ok "pnpm check-types passes ($((SECONDS-START)) s)"
  else
    bad "pnpm check-types FAILS" "run: pnpm check-types   (if the error is in a file someone else is editing right now, wait for them and re-run)"
    # first error lines, with the package name, so the owner of the file can be found
    grep -E "error TS|ERROR|error:|Failed" "$TMP/types.log" | head -n 5 | while IFS= read -r l; do note "$(printf '%s' "$l" | cut -c1-200)"; done
  fi
else
  warn "pnpm check-types skipped (needs pnpm and installed dependencies)"
fi

MODEL="apps/desktop/resources/face_landmarker.task"
if [ -f "$MODEL" ] && [ "$(wc -c <"$MODEL" | tr -d ' ')" -gt 1000000 ]; then
  ok "MediaPipe face model present ($(( $(wc -c <"$MODEL" | tr -d ' ') / 1024 )) KB)"
else
  bad "MediaPipe face model missing or incomplete ($MODEL)" "Be ONLINE and run the app once: GLANCE_PROVIDER=openai pnpm desktop   (it downloads 3.7 MB, then close it and re-run preflight)"
fi

# ---------------------------------------------------------------- models
head_ "Model keys (a key is never printed, only set/not set and an HTTP status)"
if command -v python3 >/dev/null 2>&1; then
  OAI="$(python3 scripts/preflight/api_check.py openai 2>&1 | tail -n 1)"
  case "${OAI%%|*}" in
    OK)    ok "OpenAI: ${OAI#*|}" ;;
    NOKEY) bad "OpenAI: ${OAI#*|}" "Add OPENAI_API_KEY=... to the repo-root .env (ask Joel). Do NOT open .env on screen." ;;
    *)     bad "OpenAI: ${OAI#*|}" "Check the key in .env and your network, then re-run. The demo needs this call to work." ;;
  esac
  FW="$(python3 scripts/preflight/api_check.py fireworks 2>&1 | tail -n 1)"
  case "${FW%%|*}" in
    OK)        ok "Fireworks: ${FW#*|}" ;;
    SUSPENDED) warn "Fireworks: ${FW#*|}" "Expected today. Always start the app with GLANCE_PROVIDER=openai, and say so in the video." ;;
    NOKEY)     warn "Fireworks: ${FW#*|}" "Fine: the demo runs on OpenAI." ;;
    *)         warn "Fireworks: ${FW#*|}" "Not needed for the demo (runs on OpenAI)." ;;
  esac
else
  bad "python3 not found (needed for the key check)" "Install Xcode command line tools: xcode-select --install"
fi

# ---------------------------------------------------------------- the Mac
head_ "This Mac"
MACV="$(sw_vers -productVersion 2>/dev/null)"
MAJ="${MACV%%.*}"
if [ -n "$MACV" ] && [ "${MAJ:-0}" -ge 13 ] 2>/dev/null; then ok "macOS $MACV"; else warn "macOS ${MACV:-unknown} (13 or newer is expected)" "Older macOS may not support the camera/Accessibility flow; test it early."; fi

DISP="$(system_profiler SPDisplaysDataType 2>/dev/null)"
NDISP="$(printf '%s\n' "$DISP" | grep -c 'Resolution:')"
RES="$(printf '%s\n' "$DISP" | grep 'Resolution:' | head -1 | sed 's/^ *Resolution: *//')"
if printf '%s\n' "$DISP" | grep -qi 'retina'; then SCALE="Retina (2x)"; else SCALE="1x"; fi
if [ "${NDISP:-0}" -le 1 ]; then
  ok "Displays: ${NDISP:-1}  ·  ${RES:-resolution unknown}  ·  scale ${SCALE}"
else
  warn "Displays: $NDISP connected. Glance calibrates and drives the PRIMARY display only" "Unplug or turn off the others, or record and keep everything on the primary display (menu bar display)."
  note "Primary: ${RES:-?}  ·  scale ${SCALE}"
fi

# ---------------------------------------------------------------- permissions
head_ "Permissions (macOS does not let a script read these without prompting: check by hand)"
HELPER="packages/input/target/release/glance-input"
if [ -x "$HELPER" ]; then
  T="$(printf '{"op":"trusted"}\n' | "$HELPER" 2>/dev/null | head -n 1)"
  case "$T" in
    *'"trusted":true'*)  ok "Accessibility for THIS terminal (${TERM_PROGRAM:-terminal}): granted. The input helper inherits it" ;;
    *'"trusted":false'*) warn "Accessibility for THIS terminal (${TERM_PROGRAM:-terminal}): NOT granted. Clicks and cursor moves will not land" "System Settings > Privacy & Security > Accessibility > switch your terminal app ON, then QUIT and reopen the terminal and re-run this check." ;;
    *)                   warn "Accessibility for this terminal: could not be read ($T)" ;;
  esac
else
  warn "Accessibility for this terminal: not checked (input helper not built yet)"
fi
note "Run preflight from the SAME terminal app you will use for 'pnpm desktop'."

warn "Camera (Electron): confirm by hand" "open \"x-apple.systempreferences:com.apple.preference.security?Privacy_Camera\"   ->  Electron ON. 20 s test: run the app, press \"Calibrate my eyes\": your face with iris rings appears within 5 s."
warn "Microphone (Electron): confirm by hand" "open \"x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone\"   ->  Electron ON. 20 s test: Option+Space, say \"open that\", Option+Space: your words appear."
warn "Accessibility (Electron): confirm by hand" "open \"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility\"   ->  Electron ON (and your terminal). 20 s test: with GLANCE_FAKE_GAZE unset, look at a link and wink: it clicks."
note "(The Electron entries only exist after macOS has asked once. Start the app once and answer Allow.)"
warn "Do Not Disturb / Focus: turn it ON by hand (macOS has no safe way to read it)" "Control Center > Focus > Do Not Disturb. Also quit Slack, Messages, Mail and close personal windows."

# ---------------------------------------------------------------- verdict
head_ "Result"
if [ "$FAILS" -eq 0 ]; then
  printf '  %s✔ Ready%s: 0 critical problems, %s warning(s) to read above.\n' "$G" "$Z" "$WARNS"
  printf '  Next:  %sGLANCE_PROVIDER=openai pnpm desktop%s\n\n' "$B" "$Z"
  exit 0
else
  printf '  %s✖ NOT ready%s: %s critical problem(s), %s warning(s). Fix the ✖ lines above and re-run:  pnpm preflight\n' "$R" "$Z" "$FAILS" "$WARNS"
  for c in "${CRIT_FAILED[@]}"; do printf '    - %s\n' "$c"; done
  printf '\n'
  exit 1
fi
