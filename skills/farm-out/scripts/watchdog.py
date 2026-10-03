import sys, json, os, time, signal, subprocess

pid = int(sys.argv[1])
log_file = sys.argv[2]
budget = float(sys.argv[3])
max_turns = int(sys.argv[4])

# Weighted tokens of each assistant message, by id. stream-json repeats a message once per content
# block; the last copy carries its final usage, so a repeat replaces rather than adds.
weight = {}


def alive():
    # The child belongs to farm.sh's shell, not to us: os.waitpid raised ChildProcessError on the
    # first EOF, so every row ever recorded W=0 and neither cap could fire. Probe it instead, and
    # treat a zombie (exited, not yet reaped by farm.sh's `wait`) as gone.
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    try:
        with open(f"/proc/{pid}/stat") as fh:
            return fh.read().rsplit(")", 1)[1].split()[0] != "Z"
    except OSError:
        st = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout
        return bool(st.strip()) and not st.strip().startswith("Z")


def take(line):
    try:
        msg = json.loads(line)
    except ValueError:
        return
    if not isinstance(msg, dict) or msg.get("type") != "assistant":
        return
    m = msg.get("message") or {}
    mid = m.get("id")
    if not mid:
        return
    u = m.get("usage") or {}
    weight[mid] = (u.get("input_tokens", 0) + 1.25 * u.get("cache_creation_input_tokens", 0)
                   + 0.1 * u.get("cache_read_input_tokens", 0) + 5 * u.get("output_tokens", 0))


def over():
    return (budget > 0 and sum(weight.values()) > budget) or (max_turns > 0 and len(weight) > max_turns)


for _ in range(50):
    if os.path.exists(log_file):
        break
    time.sleep(0.1)

exceeded = False
try:
    f = open(log_file, "r")
except OSError:
    f = None
while f is not None:
    line = f.readline()
    if line:
        take(line)
        if over():
            exceeded = True
            break
        continue
    if not alive():
        # drain what the child wrote between the last read and its exit
        for line in f:
            take(line)
        break
    time.sleep(0.1)

if exceeded:
    try:
        os.kill(pid, signal.SIGTERM)
        for _ in range(100):
            if not alive():
                break
            time.sleep(0.1)
        else:
            os.kill(pid, signal.SIGKILL)
    except OSError:
        pass

tokens = sum(weight.values())
print(json.dumps({"tokensW": int(tokens) if tokens == int(tokens) else tokens,
                  "turns": len(weight), "budgetExceeded": exceeded}))
