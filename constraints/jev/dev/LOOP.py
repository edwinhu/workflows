import re
from _common import _read, render_json
from _dev import SUBJECT, MAX_ITEMS, clip, is_test, added_lines, body

PROPOSITION = ('The change calls a model, an LLM API, route.ts or farm.sh once per item inside a loop over '
               'tasks, items, rows or files, instead of one batched call (one farm-out row set, one batch job).')

CRITERIA = {
    'VIOLATED': 'a model/route/farm call sits inside a per-item loop the change adds or edits',
    'SATISFIED': 'every model/route/farm call the change touches is made once, outside any per-item loop',
    'NOT_APPLICABLE': 'the change touches no model, route.ts or farm.sh call',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

LOOP_HEAD = re.compile(
    r'^\s*(for|while)\b|^\s*for\s*\(|\.(map|forEach|flatMap)\s*\(|^\s*async\s+for\b|xargs\b|\bparallel\b')
# A call, not a mention: a script path, an SDK method, an API host, or a CLI one-shot.
MODEL = re.compile(
    r'route\.ts|farm\.sh|farm-team\.sh|\bdecisionsCall\s*\(|messages\.create\s*\(|chat\.completions\.create|'
    r'generate_?[cC]ontent\s*\(|api\.openai\.com|api\.anthropic\.com|openrouter\.ai/api|'
    r'generativelanguage\.googleapis|aiplatform\.googleapis|claude\s+-p\b|codex\s+exec\b|agy\s+-p\b|/v1/(messages|chat)')


def evidence(files, plan_lines=None):
    loops, examined, n_calls, n_in_loops = [], [], 0, 0
    for rel, a in files:
        if is_test(rel):
            continue
        lines, added = _read(a), added_lines(a)
        if lines is None:
            continue
        examined.append(rel)
        model_lines = {i + 1 for i, t in enumerate(lines) if MODEL.search(t)}
        n_calls += len(model_lines)
        inside = set()
        for i, t in enumerate(lines):
            n = i + 1
            if not LOOP_HEAD.search(t):
                continue
            span = [n] + body(lines, n)
            calls = [k for k in span if k in model_lines]
            if not calls:
                continue
            touched = added is None or any(k in added for k in span)
            if not touched:
                continue
            inside.update(calls)
            loops.append({'file': rel, 'loop_line': n, 'loop': clip(t), 'loop_body_lines': len(span) - 1,
                          'calls_inside': [{'line': k, 'text': clip(lines[k - 1])} for k in calls[:8]]})
        n_in_loops += len(inside)
    inventory = {
        'files_examined': examined,
        'loops_containing_a_model_route_or_farm_call': loops[:MAX_ITEMS],
        'n_such_loops': len(loops),
        'n_model_route_farm_lines_in_changed_files': n_calls,
        'n_of_those_inside_a_changed_loop': n_in_loops,
    }
    return render_json('LOOP', files, inventory, [])
