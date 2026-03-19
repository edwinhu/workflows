# Electron-Specific CDP Features

Advanced patterns for testing Electron main process, IPC, and native APIs.

## Electron Architecture

<EXTREMELY-IMPORTANT>
**Electron has TWO separate processes that MUST both be tested:**

| Process | Runtime | Responsibilities | Testing Method |
|---------|---------|------------------|----------------|
| **Main** | Node.js | App lifecycle, native APIs, file I/O, menus, dialogs, system integration | Main process CDP OR IPC from renderer |
| **Renderer** | Chromium | Web content, DOM, UI, frontend logic | Standard CDP (Page, DOM, Runtime) |

**CRITICAL:** Renderer-only testing misses:
- Main process crashes
- IPC communication failures
- Native dialog bugs
- File system operation errors
- Menu item regressions

**Both processes must be verified in E2E tests.**
</EXTREMELY-IMPORTANT>

## Main Process Debugging

### Enable Main Process Debugging

Some Electron apps expose main process for debugging:

```bash
# Option 1: Electron flag (if supported by app)
/path/to/app --inspect=5858

# Option 2: Node.js environment variable
NODE_OPTIONS="--inspect=5858" /path/to/app

# Option 3: Combined (recommended)
NODE_OPTIONS="--inspect=5858" /path/to/app --remote-debugging-port=9222
```

**Check if main process is debuggable:**
```bash
# List all CDP targets
curl -s http://localhost:9222/json/list | jq '.'

# Filter for main process (type == "node")
curl -s http://localhost:9222/json/list | jq '.[] | select(.type == "node")'
```

**Example response:**
```json
{
  "description": "node.js instance",
  "devtoolsFrontendUrl": "devtools://devtools/bundled/inspector.html?...&ws=localhost:5858/...",
  "id": "main-process-id",
  "title": "Electron Main Process",
  "type": "node",
  "url": "file:///app/main.js",
  "webSocketDebuggerUrl": "ws://localhost:5858/..."
}
```

### Connect to Main Process

```bash
# Get main process WebSocket URL
MAIN_WS=$(curl -s http://localhost:9222/json/list | jq -r '.[] | select(.type == "node") | .webSocketDebuggerUrl')

if [ -z "$MAIN_WS" ]; then
  echo "ERROR: Main process not debuggable"
  echo "Restart app with: NODE_OPTIONS=\"--inspect=5858\" /path/to/app"
  exit 1
fi

echo "Main process WebSocket: $MAIN_WS"

# Execute Node.js code in main process
echo '{"id":1,"method":"Runtime.evaluate","params":{"expression":"process.version"}}' | websocat --one-message "$MAIN_WS"
```

### Execute Node.js in Main Process

```bash
# Check Node.js version
SCRIPT='process.version'
echo "{\"id\":1,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$SCRIPT\",\"returnByValue\":true}}" | websocat --one-message "$MAIN_WS"

# List loaded modules
SCRIPT='Object.keys(require.cache).join(", ")'
echo "{\"id\":2,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$SCRIPT\",\"returnByValue\":true}}" | websocat --one-message "$MAIN_WS"

# Read file from main process
SCRIPT='require("fs").readFileSync("/app/config.json", "utf8")'
echo "{\"id\":3,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$SCRIPT\",\"returnByValue\":true}}" | websocat --one-message "$MAIN_WS"

# Get app metadata
SCRIPT='require("electron").app.getVersion()'
echo "{\"id\":4,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$SCRIPT\",\"returnByValue\":true}}" | websocat --one-message "$MAIN_WS"
```

## IPC (Inter-Process Communication)

### Testing IPC from Renderer to Main

**Pattern: Renderer sends IPC → Main handles → Renderer receives response**

```bash
#!/bin/bash
# Connect to renderer process
WS_URL=$(curl -s http://localhost:9222/json/list | jq -r '.[0].webSocketDebuggerUrl')

# Enable Runtime domain
echo '{"id":1,"method":"Runtime.enable"}' | websocat --one-message "$WS_URL"

# Send IPC from renderer to main
IPC_SEND='require("electron").ipcRenderer.send("test-channel", {data: "test"})'
RESPONSE=$(echo "{\"id\":2,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$IPC_SEND\"}}" | websocat --one-message "$WS_URL")

# Verify IPC was sent (no exception)
if echo "$RESPONSE" | jq -e '.result.exceptionDetails' > /dev/null; then
  echo "✗ FAILED: Could not send IPC message"
  echo "$RESPONSE" | jq '.result.exceptionDetails'
  exit 1
fi

echo "✓ IPC message sent to main process"

# Wait for main process to respond (if using ipcRenderer.on)
sleep 1

# Check if response received (example: sets window.ipcResponse)
CHECK_RESPONSE='window.ipcResponse'
VERIFY=$(echo "{\"id\":3,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$CHECK_RESPONSE\",\"returnByValue\":true}}" | websocat --one-message "$WS_URL")

RESULT=$(echo "$VERIFY" | jq -r '.result.result.value')
echo "✓ IPC response: $RESULT"
```

### Testing IPC invoke/handle Pattern

Modern Electron uses `ipcRenderer.invoke` / `ipcMain.handle`:

```bash
# Invoke IPC from renderer (returns promise)
IPC_INVOKE='await require("electron").ipcRenderer.invoke("get-user-data")'

# Must use awaitPromise to wait for async result
RESPONSE=$(echo "{\"id\":10,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$IPC_INVOKE\",\"awaitPromise\":true,\"returnByValue\":true}}" | websocat --one-message "$WS_URL")

# Verify response
if echo "$RESPONSE" | jq -e '.result.exceptionDetails' > /dev/null; then
  echo "✗ FAILED: IPC invoke error"
  echo "$RESPONSE" | jq '.result.exceptionDetails.text'
  exit 1
fi

USER_DATA=$(echo "$RESPONSE" | jq -r '.result.result.value')
echo "✓ IPC invoke succeeded: $USER_DATA"
```

### IPC Event Listeners

Set up IPC listener and verify events are received:

```bash
# Set up IPC listener in renderer
SETUP_LISTENER='
window.ipcMessages = [];
require("electron").ipcRenderer.on("notification", (event, data) => {
  window.ipcMessages.push(data);
});
'

echo "{\"id\":20,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":$(echo "$SETUP_LISTENER" | jq -Rs .)}}" | websocat --one-message "$WS_URL"

# Trigger action that should cause main to send IPC
# (e.g., click button, wait for background process)
sleep 2

# Check if IPC messages were received
CHECK_MESSAGES='window.ipcMessages.length'
RESPONSE=$(echo "{\"id\":21,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$CHECK_MESSAGES\",\"returnByValue\":true}}" | websocat --one-message "$WS_URL")

COUNT=$(echo "$RESPONSE" | jq -r '.result.result.value')
if [ "$COUNT" -eq 0 ]; then
  echo "✗ FAILED: No IPC messages received"
  exit 1
fi

echo "✓ Received $COUNT IPC messages"

# Get message content
GET_MESSAGES='JSON.stringify(window.ipcMessages)'
MESSAGES=$(echo "{\"id\":22,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$GET_MESSAGES\",\"returnByValue\":true}}" | websocat --one-message "$WS_URL" | jq -r '.result.result.value')
echo "Messages: $MESSAGES"
```

## Native Dialogs

### File Open Dialog

```bash
# Trigger file dialog from renderer
OPEN_DIALOG='require("electron").ipcRenderer.invoke("open-file-dialog")'

# Note: This will show a real native dialog
# For automated testing, mock the dialog in main process
RESPONSE=$(echo "{\"id\":30,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$OPEN_DIALOG\",\"awaitPromise\":true,\"returnByValue\":true}}" | websocat --one-message "$WS_URL")

# Main process should return selected file path
FILE_PATH=$(echo "$RESPONSE" | jq -r '.result.result.value')
echo "✓ Selected file: $FILE_PATH"
```

**Main process handler (for reference):**
```javascript
// main.js
const { ipcMain, dialog } = require('electron');

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile']
  });
  return result.filePaths[0];
});
```

**For automated testing, mock dialogs:**
```javascript
// Test mode: skip dialog, return fixed path
ipcMain.handle('open-file-dialog', async () => {
  if (process.env.TEST_MODE) {
    return '/tmp/test-file.txt';
  }
  // Real dialog for manual testing
  const result = await dialog.showOpenDialog({...});
  return result.filePaths[0];
});
```

### Message Box Dialog

```bash
# Show message box from main process
MESSAGE_BOX='require("electron").ipcRenderer.invoke("show-message", "Test completed successfully")'

RESPONSE=$(echo "{\"id\":31,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$MESSAGE_BOX\",\"awaitPromise\":true,\"returnByValue\":true}}" | websocat --one-message "$WS_URL")

# Response contains button clicked
BUTTON=$(echo "$RESPONSE" | jq -r '.result.result.value')
echo "✓ User clicked button: $BUTTON"
```

## Native Menus

### Trigger Menu Item

```bash
# Click menu item via IPC
CLICK_MENU='require("electron").ipcRenderer.send("menu-item-clicked", "File:Save")'

echo "{\"id\":40,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$CLICK_MENU\"}}" | websocat --one-message "$WS_URL"

# Wait for menu action to complete
sleep 1

# Verify result (e.g., file was saved)
CHECK_SAVED='window.fileSaved === true'
VERIFY=$(echo "{\"id\":41,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$CHECK_SAVED\",\"returnByValue\":true}}" | websocat --one-message "$WS_URL")

IS_SAVED=$(echo "$VERIFY" | jq -r '.result.result.value')
if [ "$IS_SAVED" != "true" ]; then
  echo "✗ FAILED: File not saved after menu click"
  exit 1
fi

echo "✓ Menu action verified: File saved"
```

**Main process menu setup (for reference):**
```javascript
// main.js
const { Menu } = require('electron');

const template = [
  {
    label: 'File',
    submenu: [
      {
        label: 'Save',
        accelerator: 'CmdOrCtrl+S',
        click: () => {
          // Send IPC to renderer to trigger save
          mainWindow.webContents.send('menu-save');
        }
      }
    ]
  }
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);
```

### Keyboard Accelerators

```bash
# Trigger menu via keyboard shortcut
# Use Input.dispatchKeyEvent to simulate Cmd+S or Ctrl+S

# macOS: Cmd+S
echo '{"id":42,"method":"Input.dispatchKeyEvent","params":{"type":"keyDown","key":"s","code":"KeyS","modifiers":4}}' | websocat --one-message "$WS_URL"
echo '{"id":43,"method":"Input.dispatchKeyEvent","params":{"type":"keyUp","key":"s","code":"KeyS","modifiers":4}}' | websocat --one-message "$WS_URL"

# Wait for action
sleep 1

# Verify save action occurred
# (same verification as above)
```

## BrowserWindow Control

### Get All Windows

```bash
# From main process: get all BrowserWindow instances
GET_WINDOWS='
const { BrowserWindow } = require("electron");
const windows = BrowserWindow.getAllWindows();
windows.map(w => ({ id: w.id, title: w.getTitle(), url: w.webContents.getURL() }))
'

RESPONSE=$(echo "{\"id\":50,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":$(echo "$GET_WINDOWS" | jq -Rs .),\"returnByValue\":true}}" | websocat --one-message "$MAIN_WS")

WINDOWS=$(echo "$RESPONSE" | jq -r '.result.result.value')
echo "Windows: $WINDOWS"
```

### Create New Window from Main

```bash
# Create new BrowserWindow from main process
CREATE_WINDOW='
const { BrowserWindow } = require("electron");
const win = new BrowserWindow({ width: 800, height: 600 });
win.loadFile("/app/settings.html");
win.id
'

RESPONSE=$(echo "{\"id\":51,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":$(echo "$CREATE_WINDOW" | jq -Rs .),\"returnByValue\":true}}" | websocat --one-message "$MAIN_WS")

WINDOW_ID=$(echo "$RESPONSE" | jq -r '.result.result.value')
echo "✓ Created window ID: $WINDOW_ID"

# Now find the new window's CDP target
sleep 1
NEW_WINDOW_WS=$(curl -s http://localhost:9222/json/list | jq -r ".[] | select(.url | contains(\"settings.html\")) | .webSocketDebuggerUrl")

echo "New window WebSocket: $NEW_WINDOW_WS"

# Automate the new window
echo '{"id":1,"method":"Runtime.enable"}' | websocat --one-message "$NEW_WINDOW_WS"
echo '{"id":2,"method":"Runtime.evaluate","params":{"expression":"document.title"}}' | websocat --one-message "$NEW_WINDOW_WS"
```

### Close Window

```bash
# Close window from main process
CLOSE_WINDOW="
const { BrowserWindow } = require('electron');
const win = BrowserWindow.fromId($WINDOW_ID);
if (win) win.close();
"

echo "{\"id\":52,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":$(echo "$CLOSE_WINDOW" | jq -Rs .)}}" | websocat --one-message "$MAIN_WS"
```

## WebContents Methods

### Execute JavaScript in WebContents

From main process, execute JavaScript in any renderer:

```bash
# Execute in specific window's renderer
EXECUTE_IN_RENDERER='
const { BrowserWindow } = require("electron");
const win = BrowserWindow.fromId(1);
win.webContents.executeJavaScript("document.title");
'

# Note: Returns a Promise
RESPONSE=$(echo "{\"id\":60,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":$(echo "$EXECUTE_IN_RENDERER" | jq -Rs .),\"awaitPromise\":true,\"returnByValue\":true}}" | websocat --one-message "$MAIN_WS")

TITLE=$(echo "$RESPONSE" | jq -r '.result.result.value')
echo "✓ Renderer title: $TITLE"
```

### Open DevTools Programmatically

```bash
# Open DevTools for debugging
OPEN_DEVTOOLS='
const { BrowserWindow } = require("electron");
const win = BrowserWindow.getFocusedWindow();
win.webContents.openDevTools();
'

echo "{\"id\":61,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":$(echo "$OPEN_DEVTOOLS" | jq -Rs .)}}" | websocat --one-message "$MAIN_WS"

echo "✓ DevTools opened"
```

### Get WebContents Console Logs

From main process, monitor renderer console:

```bash
# Set up console log listener in main process
SETUP_CONSOLE_LISTENER='
const { BrowserWindow } = require("electron");
const win = BrowserWindow.fromId(1);
global.consoleLogs = [];
win.webContents.on("console-message", (event, level, message) => {
  global.consoleLogs.push({ level, message });
});
'

echo "{\"id\":62,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":$(echo "$SETUP_CONSOLE_LISTENER" | jq -Rs .)}}" | websocat --one-message "$MAIN_WS"

# Wait for logs to accumulate
sleep 2

# Retrieve logs
GET_LOGS='JSON.stringify(global.consoleLogs || [])'
RESPONSE=$(echo "{\"id\":63,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$GET_LOGS\",\"returnByValue\":true}}" | websocat --one-message "$MAIN_WS")

LOGS=$(echo "$RESPONSE" | jq -r '.result.result.value')
echo "Console logs: $LOGS"
```

## Session and Cookies

### Get Cookies

```bash
# Get all cookies from main process
GET_COOKIES='
const { session } = require("electron");
session.defaultSession.cookies.get({})
'

RESPONSE=$(echo "{\"id\":70,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":$(echo "$GET_COOKIES" | jq -Rs .),\"awaitPromise\":true,\"returnByValue\":true}}" | websocat --one-message "$MAIN_WS")

COOKIES=$(echo "$RESPONSE" | jq -r '.result.result.value')
echo "Cookies: $COOKIES"
```

### Set Cookie

```bash
# Set cookie from main process
SET_COOKIE='
const { session } = require("electron");
session.defaultSession.cookies.set({
  url: "https://example.com",
  name: "test-cookie",
  value: "test-value"
})
'

RESPONSE=$(echo "{\"id\":71,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":$(echo "$SET_COOKIE" | jq -Rs .),\"awaitPromise\":true}}" | websocat --one-message "$MAIN_WS")

echo "✓ Cookie set"
```

### Clear Storage

```bash
# Clear all storage from main process
CLEAR_STORAGE='
const { session } = require("electron");
session.defaultSession.clearStorageData()
'

RESPONSE=$(echo "{\"id\":72,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":$(echo "$CLEAR_STORAGE" | jq -Rs .),\"awaitPromise\":true}}" | websocat --one-message "$MAIN_WS")

echo "✓ Storage cleared"
```

## App Lifecycle

### Get App Info

```bash
# Get app metadata from main process
GET_APP_INFO='
const { app } = require("electron");
({
  version: app.getVersion(),
  name: app.getName(),
  path: app.getAppPath(),
  userData: app.getPath("userData"),
  isReady: app.isReady()
})
'

RESPONSE=$(echo "{\"id\":80,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":$(echo "$GET_APP_INFO" | jq -Rs .),\"returnByValue\":true}}" | websocat --one-message "$MAIN_WS")

APP_INFO=$(echo "$RESPONSE" | jq -r '.result.result.value')
echo "App info: $APP_INFO"
```

### Quit Application

```bash
# Quit app gracefully from main process
QUIT_APP='require("electron").app.quit()'

echo "{\"id\":81,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$QUIT_APP\"}}" | websocat --one-message "$MAIN_WS"

echo "✓ App quit command sent"
```

## Complete Multi-Process Test Example

```bash
#!/bin/bash
set -e

# Launch Electron with both main and renderer debugging
NODE_OPTIONS="--inspect=5858" /path/to/app --remote-debugging-port=9222 --enable-logging --log-file=/tmp/electron.log 2>&1 &
APP_PID=$!

# Wait for startup
sleep 3

# Get main process WebSocket
MAIN_WS=$(curl -s http://localhost:9222/json/list | jq -r '.[] | select(.type == "node") | .webSocketDebuggerUrl')
if [ -z "$MAIN_WS" ]; then
  echo "ERROR: Main process not available"
  exit 1
fi

# Get renderer process WebSocket
RENDERER_WS=$(curl -s http://localhost:9222/json/list | jq -r '.[] | select(.type == "page") | .webSocketDebuggerUrl')
if [ -z "$RENDERER_WS" ]; then
  echo "ERROR: Renderer process not available"
  exit 1
fi

echo "✓ Connected to main and renderer processes"

# TEST 1: Main process - Read file
READ_FILE='require("fs").readFileSync("/app/config.json", "utf8")'
RESPONSE=$(echo "{\"id\":1,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$READ_FILE\",\"returnByValue\":true}}" | websocat --one-message "$MAIN_WS")

if echo "$RESPONSE" | jq -e '.result.exceptionDetails' > /dev/null; then
  echo "✗ TEST 1 FAILED: Could not read config"
  exit 1
fi

CONFIG=$(echo "$RESPONSE" | jq -r '.result.result.value')
echo "✓ TEST 1 PASSED: Read config from main process"

# TEST 2: Renderer process - Check DOM
echo '{"id":1,"method":"Runtime.enable"}' | websocat --one-message "$RENDERER_WS"

CHECK_DOM='document.querySelector("#app") !== null'
RESPONSE=$(echo "{\"id\":2,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$CHECK_DOM\",\"returnByValue\":true}}" | websocat --one-message "$RENDERER_WS")

IS_PRESENT=$(echo "$RESPONSE" | jq -r '.result.result.value')
if [ "$IS_PRESENT" != "true" ]; then
  echo "✗ TEST 2 FAILED: #app element not found"
  exit 1
fi

echo "✓ TEST 2 PASSED: DOM element present"

# TEST 3: IPC Communication
SEND_IPC='require("electron").ipcRenderer.invoke("test-ipc", "hello")'
RESPONSE=$(echo "{\"id\":3,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"$SEND_IPC\",\"awaitPromise\":true,\"returnByValue\":true}}" | websocat --one-message "$RENDERER_WS")

if echo "$RESPONSE" | jq -e '.result.exceptionDetails' > /dev/null; then
  echo "✗ TEST 3 FAILED: IPC invoke failed"
  exit 1
fi

IPC_RESULT=$(echo "$RESPONSE" | jq -r '.result.result.value')
echo "✓ TEST 3 PASSED: IPC communication works (result: $IPC_RESULT)"

# Cleanup
kill $APP_PID

echo "✓ ALL TESTS PASSED"
```

## Testing Patterns

### Pattern 1: Renderer → Main → Renderer

Test full round-trip IPC:

1. Renderer sends IPC to main
2. Main processes request
3. Main sends response back to renderer
4. Verify response received in renderer

### Pattern 2: Main Process State Verification

After renderer actions, verify main process state:

1. User clicks button in renderer
2. Renderer sends IPC to main
3. Main updates internal state
4. Verify main process state via CDP

### Pattern 3: Multi-Window Coordination

Test window communication:

1. Open secondary window from main
2. Send data between windows via main process
3. Verify both windows receive updates

## Troubleshooting

### Main Process Not Debuggable

**Symptom:** `curl http://localhost:9222/json/list` shows no `type: "node"` target

**Solutions:**
1. Restart app with `NODE_OPTIONS="--inspect=5858"`
2. Check if app supports `--inspect` flag
3. Some apps require build-time flag: `enableRemoteModule: true`

### IPC Not Working

**Symptom:** `ipcRenderer.invoke` throws error

**Check:**
1. Is `contextIsolation` enabled? (May need preload script)
2. Is `nodeIntegration` disabled? (May need preload script)
3. Is main process handler registered? (`ipcMain.handle`)

**Preload script pattern:**
```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, data) => ipcRenderer.invoke(channel, data)
});
```

Then from renderer:
```javascript
window.electronAPI.invoke('test-channel', data)
```

### WebSocket Connection Drops

**Symptom:** WebSocket closes unexpectedly

**Solutions:**
1. Keep connection alive with ping/pong
2. Use `websocat --ping-interval 30`
3. Reconnect on disconnect with retry logic

## Additional Resources

- **Electron IPC docs**: https://www.electronjs.org/docs/latest/tutorial/ipc
- **Electron debugging**: https://www.electronjs.org/docs/latest/tutorial/debugging-main-process
- **Context isolation**: https://www.electronjs.org/docs/latest/tutorial/context-isolation
