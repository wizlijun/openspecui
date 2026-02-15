"""
Auto Fix shared logic — pure functions extracted for testability.

These functions mirror the TS implementations in:
  - app/src/checkboxUtils.ts (parseCheckboxItems, filterP0P1Items)
  - app/src/autoFixStateMachine.ts (decideAutoFixNext)
  - app/src/CodexWorkerBase.tsx (isCodexTurnComplete, extractCodexFinalMessage)

IMPORTANT: When modifying logic here, update the TS counterparts too (and vice versa).
"""

import re


# ─── Checkbox Parsing (mirrors checkboxUtils.ts) ────────────────────

def parse_checkbox_items(text: str, trigger_to_skip: str | None = None):
    """Parse markdown text to extract checkbox items.
    
    Returns dict with:
        - items: list of {'text': str, 'checked': bool}
        - context_lines: list of non-checkbox text lines
    
    Mirrors: app/src/checkboxUtils.ts → parseCheckboxItems
    """
    items = []
    context_lines = []
    in_code_block = False

    for line in text.split('\n'):
        if line.strip().startswith('```'):
            in_code_block = not in_code_block
            continue
        if in_code_block:
            continue
        if trigger_to_skip and line.strip().lower().startswith(trigger_to_skip.lower()):
            continue

        unchecked = re.match(r'^(\s*)-\s\[\s\]\s(.+)$', line)
        checked = re.match(r'^(\s*)-\s\[x\]\s(.+)$', line, re.IGNORECASE)

        if unchecked:
            items.append({'text': unchecked.group(2).strip(), 'checked': False})
        elif checked:
            items.append({'text': checked.group(2).strip(), 'checked': True})
        elif line.strip():
            context_lines.append(line)

    return {'items': items, 'context_lines': context_lines}


def filter_p0p1_items(items: list[dict]) -> list[dict]:
    """Filter checkbox items to only include P0 and P1 priority items.
    
    Mirrors: app/src/checkboxUtils.ts → filterP0P1Items
    """
    result = []
    for item in items:
        stripped = re.sub(r'^[\s*_\[\]]+', '', item['text'].strip()).upper()
        if re.search(r'\bP[01]\b', stripped):
            result.append(item)
    return result


# ─── Codex Turn Detection (mirrors CodexWorkerBase.tsx) ─────────────

def _normalize_event_token(value) -> str:
    """Normalize an event value to a lowercase hyphen-separated token.
    
    Mirrors: app/src/CodexWorkerBase.tsx → normalizeEventToken
    """
    return re.sub(r'[/_\s]+', '-', str(value or '').strip().lower())


def is_codex_turn_complete(data: dict) -> bool:
    """Check if a codex event indicates turn completion.
    
    Mirrors: app/src/CodexWorkerBase.tsx → isCodexTurnComplete
    """
    if data.get('codex_is_done') is True:
        return True

    done_tokens = {
        'agent-turn-complete', 'agent-turn-completed', 'agent-turn-done',
        'turn-complete', 'turn-completed', 'turn-done',
        'item-complete', 'item-completed',
        'session-complete', 'session-completed',
        'response-complete', 'response-completed', 'response-done',
        'message-complete', 'message-completed', 'message-done',
        'completion', 'completed', 'done', 'finished', 'stop', 'stopped',
    }

    event_candidates = [
        data.get('codex_event_type'), data.get('event_type'), data.get('type'),
        data.get('hook_event_name'),
    ]
    payload = data.get('payload', {})
    if isinstance(payload, dict):
        event_candidates.extend([
            payload.get('type'), payload.get('event_type'),
            payload.get('hook_event_name'), payload.get('event'),
        ])

    for candidate in event_candidates:
        raw = str(candidate or '').strip().lower()
        if raw.endswith('/complete') or raw.endswith('/completed') or raw.endswith('/done') or raw.endswith('/finished'):
            return True
        token = _normalize_event_token(candidate)
        if not token:
            continue
        if token in done_tokens or token.endswith('-complete') or token.endswith('-completed') or token.endswith('-done') or token.endswith('-finished'):
            return True

    status_candidates = [data.get('status')]
    if isinstance(payload, dict):
        status_candidates.append(payload.get('status'))
    for status in status_candidates:
        token = _normalize_event_token(status)
        if token in ('complete', 'completed', 'done', 'finished', 'stopped', 'success', 'ok'):
            return True

    return bool(data.get('done') or data.get('complete') or
                (isinstance(payload, dict) and (payload.get('done') or payload.get('complete'))))


def extract_codex_final_message(data: dict) -> str | None:
    """Extract the final assistant message from a codex event.
    
    Mirrors: app/src/CodexWorkerBase.tsx → extractCodexFinalMessage
    """
    key_paths = [
        ('payload', 'last-assistant-message'),
        ('payload', 'last_assistant_message'),
        ('last-assistant-message',),
        ('last_assistant_message',),
        ('payload', 'last_result'),
        ('last_result',),
    ]
    for key_path in key_paths:
        obj = data
        for k in key_path:
            if isinstance(obj, dict):
                obj = obj.get(k)
            else:
                obj = None
                break
        if isinstance(obj, str) and obj.strip():
            return obj
    return None


# ─── Auto Fix Decision (mirrors autoFixStateMachine.ts) ─────────────

def detect_scenario(text: str, scenarios: dict) -> str:
    """Detect which scenario to use based on the message text.
    
    Returns the scenario key (e.g., 'review_confirm', 'default').
    Mirrors: app/src/loadConfirmationCardConfig.ts → detectScenario
    """
    # Check each scenario's trigger pattern
    for key, scenario in scenarios.items():
        if key == 'default':
            continue  # Skip default, it's the fallback
        
        trigger = scenario.get('trigger')
        if trigger:
            # Simple case-insensitive prefix match
            if text.strip().lower().startswith(trigger.lower()):
                return key
    
    # Fallback to default
    return 'default'


def decide_autofix_next(review_text: str, cycle_count: int, max_cycles: int,
                        scenarios: dict):
    """Decide the next Auto Fix action given a review result.
    
    Returns dict with:
        - action: 'continue' | 'complete' | 'stop'
        - reason: (for 'stop') 'no_scenario_match' | 'zero_checkboxes' | 'max_cycles'
        - items: (for 'continue') list of P0/P1 item texts
        - cycle_count: current cycle count
    
    Mirrors: app/src/autoFixStateMachine.ts → decideAutoFixNext
    """
    # Detect scenario
    scenario_key = detect_scenario(review_text, scenarios)
    
    if scenario_key == 'default':
        return {'action': 'stop', 'reason': 'no_scenario_match', 'cycle_count': cycle_count}
    
    scenario = scenarios[scenario_key]
    trigger = scenario.get('trigger')
    
    # Parse checkboxes
    parsed = parse_checkbox_items(review_text, trigger)
    items = parsed['items']

    if not items:
        return {'action': 'stop', 'reason': 'zero_checkboxes', 'cycle_count': cycle_count}

    unchecked = [i for i in items if not i['checked']]
    p0p1 = filter_p0p1_items(unchecked)

    if not p0p1:
        return {'action': 'complete', 'cycle_count': cycle_count}

    if cycle_count >= max_cycles:
        return {'action': 'stop', 'reason': 'max_cycles', 'cycle_count': cycle_count,
                'remaining_count': len(p0p1)}

    return {
        'action': 'continue',
        'next_cycle_count': cycle_count + 1,
        'items': [i['text'] for i in p0p1],
        'scenario_key': scenario_key,
    }
