#!/bin/bash
# Codex notify hook - forwards Codex notify events to OpenSpec Desktop.
#
# Codex may invoke notify in different shapes depending on version:
# 1) <event-name> <json-payload>
# 2) <json-payload>
# 3) <event-name> with json payload on stdin

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

# Desktop HTTP server endpoint
DESKTOP_URL="http://127.0.0.1:18888/api/hook-notify"

EVENT_NAME="${1:-}"
PAYLOAD="${2:-}"

# If payload not in argv[2], try stdin.
if [[ -z "$PAYLOAD" && ! -t 0 ]]; then
  PAYLOAD="$(cat)"
fi

# If payload is still empty and argv[1] looks like JSON, treat argv[1] as payload.
# Otherwise synthesize a minimal payload from event name.
if [[ -z "${PAYLOAD//[[:space:]]/}" && -n "${EVENT_NAME//[[:space:]]/}" ]]; then
  if [[ "$EVENT_NAME" =~ ^[[:space:]]*[\{\[] ]]; then
    PAYLOAD="$EVENT_NAME"
    EVENT_NAME=""
  else
    PAYLOAD="{\"type\":\"$EVENT_NAME\"}"
  fi
fi

if [[ -z "${PAYLOAD//[[:space:]]/}" ]]; then
  exit 0
fi

ENVELOPE_JSON="$(printf '%s' "$PAYLOAD" | EVENT_NAME="$EVENT_NAME" python3 -c '
import json
import os
import re
import sys

event_name = os.environ.get("EVENT_NAME", "").strip()
raw = sys.stdin.read()

def normalize_token(value):
    if not isinstance(value, str):
        return ""
    return re.sub(r"[\s/_]+", "-", value.strip().lower())

def looks_done(raw_value, normalized):
    done_tokens = {
        "agent-turn-complete", "agent-turn-completed", "agent-turn-done",
        "turn-complete", "turn-completed", "turn-done",
        "item-complete", "item-completed",
        "session-complete", "session-completed",
        "response-complete", "response-completed", "response-done",
        "message-complete", "message-completed", "message-done",
        "completion", "completed", "done", "finished", "stop", "stopped",
    }
    if normalized in done_tokens:
        return True
    if normalized.endswith(("-complete", "-completed", "-done", "-finished")):
        return True
    raw_lower = str(raw_value).strip().lower()
    return raw_lower.endswith(("/complete", "/completed", "/done", "/finished"))

payload = {"raw": raw}
if raw.strip():
    try:
        payload = json.loads(raw)
    except Exception:
        payload = {"raw": raw}

event_candidates = []
if isinstance(payload, dict):
    for key in ("type", "event_type", "hook_event_name", "event", "event_name", "name"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            event_candidates.append(value.strip())
if event_name:
    event_candidates.append(event_name)

event_type = ""
is_done = False
for candidate in event_candidates:
    if not candidate:
        continue
    token = normalize_token(candidate)
    if not event_type:
        event_type = candidate
    if looks_done(candidate, token):
        event_type = candidate
        is_done = True
        break

if not event_type:
    event_type = event_name or "unknown"

if isinstance(payload, dict):
    for key in ("status", "state", "result"):
        value = payload.get(key)
        token = normalize_token(value)
        if token in {"complete", "completed", "done", "finished", "stopped", "success", "ok"}:
            is_done = True
            break
        if isinstance(value, str) and value.strip().lower().endswith(("/complete", "/completed", "/done", "/finished")):
            is_done = True
            break

session_id = ""
if isinstance(payload, dict):
    for key in ("thread-id", "thread_id", "session_id", "session-id", "conversation_id", "conversation-id"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            session_id = value.strip()
            break

envelope = {
    "event": "codex-notify",
    "codex_event_type": event_type,
    "codex_is_done": bool(is_done),
    "source": "codex",
    "session_id": session_id,
    "payload": payload,
}

print(json.dumps(envelope, ensure_ascii=False))
' 2>/dev/null || true)"

if [[ -z "$ENVELOPE_JSON" ]]; then
  exit 0
fi

# Always log for debugging.
printf '%s [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$EVENT_NAME" "$ENVELOPE_JSON" >> /tmp/openspec-codex-notify.log 2>/dev/null || true

# POST to desktop app.
curl -s -o /dev/null -w '' -X POST "$DESKTOP_URL" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "$ENVELOPE_JSON" \
  >> /tmp/openspec-codex-notify.log 2>&1 || true

exit 0
