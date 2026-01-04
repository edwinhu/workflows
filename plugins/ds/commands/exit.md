---
name: exit
description: Exit data science mode and disable the main chat sandbox for this session.
---

# Exit Data Science Mode

Deactivating sandbox for this session.

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
print(f'Data science mode deactivated for session {sid}')
"
```

You can now use Bash, Edit, and Write tools directly from main chat.
