---
name: exit
description: Exit dev mode and disable the main chat sandbox for this session.
---

# Exit Dev Mode

Deactivating dev mode sandbox for this session.

```bash
python3 -c "
import os, hashlib
tty = os.environ.get('TTY', '')
cwd = os.getcwd()
sid = hashlib.md5(f'{tty}:{cwd}'.encode()).hexdigest()[:12]
for prefix in ['dev-mode', 'skill-gate', 'ralph']:
    try:
        os.remove(f'/tmp/.claude-{prefix}-{sid}')
    except FileNotFoundError:
        pass
    except:
        pass
print(f'Dev mode deactivated for session {sid}')
"
```

You can now use Bash, Edit, and Write tools directly from main chat.
