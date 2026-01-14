#!/bin/bash
# Automated Electron CDP Connection Discovery
# Usage: ./connect-electron-cdp.sh [port]

set -e

CDP_PORT="${1:-9222}"
MAX_RETRIES=10
RETRY_DELAY=1

echo "Electron CDP Connection Utility"
echo "================================"
echo ""

# Function to check if CDP port is accessible
check_cdp_port() {
  curl -s http://localhost:$CDP_PORT/json/list > /dev/null 2>&1
  return $?
}

# Function to get all CDP targets
get_targets() {
  curl -s http://localhost:$CDP_PORT/json/list
}

# Function to filter targets by type
filter_by_type() {
  local targets="$1"
  local type="$2"
  echo "$targets" | jq ".[] | select(.type == \"$type\")"
}

echo "Step 1: Checking CDP port $CDP_PORT..."

# Retry connecting to CDP port
RETRY=0
while [ $RETRY -lt $MAX_RETRIES ]; do
  if check_cdp_port; then
    echo "✓ CDP port is accessible"
    break
  fi

  RETRY=$((RETRY + 1))
  if [ $RETRY -eq $MAX_RETRIES ]; then
    echo "✗ FAILED: CDP port not accessible after $MAX_RETRIES attempts"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Is Electron running with --remote-debugging-port=$CDP_PORT?"
    echo "  2. Check if another app is using port $CDP_PORT"
    echo "  3. Verify firewall settings"
    exit 1
  fi

  echo "  Attempt $RETRY/$MAX_RETRIES failed, retrying in ${RETRY_DELAY}s..."
  sleep $RETRY_DELAY
done

echo ""
echo "Step 2: Discovering CDP targets..."

TARGETS=$(get_targets)
TARGET_COUNT=$(echo "$TARGETS" | jq 'length')

echo "✓ Found $TARGET_COUNT CDP target(s)"
echo ""

# Display all targets
echo "All targets:"
echo "$TARGETS" | jq -r '.[] | "  - [\(.type)] \(.title) - \(.url)"'
echo ""

# Extract renderer process targets
echo "Step 3: Finding renderer process..."
RENDERER_TARGETS=$(filter_by_type "$TARGETS" "page")
RENDERER_COUNT=$(echo "$RENDERER_TARGETS" | jq -s 'length')

if [ "$RENDERER_COUNT" -eq 0 ]; then
  echo "✗ No renderer processes found"
  echo ""
  echo "Available target types:"
  echo "$TARGETS" | jq -r '.[].type' | sort -u
  exit 1
fi

echo "✓ Found $RENDERER_COUNT renderer process(es)"

# Get first renderer WebSocket URL
RENDERER_WS=$(echo "$RENDERER_TARGETS" | jq -r 'select(.webSocketDebuggerUrl) | .webSocketDebuggerUrl' | head -1)

if [ -z "$RENDERER_WS" ] || [ "$RENDERER_WS" = "null" ]; then
  echo "✗ FAILED: Could not get renderer WebSocket URL"
  exit 1
fi

echo "✓ Renderer WebSocket: $RENDERER_WS"
echo ""

# Extract main process target (if available)
echo "Step 4: Finding main process..."
MAIN_TARGETS=$(filter_by_type "$TARGETS" "node")
MAIN_COUNT=$(echo "$MAIN_TARGETS" | jq -s 'length')

if [ "$MAIN_COUNT" -eq 0 ]; then
  echo "⚠ Main process not available for debugging"
  echo ""
  echo "To enable main process debugging:"
  echo "  NODE_OPTIONS=\"--inspect=5858\" /path/to/app --remote-debugging-port=$CDP_PORT"
  echo ""
  MAIN_WS=""
else
  echo "✓ Found $MAIN_COUNT main process target(s)"

  MAIN_WS=$(echo "$MAIN_TARGETS" | jq -r 'select(.webSocketDebuggerUrl) | .webSocketDebuggerUrl' | head -1)

  if [ -z "$MAIN_WS" ] || [ "$MAIN_WS" = "null" ]; then
    echo "✗ FAILED: Could not get main process WebSocket URL"
    MAIN_WS=""
  else
    echo "✓ Main process WebSocket: $MAIN_WS"
  fi
  echo ""
fi

# Summary
echo "================================"
echo "Connection Summary"
echo "================================"
echo ""
echo "CDP HTTP endpoint:"
echo "  http://localhost:$CDP_PORT/json/list"
echo ""
echo "Renderer process:"
echo "  WebSocket: $RENDERER_WS"
echo ""

if [ -n "$MAIN_WS" ]; then
  echo "Main process:"
  echo "  WebSocket: $MAIN_WS"
  echo ""
fi

# Export environment variables
echo "Environment variables (export these to use in scripts):"
echo ""
echo "export CDP_PORT=$CDP_PORT"
echo "export RENDERER_WS='$RENDERER_WS'"

if [ -n "$MAIN_WS" ]; then
  echo "export MAIN_WS='$MAIN_WS'"
fi

echo ""
echo "================================"
echo "Test Connection"
echo "================================"
echo ""

# Test renderer connection
echo "Testing renderer connection..."
TEST_RESPONSE=$(echo '{"id":1,"method":"Runtime.enable"}' | websocat --one-message "$RENDERER_WS" 2>&1)

if echo "$TEST_RESPONSE" | jq -e '.id == 1' > /dev/null 2>&1; then
  echo "✓ Renderer connection works"
else
  echo "✗ Renderer connection test failed"
  echo "Response: $TEST_RESPONSE"
fi

# Test main connection (if available)
if [ -n "$MAIN_WS" ]; then
  echo ""
  echo "Testing main process connection..."
  TEST_RESPONSE=$(echo '{"id":1,"method":"Runtime.enable"}' | websocat --one-message "$MAIN_WS" 2>&1)

  if echo "$TEST_RESPONSE" | jq -e '.id == 1' > /dev/null 2>&1; then
    echo "✓ Main process connection works"
  else
    echo "✗ Main process connection test failed"
    echo "Response: $TEST_RESPONSE"
  fi
fi

echo ""
echo "================================"
echo "✓ Connection Discovery Complete"
echo "================================"
echo ""

echo "Quick examples:"
echo ""
echo "# Get document title (renderer):"
echo "echo '{\"id\":2,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"document.title\",\"returnByValue\":true}}' | websocat --one-message '$RENDERER_WS'"
echo ""

if [ -n "$MAIN_WS" ]; then
  echo "# Get Node.js version (main):"
  echo "echo '{\"id\":2,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"process.version\",\"returnByValue\":true}}' | websocat --one-message '$MAIN_WS'"
  echo ""
fi

echo "# Take screenshot (renderer):"
echo "echo '{\"id\":3,\"method\":\"Page.enable\"}' | websocat --one-message '$RENDERER_WS'"
echo "echo '{\"id\":4,\"method\":\"Page.captureScreenshot\"}' | websocat --one-message '$RENDERER_WS' | jq -r '.result.data' | base64 -d > screenshot.png"
echo ""

exit 0
