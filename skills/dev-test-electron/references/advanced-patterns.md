# Advanced Electron CDP Patterns

Complex testing scenarios for Electron applications.

## Multi-Window Testing

### Enumerate All Windows

```bash
#!/bin/bash
# Get all CDP targets (all windows)
TARGETS=$(curl -s http://localhost:9222/json/list)

echo "All Electron windows:"
echo "$TARGETS" | jq -r '.[] | "\(.title) - \(.url)"'

# Filter by URL pattern
SETTINGS_WS=$(echo "$TARGETS" | jq -r '.[] | select(.url | contains("settings.html")) | .webSocketDebuggerUrl')
MAIN_WS=$(echo "$TARGETS" | jq -r '.[] | select(.url | contains("index.html")) | .webSocketDebuggerUrl')

echo "Main window: $MAIN_WS"
echo "Settings window: $SETTINGS_WS"
```

### Test Window Communication

```bash
#!/bin/bash
# Test data flow between windows via main process

# Window 1: Set shared data
SCRIPT_1='
window.electronAPI.invoke("set-shared-data", {key: "test", value: "hello"})
'

RESPONSE=$(echo "{\"id\":1,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":$(echo "$SCRIPT_1" | jq -Rs .),\"awaitPromise\":true}}" | websocat --one-message "$WINDOW1_WS")

if echo "$RESPONSE" | jq -e '.result.exceptionDetails' > /dev/null; then
  echo "✗ FAILED: Could not set shared data"
  exit 1
fi

echo "✓ Window 1: Shared data set"

# Wait for propagation
sleep 0.5

# Window 2: Get shared data
SCRIPT_2='
window.electronAPI.invoke("get-shared-data", "test")
'

RESPONSE=$(echo "{\"id\":2,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":$(echo "$SCRIPT_2" | jq -Rs .),\"awaitPromise\":true,\"returnByValue\":true}}" | websocat --one-message "$WINDOW2_WS")

VALUE=$(echo "$RESPONSE" | jq -r '.result.result.value')
if [ "$VALUE" != "hello" ]; then
  echo "✗ FAILED: Window 2 did not receive data (expected 'hello', got '$VALUE')"
  exit 1
fi

echo "✓ Window 2: Retrieved shared data = '$VALUE'"
echo "✓ VERIFIED: Inter-window communication works"
```

### Parallel Window Testing

```bash
#!/bin/bash
# Test multiple windows concurrently

test_window() {
  local ws_url="$1"
  local window_name="$2"

  # Enable Runtime
  echo '{"id":1,"method":"Runtime.enable"}' | websocat --one-message "$ws_url"

  # Get window title
  RESPONSE=$(echo '{"id":2,"method":"Runtime.evaluate","params":{"expression":"document.title","returnByValue":true}}' | websocat --one-message "$ws_url")

  TITLE=$(echo "$RESPONSE" | jq -r '.result.result.value')
  echo "$window_name: Title = '$TITLE'"
}

# Test all windows in parallel
ALL_WINDOWS=$(curl -s http://localhost:9222/json/list | jq -r '.[] | select(.type == "page") | .webSocketDebuggerUrl')

INDEX=0
for WS in $ALL_WINDOWS; do
  INDEX=$((INDEX + 1))
  test_window "$WS" "Window $INDEX" &
done

# Wait for all tests
wait

echo "✓ All windows tested"
```

## Event Streaming

### Stream Console Logs

```bash
#!/bin/bash
# Stream console logs in real-time

WS_URL=$(curl -s http://localhost:9222/json/list | jq -r '.[0].webSocketDebuggerUrl')

# Start streaming
{
  # Enable Runtime domain
  echo '{"id":1,"method":"Runtime.enable"}'

  # Keep connection alive
  sleep 300  # Listen for 5 minutes
} | websocat "$WS_URL" | while read -r line; do
  # Parse console events
  METHOD=$(echo "$line" | jq -r '.method // empty')

  if [ "$METHOD" = "Runtime.consoleAPICalled" ]; then
    TYPE=$(echo "$line" | jq -r '.params.type')
    ARGS=$(echo "$line" | jq -r '.params.args | map(.value // .description) | join(" ")')
    TIMESTAMP=$(echo "$line" | jq -r '.params.timestamp')

    echo "[$TIMESTAMP] console.$TYPE: $ARGS"
  fi
done
```

### Stream Network Events

```bash
#!/bin/bash
# Monitor all network requests/responses

WS_URL=$(curl -s http://localhost:9222/json/list | jq -r '.[0].webSocketDebuggerUrl')

# Track requests
declare -A REQUESTS

{
  echo '{"id":1,"method":"Network.enable"}'
  sleep 60
} | websocat "$WS_URL" | while read -r line; do
  METHOD=$(echo "$line" | jq -r '.method // empty')

  case "$METHOD" in
    Network.requestWillBeSent)
      REQ_ID=$(echo "$line" | jq -r '.params.requestId')
      URL=$(echo "$line" | jq -r '.params.request.url')
      REQUEST_METHOD=$(echo "$line" | jq -r '.params.request.method')

      echo "→ REQUEST: $REQUEST_METHOD $URL"
      REQUESTS[$REQ_ID]="$URL"
      ;;

    Network.responseReceived)
      REQ_ID=$(echo "$line" | jq -r '.params.requestId')
      STATUS=$(echo "$line" | jq -r '.params.response.status')
      URL="${REQUESTS[$REQ_ID]}"

      echo "← RESPONSE: $STATUS $URL"
      ;;

    Network.loadingFailed)
      REQ_ID=$(echo "$line" | jq -r '.params.requestId')
      ERROR=$(echo "$line" | jq -r '.params.errorText')
      URL="${REQUESTS[$REQ_ID]}"

      echo "✗ FAILED: $URL ($ERROR)"
      ;;
  esac
done
```

### Stream Page Lifecycle Events

```bash
#!/bin/bash
# Monitor page load, DOM ready, etc.

WS_URL=$(curl -s http://localhost:9222/json/list | jq -r '.[0].webSocketDebuggerUrl')

{
  echo '{"id":1,"method":"Page.enable"}'
  echo '{"id":2,"method":"Runtime.enable"}'
  sleep 30
} | websocat "$WS_URL" | while read -r line; do
  METHOD=$(echo "$line" | jq -r '.method // empty')

  case "$METHOD" in
    Page.loadEventFired)
      echo "✓ Page load complete"
      ;;

    Page.domContentEventFired)
      echo "✓ DOM content loaded"
      ;;

    Page.frameNavigated)
      URL=$(echo "$line" | jq -r '.params.frame.url')
      echo "→ Navigated to: $URL"
      ;;

    Runtime.executionContextCreated)
      NAME=$(echo "$line" | jq -r '.params.context.name')
      echo "✓ Execution context created: $NAME"
      ;;
  esac
done
```

## Headless Mode

### Launch Electron Headless

```bash
# Electron headless mode (Xvfb on Linux)
if [ "$(uname)" = "Linux" ]; then
  # Start virtual display
  Xvfb :99 -screen 0 1920x1080x24 &
  XVFB_PID=$!
  export DISPLAY=:99
fi

# Launch Electron
/path/to/app --remote-debugging-port=9222 --enable-logging --log-file=/tmp/electron.log 2>&1 &
APP_PID=$!

# Wait for startup
sleep 3

# Run tests...

# Cleanup
kill $APP_PID
[ -n "$XVFB_PID" ] && kill $XVFB_PID
```

### Headless Screenshot

```bash
#!/bin/bash
# Take screenshot in headless mode

WS_URL=$(curl -s http://localhost:9222/json/list | jq -r '.[0].webSocketDebuggerUrl')

# Enable Page domain
echo '{"id":1,"method":"Page.enable"}' | websocat --one-message "$WS_URL"

# Wait for page load
sleep 2

# Capture screenshot
RESPONSE=$(echo '{"id":2,"method":"Page.captureScreenshot","params":{"format":"png"}}' | websocat --one-message "$WS_URL")

if echo "$RESPONSE" | jq -e '.error' > /dev/null; then
  echo "✗ Screenshot failed: $(echo "$RESPONSE" | jq -r '.error.message')"
  exit 1
fi

# Save screenshot
echo "$RESPONSE" | jq -r '.result.data' | base64 -d > /tmp/headless_screenshot.png
echo "✓ Screenshot saved: /tmp/headless_screenshot.png"
```

## DevTools Integration

### Open DevTools Programmatically

```bash
# From main process
OPEN_DEVTOOLS='
const { BrowserWindow } = require("electron");
BrowserWindow.getFocusedWindow().webContents.openDevTools({mode: "detach"});
'

MAIN_WS=$(curl -s http://localhost:9222/json/list | jq -r '.[] | select(.type == "node") | .webSocketDebuggerUrl')

echo "{\"id\":1,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":$(echo "$OPEN_DEVTOOLS" | jq -Rs .)}}" | websocat --one-message "$MAIN_WS"

echo "✓ DevTools opened"
```

### Execute in DevTools Context

```bash
# Get DevTools WebSocket URL (it appears as a separate target)
sleep 2  # Wait for DevTools to initialize
DEVTOOLS_WS=$(curl -s http://localhost:9222/json/list | jq -r '.[] | select(.url | contains("devtools://")) | .webSocketDebuggerUrl')

if [ -z "$DEVTOOLS_WS" ]; then
  echo "DevTools not available"
  exit 1
fi

echo "DevTools WebSocket: $DEVTOOLS_WS"

# Now you can automate DevTools itself
echo '{"id":1,"method":"Runtime.enable"}' | websocat --one-message "$DEVTOOLS_WS"
```

## Performance Monitoring

### Capture Performance Metrics

```bash
#!/bin/bash
# Collect performance metrics

WS_URL=$(curl -s http://localhost:9222/json/list | jq -r '.[0].webSocketDebuggerUrl')

# Enable Performance domain
echo '{"id":1,"method":"Performance.enable"}' | websocat --one-message "$WS_URL"

# Get metrics
RESPONSE=$(echo '{"id":2,"method":"Performance.getMetrics"}' | websocat --one-message "$WS_URL")

# Parse metrics
echo "$RESPONSE" | jq -r '.result.metrics[] | "\(.name): \(.value)"'

# Example metrics:
# Timestamp, Documents, Frames, JSEventListeners, Nodes, LayoutCount, RecalcStyleCount,
# JSHeapUsedSize, JSHeapTotalSize, etc.
```

### Memory Profiling

```bash
#!/bin/bash
# Capture heap snapshot

WS_URL=$(curl -s http://localhost:9222/json/list | jq -r '.[0].webSocketDebuggerUrl')

# Enable HeapProfiler
echo '{"id":1,"method":"HeapProfiler.enable"}' | websocat --one-message "$WS_URL"

# Take heap snapshot
echo '{"id":2,"method":"HeapProfiler.takeHeapSnapshot"}' | websocat --one-message "$WS_URL"

# Heap snapshot is returned as a series of HeapProfiler.addHeapSnapshotChunk events
# Collect all chunks and save to file
```

### CPU Profiling

```bash
#!/bin/bash
# Profile JavaScript execution

WS_URL=$(curl -s http://localhost:9222/json/list | jq -r '.[0].webSocketDebuggerUrl')

# Enable Profiler
echo '{"id":1,"method":"Profiler.enable"}' | websocat --one-message "$WS_URL"

# Start profiling
echo '{"id":2,"method":"Profiler.start"}' | websocat --one-message "$WS_URL"

# Let app run for 10 seconds
sleep 10

# Stop profiling
RESPONSE=$(echo '{"id":3,"method":"Profiler.stop"}' | websocat --one-message "$WS_URL")

# Save profile
echo "$RESPONSE" | jq '.result.profile' > /tmp/cpu_profile.json
echo "✓ CPU profile saved: /tmp/cpu_profile.json"
```

## Coverage Collection

### JavaScript Coverage

```bash
#!/bin/bash
# Collect JS code coverage

WS_URL=$(curl -s http://localhost:9222/json/list | jq -r '.[0].webSocketDebuggerUrl')

# Enable Profiler
echo '{"id":1,"method":"Profiler.enable"}' | websocat --one-message "$WS_URL"

# Start precise coverage
echo '{"id":2,"method":"Profiler.startPreciseCoverage","params":{"callCount":true,"detailed":true}}' | websocat --one-message "$WS_URL"

# Run tests...
# (execute user actions, run E2E scenarios)
sleep 5

# Take coverage snapshot
RESPONSE=$(echo '{"id":3,"method":"Profiler.takePreciseCoverage"}' | websocat --one-message "$WS_URL")

# Save coverage data
echo "$RESPONSE" | jq '.result.result' > /tmp/coverage.json

# Stop coverage
echo '{"id":4,"method":"Profiler.stopPreciseCoverage"}' | websocat --one-message "$WS_URL"

echo "✓ Coverage saved: /tmp/coverage.json"

# Analyze coverage
TOTAL_BYTES=$(jq '[.[].functions[].ranges[].endOffset - .startOffset] | add' /tmp/coverage.json)
COVERED_BYTES=$(jq '[.[].functions[].ranges[] | select(.count > 0) | .endOffset - .startOffset] | add' /tmp/coverage.json)

COVERAGE_PCT=$(echo "scale=2; $COVERED_BYTES * 100 / $TOTAL_BYTES" | bc)
echo "Coverage: $COVERAGE_PCT%"
```

## Error Injection

### Simulate Network Errors

```bash
#!/bin/bash
# Block network requests to test error handling

WS_URL=$(curl -s http://localhost:9222/json/list | jq -r '.[0].webSocketDebuggerUrl')

# Enable Network
echo '{"id":1,"method":"Network.enable"}' | websocat --one-message "$WS_URL"

# Block URL pattern
echo '{"id":2,"method":"Network.setBlockedURLs","params":{"urls":["*api.example.com*"]}}' | websocat --one-message "$WS_URL"

echo "✓ Blocked api.example.com requests"

# Now test how app handles network failures
# ...

# Unblock
echo '{"id":3,"method":"Network.setBlockedURLs","params":{"urls":[]}}' | websocat --one-message "$WS_URL"
```

### Emulate Offline Mode

```bash
# Emulate offline network
echo '{"id":10,"method":"Network.emulateNetworkConditions","params":{"offline":true,"latency":0,"downloadThroughput":0,"uploadThroughput":0}}' | websocat --one-message "$WS_URL"

echo "✓ App is now offline"

# Test offline behavior...

# Restore online
echo '{"id":11,"method":"Network.emulateNetworkConditions","params":{"offline":false,"latency":0,"downloadThroughput":-1,"uploadThroughput":-1}}' | websocat --one-message "$WS_URL"
```

### Throttle Network Speed

```bash
# Emulate slow 3G
echo '{"id":12,"method":"Network.emulateNetworkConditions","params":{"offline":false,"latency":100,"downloadThroughput":750000,"uploadThroughput":250000}}' | websocat --one-message "$WS_URL"

echo "✓ Network throttled to slow 3G"
```

## Storage Manipulation

### LocalStorage Access

```bash
# Get all localStorage keys
GET_STORAGE='
(() => {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    keys.push({ key, value: localStorage.getItem(key) });
  }
  return keys;
})()
'

RESPONSE=$(echo "{\"id\":1,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":$(echo "$GET_STORAGE" | jq -Rs .),\"returnByValue\":true}}" | websocat --one-message "$WS_URL")

STORAGE=$(echo "$RESPONSE" | jq -r '.result.result.value')
echo "LocalStorage: $STORAGE"
```

### Set LocalStorage Item

```bash
# Set localStorage item
SET_ITEM='localStorage.setItem("test-key", "test-value")'

echo "{\"id\":2,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$SET_ITEM\"}}" | websocat --one-message "$WS_URL"

echo "✓ LocalStorage item set"
```

### Clear All Storage

```bash
# Clear localStorage, sessionStorage, IndexedDB, etc.
CLEAR_ALL='
localStorage.clear();
sessionStorage.clear();
indexedDB.databases().then(dbs => dbs.forEach(db => indexedDB.deleteDatabase(db.name)));
'

echo "{\"id\":3,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":$(echo "$CLEAR_ALL" | jq -Rs .)}}" | websocat --one-message "$WS_URL"

echo "✓ All storage cleared"
```

## Custom Protocol Testing

### Register Custom Protocol Handler

From main process:

```bash
# Register custom protocol (e.g., myapp://)
REGISTER_PROTOCOL='
const { protocol } = require("electron");
protocol.registerStringProtocol("myapp", (request, callback) => {
  const url = request.url.replace("myapp://", "");
  callback({ data: `<html><body>Custom protocol: ${url}</body></html>`, mimeType: "text/html" });
});
'

MAIN_WS=$(curl -s http://localhost:9222/json/list | jq -r '.[] | select(.type == "node") | .webSocketDebuggerUrl')

echo "{\"id\":1,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":$(echo "$REGISTER_PROTOCOL" | jq -Rs .)}}" | websocat --one-message "$MAIN_WS"

echo "✓ Custom protocol registered"

# Now navigate to custom protocol URL
RENDERER_WS=$(curl -s http://localhost:9222/json/list | jq -r '.[0].webSocketDebuggerUrl')

echo '{"id":10,"method":"Page.navigate","params":{"url":"myapp://test-page"}}' | websocat --one-message "$RENDERER_WS"

# Verify page loaded
sleep 1
RESPONSE=$(echo '{"id":11,"method":"Runtime.evaluate","params":{"expression":"document.body.textContent","returnByValue":true}}' | websocat --one-message "$RENDERER_WS")

CONTENT=$(echo "$RESPONSE" | jq -r '.result.result.value')
echo "Page content: $CONTENT"
```

## Complete Advanced E2E Test

```bash
#!/bin/bash
set -e

# Multi-window + Performance + Network monitoring test

# 1. Launch app (gates 1-6 assumed completed)
APP_PID=$(pgrep -f "electron.*--remote-debugging-port=9222")

# 2. Get all windows
MAIN_WS=$(curl -s http://localhost:9222/json/list | jq -r '.[] | select(.url | contains("index.html")) | .webSocketDebuggerUrl')
SETTINGS_WS=$(curl -s http://localhost:9222/json/list | jq -r '.[] | select(.url | contains("settings.html")) | .webSocketDebuggerUrl')

echo "✓ Connected to 2 windows"

# 3. Start performance monitoring
echo '{"id":1,"method":"Performance.enable"}' | websocat --one-message "$MAIN_WS" &

# 4. Start network monitoring
{
  echo '{"id":2,"method":"Network.enable"}'
  sleep 30
} | websocat "$MAIN_WS" > /tmp/network_events.txt &
NETWORK_PID=$!

# 5. Test main window workflow
echo '{"id":10,"method":"Runtime.enable"}' | websocat --one-message "$MAIN_WS"

CLICK_BTN='document.querySelector("#load-data-btn").click()'
echo "{\"id\":11,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$CLICK_BTN\"}}" | websocat --one-message "$MAIN_WS"

echo "✓ Clicked load data button"

# 6. Wait for network request
sleep 2

# 7. Verify data loaded
CHECK_DATA='document.querySelector(".data-loaded") !== null'
RESPONSE=$(echo "{\"id\":12,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$CHECK_DATA\",\"returnByValue\":true}}" | websocat --one-message "$MAIN_WS")

LOADED=$(echo "$RESPONSE" | jq -r '.result.result.value')
if [ "$LOADED" != "true" ]; then
  echo "✗ FAILED: Data not loaded"
  exit 1
fi

echo "✓ Data loaded successfully"

# 8. Test settings window
echo '{"id":20,"method":"Runtime.enable"}' | websocat --one-message "$SETTINGS_WS"

SET_THEME='document.querySelector("#theme-select").value = "dark"'
echo "{\"id\":21,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$SET_THEME\"}}" | websocat --one-message "$SETTINGS_WS"

SAVE_BTN='document.querySelector("#save-btn").click()'
echo "{\"id\":22,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$SAVE_BTN\"}}" | websocat --one-message "$SETTINGS_WS"

echo "✓ Changed theme to dark"

# 9. Verify theme applied in main window
sleep 1
CHECK_THEME='document.body.classList.contains("dark-theme")'
RESPONSE=$(echo "{\"id\":13,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$CHECK_THEME\",\"returnByValue\":true}}" | websocat --one-message "$MAIN_WS")

IS_DARK=$(echo "$RESPONSE" | jq -r '.result.result.value')
if [ "$IS_DARK" != "true" ]; then
  echo "✗ FAILED: Theme not applied"
  exit 1
fi

echo "✓ Dark theme applied across windows"

# 10. Get performance metrics
PERF_RESPONSE=$(echo '{"id":14,"method":"Performance.getMetrics"}' | websocat --one-message "$MAIN_WS")

HEAP_SIZE=$(echo "$PERF_RESPONSE" | jq -r '.result.metrics[] | select(.name == "JSHeapUsedSize") | .value')
echo "Heap size: $HEAP_SIZE bytes"

# 11. Stop network monitoring
kill $NETWORK_PID

# 12. Analyze network logs
REQUEST_COUNT=$(grep -c "Network.requestWillBeSent" /tmp/network_events.txt || true)
echo "Network requests: $REQUEST_COUNT"

# 13. Take screenshots
echo '{"id":30,"method":"Page.captureScreenshot"}' | websocat --one-message "$MAIN_WS" | jq -r '.result.data' | base64 -d > /tmp/main_window.png
echo '{"id":31,"method":"Page.captureScreenshot"}' | websocat --one-message "$SETTINGS_WS" | jq -r '.result.data' | base64 -d > /tmp/settings_window.png

echo "✓ Screenshots saved"

echo "✓ ALL ADVANCED TESTS PASSED"
```

## Best Practices

1. **Always verify both main and renderer processes** - Don't skip main process testing
2. **Stream events for long-running tests** - Use event listeners instead of polling
3. **Clean up resources** - Close windows, clear storage, kill background processes
4. **Use unique IDs for CDP commands** - Makes debugging responses easier
5. **Wait for async operations** - Use `awaitPromise: true` for promises
6. **Handle WebSocket reconnections** - Connections can drop, implement retry logic
7. **Monitor performance** - Collect metrics to catch regressions
8. **Test offline scenarios** - Use network emulation to test error handling
