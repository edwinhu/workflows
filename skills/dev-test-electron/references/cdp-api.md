# Chrome DevTools Protocol API Reference

Complete reference for CDP domains used in Electron automation.

## Runtime Domain

Execute JavaScript and manage runtime environment.

### Runtime.enable

Enable Runtime domain to receive events.

```json
{"id":1,"method":"Runtime.enable"}
```

**Response:**
```json
{"id":1,"result":{}}
```

### Runtime.evaluate

Execute JavaScript expression in the renderer process.

```json
{
  "id":2,
  "method":"Runtime.evaluate",
  "params":{
    "expression":"document.title",
    "returnByValue":true
  }
}
```

**Parameters:**
- `expression` (string): JavaScript expression to evaluate
- `returnByValue` (boolean, optional): Return result by value instead of object reference
- `awaitPromise` (boolean, optional): Wait for async expressions to resolve
- `userGesture` (boolean, optional): Execute as if initiated by user

**Response (success):**
```json
{
  "id":2,
  "result":{
    "result":{
      "type":"string",
      "value":"My Electron App"
    }
  }
}
```

**Response (error):**
```json
{
  "id":2,
  "result":{
    "exceptionDetails":{
      "text":"ReferenceError: foo is not defined",
      "lineNumber":1,
      "columnNumber":1
    }
  }
}
```

### Runtime.consoleAPICalled (Event)

Fired when console API is called (console.log, console.error, etc.).

**Event payload:**
```json
{
  "method":"Runtime.consoleAPICalled",
  "params":{
    "type":"log",
    "args":[
      {"type":"string","value":"Hello from renderer"}
    ],
    "executionContextId":1,
    "timestamp":1234567890
  }
}
```

**Event types:**
- `log`, `debug`, `info`, `warning`, `error`
- `dir`, `dirxml`, `table`, `trace`
- `clear`, `count`, `assert`

## Page Domain

Control page navigation, lifecycle, and screenshots.

### Page.enable

Enable Page domain to receive navigation and lifecycle events.

```json
{"id":10,"method":"Page.enable"}
```

### Page.navigate

Navigate to a URL (file:// or http://https://).

```json
{
  "id":11,
  "method":"Page.navigate",
  "params":{
    "url":"file:///app/index.html"
  }
}
```

**Response:**
```json
{
  "id":11,
  "result":{
    "frameId":"frame-id",
    "loaderId":"loader-id"
  }
}
```

### Page.loadEventFired (Event)

Fired when page load event is fired.

```json
{
  "method":"Page.loadEventFired",
  "params":{
    "timestamp":1234567890
  }
}
```

### Page.captureScreenshot

Capture screenshot of the current viewport.

```json
{
  "id":12,
  "method":"Page.captureScreenshot",
  "params":{
    "format":"png",
    "quality":80
  }
}
```

**Parameters:**
- `format` (string, optional): "png" or "jpeg" (default: "png")
- `quality` (integer, optional): JPEG quality 0-100 (default: 80)
- `clip` (object, optional): Clip region `{x, y, width, height, scale}`
- `fromSurface` (boolean, optional): Capture from surface (may be slower but more accurate)

**Response:**
```json
{
  "id":12,
  "result":{
    "data":"iVBORw0KGgoAAAANS..."
  }
}
```

**Extract and save:**
```bash
echo "$RESPONSE" | jq -r '.result.data' | base64 -d > screenshot.png
```

### Page.reload

Reload the current page.

```json
{
  "id":13,
  "method":"Page.reload",
  "params":{
    "ignoreCache":true
  }
}
```

## DOM Domain

Query and manipulate the DOM tree.

### DOM.enable

Enable DOM domain.

```json
{"id":20,"method":"DOM.enable"}
```

### DOM.getDocument

Get the root DOM node.

```json
{"id":21,"method":"DOM.getDocument"}
```

**Response:**
```json
{
  "id":21,
  "result":{
    "root":{
      "nodeId":1,
      "nodeType":9,
      "nodeName":"#document",
      "childNodeCount":2
    }
  }
}
```

### DOM.querySelector

Find a single element by CSS selector.

```json
{
  "id":22,
  "method":"DOM.querySelector",
  "params":{
    "nodeId":1,
    "selector":"#submit-btn"
  }
}
```

**Response (found):**
```json
{
  "id":22,
  "result":{
    "nodeId":42
  }
}
```

**Response (not found):**
```json
{
  "id":22,
  "result":{
    "nodeId":0
  }
}
```

### DOM.querySelectorAll

Find all elements matching CSS selector.

```json
{
  "id":23,
  "method":"DOM.querySelectorAll",
  "params":{
    "nodeId":1,
    "selector":".error-message"
  }
}
```

**Response:**
```json
{
  "id":23,
  "result":{
    "nodeIds":[15, 27, 31]
  }
}
```

### DOM.getOuterHTML

Get the outer HTML of a node.

```json
{
  "id":24,
  "method":"DOM.getOuterHTML",
  "params":{
    "nodeId":42
  }
}
```

**Response:**
```json
{
  "id":24,
  "result":{
    "outerHTML":"<button id=\"submit-btn\">Submit</button>"
  }
}
```

## Network Domain

Monitor network activity and intercept requests.

### Network.enable

Enable Network domain to receive request/response events.

```json
{"id":30,"method":"Network.enable"}
```

### Network.requestWillBeSent (Event)

Fired when request is about to be sent.

```json
{
  "method":"Network.requestWillBeSent",
  "params":{
    "requestId":"req-123",
    "loaderId":"loader-id",
    "documentURL":"file:///app/index.html",
    "request":{
      "url":"https://api.example.com/data",
      "method":"GET",
      "headers":{
        "User-Agent":"..."
      }
    },
    "timestamp":1234567890,
    "type":"XHR"
  }
}
```

### Network.responseReceived (Event)

Fired when response is received.

```json
{
  "method":"Network.responseReceived",
  "params":{
    "requestId":"req-123",
    "loaderId":"loader-id",
    "timestamp":1234567891,
    "type":"XHR",
    "response":{
      "url":"https://api.example.com/data",
      "status":200,
      "statusText":"OK",
      "headers":{
        "Content-Type":"application/json"
      }
    }
  }
}
```

### Network.getResponseBody

Get response body content.

```json
{
  "id":31,
  "method":"Network.getResponseBody",
  "params":{
    "requestId":"req-123"
  }
}
```

**Response:**
```json
{
  "id":31,
  "result":{
    "body":"{\"data\":\"...\"}",
    "base64Encoded":false
  }
}
```

## Input Domain

Simulate keyboard and mouse input.

### Input.dispatchKeyEvent

Simulate keyboard events.

```json
{
  "id":40,
  "method":"Input.dispatchKeyEvent",
  "params":{
    "type":"keyDown",
    "key":"Enter",
    "code":"Enter",
    "text":"\r",
    "unmodifiedText":"\r",
    "windowsVirtualKeyCode":13
  }
}
```

**Event types:**
- `keyDown`: Key press
- `keyUp`: Key release
- `char`: Character input

**Common keys:**
```json
// Enter
{"type":"keyDown","key":"Enter","code":"Enter","windowsVirtualKeyCode":13}

// Backspace
{"type":"keyDown","key":"Backspace","code":"Backspace","windowsVirtualKeyCode":8}

// Tab
{"type":"keyDown","key":"Tab","code":"Tab","windowsVirtualKeyCode":9}

// Arrow keys
{"type":"keyDown","key":"ArrowUp","code":"ArrowUp","windowsVirtualKeyCode":38}
{"type":"keyDown","key":"ArrowDown","code":"ArrowDown","windowsVirtualKeyCode":40}

// Modifiers
{"type":"keyDown","key":"Control","code":"ControlLeft","windowsVirtualKeyCode":17,"modifiers":2}
{"type":"keyDown","key":"Shift","code":"ShiftLeft","windowsVirtualKeyCode":16,"modifiers":8}
```

**Modifier bitmask:**
- Alt: 1
- Ctrl: 2
- Meta/Cmd: 4
- Shift: 8

### Input.dispatchMouseEvent

Simulate mouse events.

```json
{
  "id":41,
  "method":"Input.dispatchMouseEvent",
  "params":{
    "type":"mousePressed",
    "x":100,
    "y":200,
    "button":"left",
    "clickCount":1
  }
}
```

**Event types:**
- `mousePressed`: Mouse button down
- `mouseReleased`: Mouse button up
- `mouseMoved`: Mouse movement

**Buttons:**
- `left`, `middle`, `right`, `back`, `forward`

**Click sequence:**
```json
// Click at (100, 200)
{"id":41,"method":"Input.dispatchMouseEvent","params":{"type":"mousePressed","x":100,"y":200,"button":"left","clickCount":1}}
{"id":42,"method":"Input.dispatchMouseEvent","params":{"type":"mouseReleased","x":100,"y":200,"button":"left","clickCount":1}}

// Double-click
{"id":43,"method":"Input.dispatchMouseEvent","params":{"type":"mousePressed","x":100,"y":200,"button":"left","clickCount":2}}
{"id":44,"method":"Input.dispatchMouseEvent","params":{"type":"mouseReleased","x":100,"y":200,"button":"left","clickCount":2}}
```

## Debugger Domain

Set breakpoints and control execution.

### Debugger.enable

Enable Debugger domain.

```json
{"id":50,"method":"Debugger.enable"}
```

### Debugger.setBreakpointByUrl

Set breakpoint by URL and line number.

```json
{
  "id":51,
  "method":"Debugger.setBreakpointByUrl",
  "params":{
    "lineNumber":10,
    "url":"file:///app/renderer.js"
  }
}
```

**Response:**
```json
{
  "id":51,
  "result":{
    "breakpointId":"bp-1",
    "locations":[
      {"scriptId":"script-1","lineNumber":10,"columnNumber":0}
    ]
  }
}
```

### Debugger.paused (Event)

Fired when execution pauses at breakpoint.

```json
{
  "method":"Debugger.paused",
  "params":{
    "callFrames":[
      {
        "callFrameId":"frame-1",
        "functionName":"myFunction",
        "location":{"scriptId":"script-1","lineNumber":10,"columnNumber":0},
        "scopeChain":[...]
      }
    ],
    "reason":"breakpoint"
  }
}
```

### Debugger.resume

Resume execution after pause.

```json
{"id":52,"method":"Debugger.resume"}
```

## Complete CDP Command Examples

### Read Console Logs (Streaming)

```bash
#!/bin/bash
WS_URL="ws://localhost:9222/devtools/page/..."

# Enable Runtime and start listening
{
  echo '{"id":1,"method":"Runtime.enable"}'
  # Keep connection open to receive events
  sleep 10
} | websocat "$WS_URL" | while read -r line; do
  # Filter for console.log events
  if echo "$line" | jq -e '.method == "Runtime.consoleAPICalled"' > /dev/null 2>&1; then
    echo "CONSOLE: $(echo "$line" | jq -r '.params.args[0].value')"
  fi
done
```

### Execute JavaScript and Get Return Value

```bash
SCRIPT='(() => {
  const btn = document.querySelector("#submit-btn");
  return btn ? btn.textContent : null;
})()'

RESPONSE=$(echo "{\"id\":1,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":$(echo "$SCRIPT" | jq -Rs .),\"returnByValue\":true}}" | websocat --one-message "$WS_URL")

# Check for error
if echo "$RESPONSE" | jq -e '.result.exceptionDetails' > /dev/null; then
  echo "ERROR: $(echo "$RESPONSE" | jq -r '.result.exceptionDetails.text')"
  exit 1
fi

# Get result
RESULT=$(echo "$RESPONSE" | jq -r '.result.result.value')
echo "Button text: $RESULT"
```

### Monitor Network Requests

```bash
#!/bin/bash
WS_URL="ws://localhost:9222/devtools/page/..."

# Enable Network domain and listen for events
{
  echo '{"id":1,"method":"Network.enable"}'
  sleep 30  # Listen for 30 seconds
} | websocat "$WS_URL" | while read -r line; do
  if echo "$line" | jq -e '.method == "Network.requestWillBeSent"' > /dev/null 2>&1; then
    URL=$(echo "$line" | jq -r '.params.request.url')
    METHOD=$(echo "$line" | jq -r '.params.request.method')
    echo "REQUEST: $METHOD $URL"
  fi

  if echo "$line" | jq -e '.method == "Network.responseReceived"' > /dev/null 2>&1; then
    URL=$(echo "$line" | jq -r '.params.response.url')
    STATUS=$(echo "$line" | jq -r '.params.response.status')
    echo "RESPONSE: $STATUS $URL"
  fi
done
```

## Error Handling Patterns

### Verify CDP Response

```bash
verify_cdp_response() {
  local response="$1"
  local expected_id="$2"

  # Check response exists
  if [ -z "$response" ]; then
    echo "ERROR: Empty response"
    return 1
  fi

  # Check for CDP error
  if echo "$response" | jq -e '.error' > /dev/null 2>&1; then
    echo "CDP ERROR: $(echo "$response" | jq -r '.error.message')"
    return 1
  fi

  # Check ID matches
  local actual_id=$(echo "$response" | jq -r '.id // empty')
  if [ "$actual_id" != "$expected_id" ]; then
    echo "ERROR: ID mismatch (expected $expected_id, got $actual_id)"
    return 1
  fi

  # Check for result
  if ! echo "$response" | jq -e '.result' > /dev/null 2>&1; then
    echo "ERROR: No result in response"
    return 1
  fi

  return 0
}

# Usage
RESPONSE=$(echo '{"id":100,"method":"Runtime.evaluate","params":{"expression":"2+2"}}' | websocat --one-message "$WS_URL")
if verify_cdp_response "$RESPONSE" "100"; then
  echo "✓ Command succeeded"
else
  exit 1
fi
```

### Retry with Exponential Backoff

```bash
retry_cdp_command() {
  local command="$1"
  local max_attempts=5
  local wait_time=1

  for attempt in $(seq 1 $max_attempts); do
    RESPONSE=$(echo "$command" | websocat --one-message "$WS_URL")

    if verify_cdp_response "$RESPONSE" "$(echo "$command" | jq -r '.id')"; then
      echo "$RESPONSE"
      return 0
    fi

    if [ $attempt -eq $max_attempts ]; then
      echo "ERROR: Command failed after $max_attempts attempts" >&2
      return 1
    fi

    echo "Retry $attempt failed, waiting ${wait_time}s..." >&2
    sleep $wait_time
    wait_time=$((wait_time * 2))
  done
}
```

## Additional Resources

- **Official CDP docs**: https://chromedevtools.github.io/devtools-protocol/
- **Electron debugging**: https://www.electronjs.org/docs/latest/tutorial/debugging-main-process
- **CDP Viewer**: https://chromedevtools.github.io/devtools-protocol/viewer/
