#!/bin/bash
# Basic Electron E2E Test with All 6 Gates
# This example demonstrates the complete testing workflow with enforcement

set -e  # Exit on any error

echo "========================================="
echo "Electron E2E Test with 6-Gate Enforcement"
echo "========================================="

# Configuration
APP_PATH="${1:-/path/to/electron-app}"
CDP_PORT=9222
LOG_FILE="/tmp/electron-test.log"

# ============================================================================
# GATE 1: BUILD
# ============================================================================
echo ""
echo "┌─────────────────────────────────────────┐"
echo "│ GATE 1: BUILD                            │"
echo "└─────────────────────────────────────────┘"

cd "$APP_PATH"
npm run build

if [ $? -ne 0 ]; then
  echo "✗ GATE 1 FAILED: Build failed"
  exit 1
fi

echo "✓ GATE 1 PASSED: Build successful"

# ============================================================================
# GATE 2: LAUNCH (with file-based logging)
# ============================================================================
echo ""
echo "┌─────────────────────────────────────────┐"
echo "│ GATE 2: LAUNCH                           │"
echo "└─────────────────────────────────────────┘"

# Clear previous log
> "$LOG_FILE"

# Launch with CDP and logging
npm start -- --remote-debugging-port=$CDP_PORT --enable-logging --log-file="$LOG_FILE" 2>&1 &
APP_PID=$!

echo "✓ GATE 2 PASSED: App launched (PID: $APP_PID)"
echo "  Log file: $LOG_FILE"

# ============================================================================
# GATE 3: WAIT
# ============================================================================
echo ""
echo "┌─────────────────────────────────────────┐"
echo "│ GATE 3: WAIT                             │"
echo "└─────────────────────────────────────────┘"

echo "Waiting 3 seconds for Electron initialization..."
sleep 3

echo "✓ GATE 3 PASSED: Wait complete"

# ============================================================================
# GATE 4: CHECK PROCESS
# ============================================================================
echo ""
echo "┌─────────────────────────────────────────┐"
echo "│ GATE 4: CHECK PROCESS                    │"
echo "└─────────────────────────────────────────┘"

# Check if process is still running
if ! ps -p $APP_PID > /dev/null; then
  echo "✗ GATE 4 FAILED: Electron process crashed"
  echo ""
  echo "Reading logs from GATE 5..."
  cat "$LOG_FILE"
  exit 1
fi

echo "✓ Process is running (PID: $APP_PID)"

# Verify CDP port is accessible
if ! curl -s http://localhost:$CDP_PORT/json/list > /dev/null; then
  echo "✗ GATE 4 FAILED: CDP port not accessible"
  echo ""
  echo "Reading logs from GATE 5..."
  cat "$LOG_FILE"
  kill $APP_PID 2>/dev/null || true
  exit 1
fi

echo "✓ CDP port is accessible (port $CDP_PORT)"
echo "✓ GATE 4 PASSED: Process health verified"

# ============================================================================
# GATE 5: READ LOGS (MANDATORY)
# ============================================================================
echo ""
echo "┌─────────────────────────────────────────┐"
echo "│ GATE 5: READ LOGS (MANDATORY)            │"
echo "└─────────────────────────────────────────┘"

echo "=== ELECTRON RUNTIME LOGS ==="
cat "$LOG_FILE"
echo "=== END LOGS ==="

echo ""
echo "✓ GATE 5 PASSED: Logs read"

# ============================================================================
# GATE 6: VERIFY LOGS
# ============================================================================
echo ""
echo "┌─────────────────────────────────────────┐"
echo "│ GATE 6: VERIFY LOGS                      │"
echo "└─────────────────────────────────────────┘"

# Check for critical errors
if grep -qE "(ERROR|FATAL|CRITICAL|Segmentation|core dumped|Uncaught Exception)" "$LOG_FILE"; then
  echo "✗ GATE 6 FAILED: Errors found in logs"
  echo ""
  echo "Error lines:"
  grep -E "(ERROR|FATAL|CRITICAL|Segmentation|core dumped|Uncaught Exception)" "$LOG_FILE"
  kill $APP_PID 2>/dev/null || true
  exit 1
fi

echo "✓ No critical errors in logs"
echo "✓ GATE 6 PASSED: Log verification complete"

# ============================================================================
# NOW: E2E TESTING
# ============================================================================
echo ""
echo "┌─────────────────────────────────────────┐"
echo "│ E2E TESTING (All gates passed)           │"
echo "└─────────────────────────────────────────┘"

# Get WebSocket URL
WS_URL=$(curl -s http://localhost:$CDP_PORT/json/list | jq -r '.[0].webSocketDebuggerUrl')

if [ -z "$WS_URL" ] || [ "$WS_URL" = "null" ]; then
  echo "✗ E2E FAILED: Could not get WebSocket URL"
  kill $APP_PID 2>/dev/null || true
  exit 1
fi

echo "CDP WebSocket: $WS_URL"

# Test 1: Enable Runtime domain
echo ""
echo "Test 1: Enable Runtime domain..."
RESPONSE=$(echo '{"id":1,"method":"Runtime.enable"}' | websocat --one-message "$WS_URL")

if echo "$RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  echo "✗ Test 1 FAILED: $(echo "$RESPONSE" | jq -r '.error.message')"
  kill $APP_PID 2>/dev/null || true
  exit 1
fi

echo "✓ Test 1 PASSED: Runtime domain enabled"

# Test 2: Get document title
echo ""
echo "Test 2: Get document title..."
RESPONSE=$(echo '{"id":2,"method":"Runtime.evaluate","params":{"expression":"document.title","returnByValue":true}}' | websocat --one-message "$WS_URL")

if echo "$RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  echo "✗ Test 2 FAILED: $(echo "$RESPONSE" | jq -r '.error.message')"
  kill $APP_PID 2>/dev/null || true
  exit 1
fi

if echo "$RESPONSE" | jq -e '.result.exceptionDetails' > /dev/null 2>&1; then
  echo "✗ Test 2 FAILED: JavaScript error"
  echo "$RESPONSE" | jq '.result.exceptionDetails'
  kill $APP_PID 2>/dev/null || true
  exit 1
fi

TITLE=$(echo "$RESPONSE" | jq -r '.result.result.value')
echo "✓ Test 2 PASSED: Document title = '$TITLE'"

# Test 3: Verify DOM element exists
echo ""
echo "Test 3: Verify #app element exists..."
RESPONSE=$(echo '{"id":3,"method":"Runtime.evaluate","params":{"expression":"document.querySelector(\"#app\") !== null","returnByValue":true}}' | websocat --one-message "$WS_URL")

ELEMENT_EXISTS=$(echo "$RESPONSE" | jq -r '.result.result.value')

if [ "$ELEMENT_EXISTS" != "true" ]; then
  echo "✗ Test 3 FAILED: #app element not found"
  kill $APP_PID 2>/dev/null || true
  exit 1
fi

echo "✓ Test 3 PASSED: #app element found"

# Test 4: Take screenshot
echo ""
echo "Test 4: Capture screenshot..."
echo '{"id":4,"method":"Page.enable"}' | websocat --one-message "$WS_URL" > /dev/null

SCREENSHOT_RESPONSE=$(echo '{"id":5,"method":"Page.captureScreenshot","params":{"format":"png"}}' | websocat --one-message "$WS_URL")

if echo "$SCREENSHOT_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  echo "✗ Test 4 FAILED: $(echo "$SCREENSHOT_RESPONSE" | jq -r '.error.message')"
  kill $APP_PID 2>/dev/null || true
  exit 1
fi

# Save screenshot
SCREENSHOT_PATH="/tmp/electron_e2e_screenshot.png"
echo "$SCREENSHOT_RESPONSE" | jq -r '.result.data' | base64 -d > "$SCREENSHOT_PATH"

if [ ! -f "$SCREENSHOT_PATH" ]; then
  echo "✗ Test 4 FAILED: Screenshot not saved"
  kill $APP_PID 2>/dev/null || true
  exit 1
fi

echo "✓ Test 4 PASSED: Screenshot saved to $SCREENSHOT_PATH"

# Test 5: Execute JavaScript and verify
echo ""
echo "Test 5: Execute JavaScript (2 + 2)..."
RESPONSE=$(echo '{"id":6,"method":"Runtime.evaluate","params":{"expression":"2 + 2","returnByValue":true}}' | websocat --one-message "$WS_URL")

RESULT=$(echo "$RESPONSE" | jq -r '.result.result.value')

if [ "$RESULT" != "4" ]; then
  echo "✗ Test 5 FAILED: Expected 4, got $RESULT"
  kill $APP_PID 2>/dev/null || true
  exit 1
fi

echo "✓ Test 5 PASSED: JavaScript execution verified (2 + 2 = $RESULT)"

# ============================================================================
# CLEANUP
# ============================================================================
echo ""
echo "┌─────────────────────────────────────────┐"
echo "│ CLEANUP                                  │"
echo "└─────────────────────────────────────────┘"

kill $APP_PID 2>/dev/null || true
echo "✓ App terminated (PID: $APP_PID)"

# ============================================================================
# SUMMARY
# ============================================================================
echo ""
echo "========================================="
echo "✓ ALL TESTS PASSED"
echo "========================================="
echo ""
echo "Gates completed:"
echo "  ✓ GATE 1: BUILD"
echo "  ✓ GATE 2: LAUNCH"
echo "  ✓ GATE 3: WAIT"
echo "  ✓ GATE 4: CHECK PROCESS"
echo "  ✓ GATE 5: READ LOGS"
echo "  ✓ GATE 6: VERIFY LOGS"
echo ""
echo "E2E tests passed:"
echo "  ✓ Runtime domain enabled"
echo "  ✓ Document title retrieved"
echo "  ✓ DOM element verified"
echo "  ✓ Screenshot captured"
echo "  ✓ JavaScript execution verified"
echo ""
echo "Artifacts:"
echo "  - Log file: $LOG_FILE"
echo "  - Screenshot: $SCREENSHOT_PATH"
echo ""

exit 0
