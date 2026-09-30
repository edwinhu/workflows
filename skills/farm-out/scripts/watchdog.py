import sys, json, os, time, signal

pid = int(sys.argv[1])
log_file = sys.argv[2]
budget = float(sys.argv[3])
max_turns = int(sys.argv[4])

tokens = 0
turns = 0
seen = set()

# Wait for file to exist
for _ in range(50):
    if os.path.exists(log_file):
        break
    time.sleep(0.1)

try:
    f = open(log_file, "r")
except:
    print(json.dumps({"tokensW": 0, "budgetExceeded": False}))
    sys.exit(0)

exceeded = False
while True:
    line = f.readline()
    if not line:
        try:
            pid_status = os.waitpid(pid, os.WNOHANG)
            if pid_status != (0, 0):
                break
        except ChildProcessError:
            break
        time.sleep(0.1)
        continue
    try:
        msg = json.loads(line)
        if msg.get('type') == 'assistant':
            mid = msg.get('message', {}).get('id')
            if mid and mid not in seen:
                seen.add(mid)
                turns += 1
                usage = msg.get('message', {}).get('usage', {})
                input_t = usage.get('input_tokens', 0)
                cache_c_t = usage.get('cache_creation_input_tokens', 0)
                cache_r_t = usage.get('cache_read_input_tokens', 0)
                output_t = usage.get('output_tokens', 0)
                w = input_t + 1.25 * cache_c_t + 0.1 * cache_r_t + 5 * output_t
                tokens += w
                if budget > 0 and tokens > budget:
                    exceeded = True
                    break
                if max_turns > 0 and turns > max_turns:
                    exceeded = True
                    break
    except:
        pass

if exceeded:
    try:
        os.kill(pid, signal.SIGTERM)
        time.sleep(10)
        os.kill(pid, signal.SIGKILL)
    except:
        pass

print(json.dumps({"tokensW": tokens, "turns": turns, "budgetExceeded": exceeded}))
