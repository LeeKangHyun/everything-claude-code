#!/usr/bin/env bash
set -euo pipefail

# kangto-shim installer
# Symlinks kangto-shim as codeagent-wrapper so multi-execute works with cmux

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${HOME}/.claude/bin"

echo "[kangto] Installing kangto-shim as codeagent-wrapper..."

mkdir -p "$TARGET_DIR"

# Create wrapper script that invokes node
cat > "$TARGET_DIR/codeagent-wrapper" << WRAPPER
#!/usr/bin/env bash
exec node "${SCRIPT_DIR}/index.js" "\$@"
WRAPPER

chmod +x "$TARGET_DIR/codeagent-wrapper"

echo "[kangto] Installed: ${TARGET_DIR}/codeagent-wrapper -> ${SCRIPT_DIR}/index.js"
echo ""
echo "Prerequisites:"
echo "  1. cmux must be installed and running"
echo "     brew tap manaflow-ai/cmux && brew install --cask cmux"
echo "  2. Backend CLI tools must be available:"
echo "     - codex (OpenAI Codex CLI)"
echo "     - gemini (Google Gemini CLI)"
echo ""
echo "Usage:"
echo "  /multi-execute will now use cmux instead of the original codeagent-wrapper"
echo ""
echo "Environment variables:"
echo "  CMUX_BIN          - cmux binary path (default: cmux)"
echo "  KANGTO_POLL_MS    - polling interval in ms (default: 2000)"
echo "  KANGTO_MAX_WAIT_MS - max wait time in ms (default: 600000)"
