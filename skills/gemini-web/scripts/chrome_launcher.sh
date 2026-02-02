#!/bin/bash
# Chrome launcher for browser automation
# Usage: ./chrome_launcher.sh {start|stop|status|restart}
#
# Manages a Chrome instance with remote debugging for CDP automation.
# Browser data stored in ~/.browser-automation/ to persist logins.

set -e

CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
USER_DATA_DIR="$HOME/.browser-automation"
PID_FILE="$USER_DATA_DIR/.chrome.pid"
PORT=9222
AEROSPACE="${HOME}/.nix-profile/bin/aerospace"
SCRATCHPAD_WORKSPACE="S"

# Create data directory if needed
mkdir -p "$USER_DATA_DIR"

is_running() {
    curl -s "http://localhost:$PORT/json/version" > /dev/null 2>&1
}

start() {
    if is_running; then
        echo "Chrome already running on port $PORT"
        return 0
    fi

    # Verify Chrome binary exists
    if [ ! -f "$CHROME_BIN" ]; then
        echo "Error: Chrome not found at $CHROME_BIN"
        return 1
    fi

    echo "Starting Chrome with remote debugging on port $PORT..."
    echo "Browser data: $USER_DATA_DIR"

    # Run headed (not headless) to avoid bot detection
    # Position window off-screen so it doesn't interfere
    "$CHROME_BIN" \
        --remote-debugging-port=$PORT \
        --user-data-dir="$USER_DATA_DIR" \
        --window-position=-2000,-2000 \
        --window-size=1280,800 \
        --no-first-run \
        --disable-background-networking \
        --disable-sync \
        > /dev/null 2>&1 &

    echo $! > "$PID_FILE"

    # Wait for Chrome to be ready (up to 30 seconds)
    echo "Waiting for Chrome to be ready..."
    for i in {1..30}; do
        if is_running; then
            echo "Chrome started successfully (PID $(cat "$PID_FILE"))"
            # Move Chrome window to scratchpad workspace if aerospace available
            if [ -x "$AEROSPACE" ]; then
                sleep 1
                CHROME_WINDOW=$("$AEROSPACE" list-windows --all 2>/dev/null | grep -i "Google Chrome" | head -1 | awk '{print $1}')
                if [ -n "$CHROME_WINDOW" ]; then
                    "$AEROSPACE" move-node-to-workspace --window-id "$CHROME_WINDOW" "$SCRATCHPAD_WORKSPACE" 2>/dev/null || true
                    echo "Moved Chrome to workspace $SCRATCHPAD_WORKSPACE"
                fi
            fi
            return 0
        fi
        sleep 1
    done

    echo "Error: Chrome failed to start within 30 seconds"
    rm -f "$PID_FILE"
    return 1
}

stop() {
    local stopped=0

    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            echo "Stopping Chrome (PID $PID)..."
            kill "$PID" 2>/dev/null || true
            stopped=1
        fi
        rm -f "$PID_FILE"
    fi

    # Fallback: kill by port if still running
    if is_running; then
        PID=$(lsof -ti :$PORT 2>/dev/null || true)
        if [ -n "$PID" ]; then
            echo "Stopping Chrome on port $PORT (PID $PID)..."
            kill $PID 2>/dev/null || true
            stopped=1
        fi
    fi

    for i in {1..10}; do
        if ! is_running; then
            echo "Chrome stopped"
            return 0
        fi
        sleep 1
    done

    if [ $stopped -eq 0 ]; then
        echo "Chrome was not running"
    else
        echo "Warning: Chrome may still be stopping"
    fi
    return 0
}

status() {
    if is_running; then
        echo "Chrome is running on port $PORT"
        echo "Browser data: $USER_DATA_DIR"
        echo ""
        echo "Version info:"
        curl -s "http://localhost:$PORT/json/version" | grep -E '"Browser"|"V8-Version"' | head -2
        if [ -f "$PID_FILE" ]; then
            echo ""
            echo "PID: $(cat "$PID_FILE")"
        fi
        return 0
    else
        echo "Chrome is not running"
        return 1
    fi
}

restart() {
    stop
    sleep 2
    start
}

case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    status)
        status
        ;;
    restart)
        restart
        ;;
    *)
        echo "Usage: $0 {start|stop|status|restart}"
        echo ""
        echo "Commands:"
        echo "  start   - Start Chrome with remote debugging on port $PORT"
        echo "  stop    - Stop Chrome"
        echo "  status  - Check if Chrome is running"
        echo "  restart - Stop and start Chrome"
        echo ""
        echo "Browser data stored in: $USER_DATA_DIR"
        exit 1
        ;;
esac
