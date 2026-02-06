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

## Rationalization Prevention (Logging)

| Excuse | Reality |
|--------|---------|
| "Stdout is enough" | Stdout disappears. You need a file to READ. |
| "I can see the output" | You can't see it after it scrolls by. FILE LOGS. |
| "App doesn't support --log-file" | Use `2>&1 \| tee /tmp/app.log` instead. |
| "Logs aren't necessary for simple scripts" | Simple scripts still need verification. ALWAYS log to file. |
| "I'll just look at the terminal" | Terminal output is ephemeral. FILE-BASED ONLY. |
| "stderr is good enough" | stderr isn't a file you can `cat`. Use file logs. |
| "Too much output to log" | That's why you READ the logs (GATE 5), not print them. |

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

## The Honesty Requirement (Logging)

<EXTREMELY-IMPORTANT>
**Running code without file-based logging is LYING about verification.**

When you claim "code executed" or "tests ran", you are asserting:
- You created a log file
- You verified the log file exists
- You READ the full log file
- You confirmed what happened from the logs

Running without file logs means you have NO EVIDENCE of what happened.

**"I saw it in terminal" is not verification. File-based logs are mandatory.**
</EXTREMELY-IMPORTANT>
