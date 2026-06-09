# The Iron Law of Logging

<EXTREMELY-IMPORTANT>
**ALL CODE MUST USE FILE-BASED LOGGING. This is absolute.**

Every application, service, script, or test runner you write MUST write logs to a file:

- ✅ CLI apps: `./app > /tmp/app.log 2>&1 &`
- ✅ GUI apps: `./app --log-file=/tmp/app.log 2>&1 &`
- ✅ Web servers: `npm start > /tmp/server.log 2>&1 &`
- ✅ Test runners: `pytest -v > /tmp/test.log 2>&1`
- ✅ Build scripts: `./build.sh 2>&1 | tee /tmp/build.log`

**Why file-based logging is mandatory:**

| Without File Logs | With File Logs |
|-------------------|----------------|
| stdout disappears → can't verify | Permanent record → can read anytime |
| stderr lost → can't debug | Errors captured → can diagnose |
| "It worked" = no proof | Log file = proof of execution |
| Can't review after the fact | Can read logs later |
| No GATE 5 possible | GATE 5 enforces reading them |
</EXTREMELY-IMPORTANT>

## Logging Facts

- `2>&1 | tee /tmp/app.log` captures output from any program, including ones with no `--log-file` flag — "the app doesn't support logging" never exempts a launch from file logging.
- Terminal output is ephemeral: once it scrolls past, no GATE 5 read is possible. High-volume output is an argument FOR file logs, not against — GATE 5 reads the file; nothing requires printing it.

## Log File Verification Pattern

After launching any code, verify the log file was created:

```bash
# Launch with logging
./app > /tmp/app.log 2>&1 &
APP_PID=$!
sleep 2

# VERIFY LOG FILE EXISTS AND HAS CONTENT
if [ ! -f /tmp/app.log ]; then
    echo "FAIL: Log file not created"
    echo "Did you redirect stdout/stderr to a file?"
    exit 1
fi

if [ ! -s /tmp/app.log ]; then
    echo "FAIL: Log file empty (no output written)"
    exit 1
fi

echo "✓ Log file exists and has content"
```

**Tool description:** Verify log file exists and has content after launch

<EXTREMELY-IMPORTANT>
When you claim "code executed" or "tests ran", you are asserting:
- You created a log file
- You verified the log file exists
- You READ the full log file
- You confirmed what happened from the logs

Claiming any of this without the log file you actually read is an unverified claim presented as fact — a form of dishonesty. "I saw it in terminal" is not verification.
</EXTREMELY-IMPORTANT>
