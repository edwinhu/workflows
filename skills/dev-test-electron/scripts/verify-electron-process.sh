#!/bin/bash
# Verify Electron process health (main + renderer)
# Usage: ./verify-electron-process.sh [pid] [cdp-port] [log-file]

set -e

APP_PID="${1}"
CDP_PORT="${2:-9222}"
LOG_FILE="${3:-/tmp/electron.log}"

echo "Electron Process Verification"
echo "=============================="
echo ""

# If PID not provided, try to read from temp file
if [ -z "$APP_PID" ]; then
  if [ -f "/tmp/electron_app.pid" ]; then
    APP_PID=$(cat /tmp/electron_app.pid)
    echo "✓ Read PID from /tmp/electron_app.pid: $APP_PID"
  else
    echo "✗ ERROR: PID not provided and /tmp/electron_app.pid not found"
    echo ""
    echo "Usage: $0 <pid> [cdp-port] [log-file]"
    echo ""
    echo "Or ensure /tmp/electron_app.pid exists with the app PID"
    exit 1
  fi
fi

echo "Configuration:"
echo "  PID: $APP_PID"
echo "  CDP port: $CDP_PORT"
echo "  Log file: $LOG_FILE"
echo ""

# Initialize results
TESTS_PASSED=0
TESTS_FAILED=0
WARNINGS=0

# Function to log test result
log_test() {
  local status="$1"
  local message="$2"

  if [ "$status" = "PASS" ]; then
    echo "✓ $message"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  elif [ "$status" = "FAIL" ]; then
    echo "✗ $message"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  elif [ "$status" = "WARN" ]; then
    echo "⚠ $message"
    WARNINGS=$((WARNINGS + 1))
  fi
}

# ============================================================================
# TEST 1: Process Health
# ============================================================================
echo "TEST 1: Process Health"
echo "----------------------"

if ps -p $APP_PID > /dev/null 2>&1; then
  log_test "PASS" "Main process is running (PID: $APP_PID)"

  # Get process info
  PROCESS_CMD=$(ps -p $APP_PID -o command= 2>/dev/null || echo "unknown")
  echo "  Command: $PROCESS_CMD"

  # Check memory usage
  if command -v ps &> /dev/null; then
    MEM_KB=$(ps -p $APP_PID -o rss= 2>/dev/null || echo "0")
    MEM_MB=$((MEM_KB / 1024))
    echo "  Memory: ${MEM_MB}MB"

    # Warn if memory is very high (>1GB)
    if [ $MEM_MB -gt 1024 ]; then
      log_test "WARN" "High memory usage: ${MEM_MB}MB"
    fi
  fi

  # Check CPU usage (Linux/macOS)
  if command -v ps &> /dev/null; then
    CPU=$(ps -p $APP_PID -o %cpu= 2>/dev/null || echo "0")
    echo "  CPU: ${CPU}%"
  fi

else
  log_test "FAIL" "Process not running (PID: $APP_PID)"
  echo ""
  echo "Process may have crashed. Check logs:"
  echo "  $LOG_FILE"
  exit 1
fi

echo ""

# ============================================================================
# TEST 2: CDP Port Accessibility
# ============================================================================
echo "TEST 2: CDP Port Accessibility"
echo "-------------------------------"

if curl -s http://localhost:$CDP_PORT/json/list > /dev/null 2>&1; then
  log_test "PASS" "CDP port $CDP_PORT is accessible"
else
  log_test "FAIL" "CDP port $CDP_PORT not accessible"
  echo ""
  echo "Possible causes:"
  echo "  - App not started with --remote-debugging-port=$CDP_PORT"
  echo "  - Firewall blocking port"
  echo "  - App crashed before CDP was ready"
fi

echo ""

# ============================================================================
# TEST 3: Renderer Process
# ============================================================================
echo "TEST 3: Renderer Process"
echo "------------------------"

TARGETS=$(curl -s http://localhost:$CDP_PORT/json/list 2>/dev/null || echo "[]")

RENDERER_COUNT=$(echo "$TARGETS" | jq '[.[] | select(.type == "page")] | length' 2>/dev/null || echo "0")

if [ "$RENDERER_COUNT" -gt 0 ]; then
  log_test "PASS" "Found $RENDERER_COUNT renderer process(es)"

  # Get renderer details
  echo "$TARGETS" | jq -r '.[] | select(.type == "page") | "  - [\(.id)] \(.title)"' 2>/dev/null

  # Test renderer connection
  RENDERER_WS=$(echo "$TARGETS" | jq -r '.[] | select(.type == "page") | .webSocketDebuggerUrl' | head -1)

  if [ -n "$RENDERER_WS" ] && [ "$RENDERER_WS" != "null" ]; then
    # Try to connect
    TEST_RESPONSE=$(echo '{"id":1,"method":"Runtime.enable"}' | timeout 5 websocat --one-message "$RENDERER_WS" 2>&1 || echo "{}")

    if echo "$TEST_RESPONSE" | jq -e '.id == 1' > /dev/null 2>&1; then
      log_test "PASS" "Renderer WebSocket connection works"
    else
      log_test "FAIL" "Renderer WebSocket connection failed"
      echo "  Response: $TEST_RESPONSE"
    fi
  fi
else
  log_test "FAIL" "No renderer processes found"
fi

echo ""

# ============================================================================
# TEST 4: Main Process (if available)
# ============================================================================
echo "TEST 4: Main Process Debugging"
echo "-------------------------------"

MAIN_COUNT=$(echo "$TARGETS" | jq '[.[] | select(.type == "node")] | length' 2>/dev/null || echo "0")

if [ "$MAIN_COUNT" -gt 0 ]; then
  log_test "PASS" "Found $MAIN_COUNT main process target(s)"

  # Get main process details
  echo "$TARGETS" | jq -r '.[] | select(.type == "node") | "  - [\(.id)] \(.title)"' 2>/dev/null

  # Test main process connection
  MAIN_WS=$(echo "$TARGETS" | jq -r '.[] | select(.type == "node") | .webSocketDebuggerUrl' | head -1)

  if [ -n "$MAIN_WS" ] && [ "$MAIN_WS" != "null" ]; then
    # Try to connect
    TEST_RESPONSE=$(echo '{"id":1,"method":"Runtime.enable"}' | timeout 5 websocat --one-message "$MAIN_WS" 2>&1 || echo "{}")

    if echo "$TEST_RESPONSE" | jq -e '.id == 1' > /dev/null 2>&1; then
      log_test "PASS" "Main process WebSocket connection works"

      # Get Node.js version
      VERSION_RESPONSE=$(echo '{"id":2,"method":"Runtime.evaluate","params":{"expression":"process.version","returnByValue":true}}' | timeout 5 websocat --one-message "$MAIN_WS" 2>&1 || echo "{}")

      NODE_VERSION=$(echo "$VERSION_RESPONSE" | jq -r '.result.result.value' 2>/dev/null || echo "unknown")
      echo "  Node.js version: $NODE_VERSION"
    else
      log_test "FAIL" "Main process WebSocket connection failed"
      echo "  Response: $TEST_RESPONSE"
    fi
  fi
else
  log_test "WARN" "Main process not available for debugging"
  echo ""
  echo "  To enable main process debugging:"
  echo "    NODE_OPTIONS=\"--inspect=5858\" /path/to/app --remote-debugging-port=$CDP_PORT"
fi

echo ""

# ============================================================================
# TEST 5: Log File Health
# ============================================================================
echo "TEST 5: Log File Health"
echo "-----------------------"

if [ -f "$LOG_FILE" ]; then
  log_test "PASS" "Log file exists: $LOG_FILE"

  # Check log file size
  LOG_SIZE=$(wc -c < "$LOG_FILE" 2>/dev/null || echo "0")
  echo "  Size: $LOG_SIZE bytes"

  if [ "$LOG_SIZE" -eq 0 ]; then
    log_test "WARN" "Log file is empty"
  fi

  # Check for errors in logs
  ERROR_COUNT=$(grep -cE "(ERROR|FATAL|CRITICAL)" "$LOG_FILE" 2>/dev/null || echo "0")
  WARNING_COUNT=$(grep -cE "(WARNING|WARN)" "$LOG_FILE" 2>/dev/null || echo "0")

  if [ "$ERROR_COUNT" -gt 0 ]; then
    log_test "FAIL" "Found $ERROR_COUNT error(s) in logs"
    echo ""
    echo "  Recent errors:"
    grep -E "(ERROR|FATAL|CRITICAL)" "$LOG_FILE" | tail -5 | sed 's/^/    /'
  else
    log_test "PASS" "No errors in logs"
  fi

  if [ "$WARNING_COUNT" -gt 0 ]; then
    log_test "WARN" "Found $WARNING_COUNT warning(s) in logs"
  fi

  # Check for crashes
  if grep -qE "(Segmentation|core dumped|Uncaught Exception)" "$LOG_FILE" 2>/dev/null; then
    log_test "FAIL" "Crash indicators found in logs"
    echo ""
    echo "  Crash indicators:"
    grep -E "(Segmentation|core dumped|Uncaught Exception)" "$LOG_FILE" | tail -3 | sed 's/^/    /'
  fi

else
  log_test "FAIL" "Log file not found: $LOG_FILE"
fi

echo ""

# ============================================================================
# TEST 6: Child Processes
# ============================================================================
echo "TEST 6: Child Processes"
echo "-----------------------"

# Count Electron child processes
CHILD_COUNT=$(pgrep -P $APP_PID 2>/dev/null | wc -l)

if [ "$CHILD_COUNT" -gt 0 ]; then
  log_test "PASS" "Found $CHILD_COUNT child process(es)"

  # List child PIDs
  CHILD_PIDS=$(pgrep -P $APP_PID 2>/dev/null | tr '\n' ' ')
  echo "  Child PIDs: $CHILD_PIDS"

  # Check if any children are zombies
  ZOMBIE_COUNT=$(ps -o stat= -p $(pgrep -P $APP_PID 2>/dev/null) 2>/dev/null | grep -c Z || echo "0")

  if [ "$ZOMBIE_COUNT" -gt 0 ]; then
    log_test "WARN" "Found $ZOMBIE_COUNT zombie process(es)"
  fi
else
  log_test "WARN" "No child processes found (may be normal for some apps)"
fi

echo ""

# ============================================================================
# SUMMARY
# ============================================================================
echo "=============================="
echo "Verification Summary"
echo "=============================="
echo ""

TOTAL_TESTS=$((TESTS_PASSED + TESTS_FAILED))

echo "Tests run: $TOTAL_TESTS"
echo "Passed: $TESTS_PASSED"
echo "Failed: $TESTS_FAILED"
echo "Warnings: $WARNINGS"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo "✓ ALL TESTS PASSED"

  if [ $WARNINGS -gt 0 ]; then
    echo ""
    echo "⚠ $WARNINGS warning(s) - review output above"
  fi

  echo ""
  echo "Electron app is healthy and ready for testing."
  exit 0
else
  echo "✗ $TESTS_FAILED TEST(S) FAILED"
  echo ""
  echo "Review failures above and check:"
  echo "  1. Process health (PID: $APP_PID)"
  echo "  2. CDP connectivity (port: $CDP_PORT)"
  echo "  3. Log file: $LOG_FILE"
  exit 1
fi
