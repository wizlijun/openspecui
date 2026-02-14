#!/bin/bash
# OpenSpec Review Environment Setup
# Sets up proxy and Codex notify hook for review terminal

set -euo pipefail

# Set proxy environment variables
export http_proxy=http://127.0.0.1:1087
export https_proxy=http://127.0.0.1:1087

echo "✓ Proxy configured: $http_proxy"

# Setup .codex directory and notify hook
CODEX_DIR=".codex"
NOTIFY_SCRIPT="$CODEX_DIR/notify.sh"
CONFIG_FILE="$CODEX_DIR/config.toml"

# Create .codex directory if it doesn't exist
if [[ ! -d "$CODEX_DIR" ]]; then
  if mkdir -p "$CODEX_DIR"; then
    echo "✓ Created $CODEX_DIR directory"
  else
    echo "⚠ Warning: failed to create $CODEX_DIR directory"
  fi
fi

# Copy notify script from .openspec/
if [[ -f ".openspec/codex-notify.sh" ]]; then
  if cp .openspec/codex-notify.sh "$NOTIFY_SCRIPT" && chmod +x "$NOTIFY_SCRIPT"; then
    echo "✓ Installed notify hook: $NOTIFY_SCRIPT"
  else
    echo "⚠ Warning: failed to install notify hook at $NOTIFY_SCRIPT"
  fi
else
  echo "⚠ Warning: .openspec/codex-notify.sh not found, skipping notify hook setup"
fi

# Create or update .codex/config.toml with notify hook
if [[ -f "$NOTIFY_SCRIPT" ]]; then
  NOTIFY_PATH="$(pwd)/$NOTIFY_SCRIPT"

  # Ensure config file exists
  if ! touch "$CONFIG_FILE"; then
    echo "⚠ Warning: failed to write $CONFIG_FILE, skipping local notify config"
    echo "✓ Review environment ready"
    exit 0
  fi

  # Replace any existing notify line so path stays correct when project location changes
  TMP_FILE="$(mktemp)"
  if sed -E '/^[[:space:]]*# OpenSpec Desktop notify hook[[:space:]]*$/d; /^[[:space:]]*notify[[:space:]]*=.*/d' "$CONFIG_FILE" > "$TMP_FILE"; then
    mv "$TMP_FILE" "$CONFIG_FILE"
  else
    rm -f "$TMP_FILE" || true
    echo "⚠ Warning: failed to update $CONFIG_FILE, skipping local notify config"
    echo "✓ Review environment ready"
    exit 0
  fi

  # Append notify configuration
  if cat >> "$CONFIG_FILE" <<EOF

# OpenSpec Desktop notify hook
notify = ["bash", "$NOTIFY_PATH"]
EOF
  then
    echo "✓ Updated notify hook in $CONFIG_FILE"
  else
    echo "⚠ Warning: failed to append notify hook in $CONFIG_FILE"
  fi
fi

echo "✓ Review environment ready"

# ─── Codex Start Functions ──────────────────────────────────────────
# Start codex with ping prompt to trigger first notify (signals ready)
start_codex() {
  codex "ping"
}

# Resume an existing codex session with ping
resume_codex() {
  local session_id="$1"
  codex resume "$session_id" "ping"
}

export -f start_codex
export -f resume_codex
