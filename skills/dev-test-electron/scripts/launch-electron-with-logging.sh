#!/bin/bash
# Launch Electron with proper logging and CDP enabled
# Usage: ./launch-electron-with-logging.sh <app-path> [cdp-port] [log-file]

set -e

# Configuration
APP_PATH="${1:?Error: App path required. Usage: $0 <app-path> [cdp-port] [log-file]}"
CDP_PORT="${2:-9222}"
LOG_FILE="${3:-/tmp/electron.log}"

# Validate app exists
if [ ! -e "$APP_PATH" ]; then
  echo "✗ ERROR: App not found at $APP_PATH"
  exit 1
fi

echo "Electron Launch Utility"
echo "======================="
echo ""
echo "Configuration:"
echo "  App path: $APP_PATH"
echo "  CDP port: $CDP_PORT"
echo "  Log file: $LOG_FILE"
echo ""

# Check for required tools
echo "Checking dependencies..."

MISSING_TOOLS=()

if ! command -v curl &> /dev/null; then
  MISSING_TOOLS+=("curl")
fi

if ! command -v jq &> /dev/null; then
  MISSING_TOOLS+=("jq")
fi

if ! command -v websocat &> /dev/null; then
  if ! command -v wscat &> /dev/null; then
    MISSING_TOOLS+=("websocat or wscat")
  fi
fi

if [ ${#MISSING_TOOLS[@]} -gt 0 ]; then
  echo "✗ Missing required tools: ${MISSING_TOOLS[*]}"
  echo ""
  echo "Install with:"
  echo "  macOS:  brew install curl jq websocat"
  echo "  Linux:  sudo apt install curl jq websocat"
  exit 1
fi

echo "✓ All dependencies present"
echo ""

# Clear previous log
echo "Preparing log file..."
> "$LOG_FILE"
echo "✓ Log file cleared: $LOG_FILE"
echo ""

# Check if port is already in use
echo "Checking CDP port availability..."
if lsof -Pi :$CDP_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "⚠ WARNING: Port $CDP_PORT is already in use"
  echo ""
  echo "Processes using port $CDP_PORT:"
  lsof -Pi :$CDP_PORT -sTCP:LISTEN
  echo ""
  read -p "Kill existing processes and continue? (y/N): " -n 1 -r
  echo ""

  if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Killing processes on port $CDP_PORT..."
    lsof -Pi :$CDP_PORT -sTCP:LISTEN -t | xargs kill -9 2>/dev/null || true
    sleep 1
  else
    echo "Aborted."
    exit 1
  fi
fi

echo "✓ Port $CDP_PORT is available"
echo ""

# Determine launch command based on app type
echo "Detecting app type..."

LAUNCH_CMD=""

if [ -d "$APP_PATH" ] && [ -f "$APP_PATH/package.json" ]; then
  # Node.js Electron project
  echo "✓ Detected Node.js Electron project"

  cd "$APP_PATH"

  if [ -f "package.json" ] && grep -q "\"start\"" package.json; then
    LAUNCH_CMD="npm start -- --remote-debugging-port=$CDP_PORT --enable-logging --log-file=$LOG_FILE"
  else
    echo "✗ ERROR: No 'start' script found in package.json"
    exit 1
  fi

elif [ -f "$APP_PATH" ] && file "$APP_PATH" | grep -q "Mach-O"; then
  # macOS .app bundle or binary
  echo "✓ Detected macOS Electron binary"
  LAUNCH_CMD="$APP_PATH --remote-debugging-port=$CDP_PORT --enable-logging --log-file=$LOG_FILE"

elif [ -f "$APP_PATH" ] && file "$APP_PATH" | grep -q "ELF"; then
  # Linux binary
  echo "✓ Detected Linux Electron binary"
  LAUNCH_CMD="$APP_PATH --remote-debugging-port=$CDP_PORT --enable-logging --log-file=$LOG_FILE"

else
  echo "✗ ERROR: Unknown app type at $APP_PATH"
  echo ""
  echo "Supported formats:"
  echo "  - Node.js project directory with package.json"
  echo "  - macOS binary (.app or Mach-O executable)"
  echo "  - Linux binary (ELF executable)"
  exit 1
fi

echo ""
echo "Launch command:"
echo "  $LAUNCH_CMD"
echo ""

# Launch app
echo "Launching Electron app..."
echo "========================="
echo ""

# Launch in background and capture PID
$LAUNCH_CMD 2>&1 &
APP_PID=$!

echo "✓ App launched (PID: $APP_PID)"
echo ""

# Wait for initialization
echo "Waiting for app initialization..."
sleep 3

# Check if process is still running
if ! ps -p $APP_PID > /dev/null; then
  echo "✗ ERROR: App process crashed during startup"
  echo ""
  echo "=== LOG OUTPUT ==="
  cat "$LOG_FILE"
  echo "=================="
  exit 1
fi

echo "✓ App process is running"
echo ""

# Wait for CDP port to be accessible
echo "Waiting for CDP port..."
MAX_RETRIES=10
RETRY=0

while [ $RETRY -lt $MAX_RETRIES ]; do
  if curl -s http://localhost:$CDP_PORT/json/list > /dev/null 2>&1; then
    echo "✓ CDP port is accessible"
    break
  fi

  RETRY=$((RETRY + 1))
  if [ $RETRY -eq $MAX_RETRIES ]; then
    echo "✗ ERROR: CDP port not accessible after $MAX_RETRIES attempts"
    echo ""
    echo "=== LOG OUTPUT ==="
    cat "$LOG_FILE"
    echo "=================="
    kill $APP_PID 2>/dev/null || true
    exit 1
  fi

  echo "  Waiting for CDP (attempt $RETRY/$MAX_RETRIES)..."
  sleep 1
done

echo ""

# Read and verify logs
echo "Reading initial logs..."
echo "======================="
echo ""

if [ -s "$LOG_FILE" ]; then
  cat "$LOG_FILE"
else
  echo "(Log file is empty)"
fi

echo ""
echo "======================="
echo ""

# Check for errors in logs
if grep -qE "(ERROR|FATAL|CRITICAL|Segmentation|core dumped|Uncaught Exception)" "$LOG_FILE" 2>/dev/null; then
  echo "⚠ WARNING: Errors found in logs"
  echo ""
  echo "Error lines:"
  grep -E "(ERROR|FATAL|CRITICAL|Segmentation|core dumped|Uncaught Exception)" "$LOG_FILE"
  echo ""
  echo "App is running but may have issues. Review logs carefully."
else
  echo "✓ No critical errors in logs"
fi

echo ""

# Get CDP connection info
echo "CDP Connection Info"
echo "==================="
echo ""

TARGETS=$(curl -s http://localhost:$CDP_PORT/json/list)

RENDERER_WS=$(echo "$TARGETS" | jq -r '.[] | select(.type == "page") | .webSocketDebuggerUrl' | head -1)
MAIN_WS=$(echo "$TARGETS" | jq -r '.[] | select(.type == "node") | .webSocketDebuggerUrl' | head -1)

echo "HTTP endpoint:"
echo "  http://localhost:$CDP_PORT/json/list"
echo ""

if [ -n "$RENDERER_WS" ] && [ "$RENDERER_WS" != "null" ]; then
  echo "Renderer WebSocket:"
  echo "  $RENDERER_WS"
else
  echo "⚠ Renderer WebSocket not found"
fi

echo ""

if [ -n "$MAIN_WS" ] && [ "$MAIN_WS" != "null" ]; then
  echo "Main process WebSocket:"
  echo "  $MAIN_WS"
else
  echo "⚠ Main process not available"
  echo ""
  echo "To enable main process debugging, restart with:"
  echo "  NODE_OPTIONS=\"--inspect=5858\" $0 $APP_PATH $CDP_PORT $LOG_FILE"
fi

echo ""
echo "==================="
echo ""

# Export variables
echo "Environment Variables"
echo "====================="
echo ""
echo "export APP_PID=$APP_PID"
echo "export CDP_PORT=$CDP_PORT"
echo "export LOG_FILE='$LOG_FILE'"

if [ -n "$RENDERER_WS" ] && [ "$RENDERER_WS" != "null" ]; then
  echo "export RENDERER_WS='$RENDERER_WS'"
fi

if [ -n "$MAIN_WS" ] && [ "$MAIN_WS" != "null" ]; then
  echo "export MAIN_WS='$MAIN_WS'"
fi

echo ""

# Save PID to file for cleanup
echo "$APP_PID" > /tmp/electron_app.pid
echo "✓ PID saved to /tmp/electron_app.pid"
echo ""

# Print cleanup instructions
echo "Cleanup"
echo "======="
echo ""
echo "To stop the app:"
echo "  kill $APP_PID"
echo ""
echo "Or use:"
echo "  kill \$(cat /tmp/electron_app.pid)"
echo ""

echo "✓ Electron app is running and ready for testing"
echo ""

# Keep script running (optional - comment out if you want script to exit)
# echo "Press Ctrl+C to stop monitoring..."
# tail -f "$LOG_FILE"

exit 0
