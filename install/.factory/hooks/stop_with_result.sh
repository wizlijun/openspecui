#!/bin/bash
# Read hook stdin data, extract last assistant message from transcript,
# and forward everything to desktop app.

STDIN_DATA=$(cat /dev/stdin)

# Use a single python3 script to do everything
echo "$STDIN_DATA" | python3 -c "
import sys, json, os

data = json.load(sys.stdin)
transcript_path = os.path.expanduser(data.get('transcript_path', ''))

if transcript_path and os.path.isfile(transcript_path):
    last_text = ''
    try:
        with open(transcript_path) as f:
            for line in f:
                try:
                    d = json.loads(line)
                    if d.get('type') == 'message':
                        msg = d.get('message', {})
                        if msg.get('role') == 'assistant':
                            content = msg.get('content', [])
                            if isinstance(content, list):
                                texts = [c['text'] for c in content if isinstance(c, dict) and c.get('type') == 'text' and c.get('text', '').strip()]
                                if texts:
                                    last_text = texts[-1]
                            elif isinstance(content, str) and content.strip():
                                last_text = content
                except:
                    pass
    except:
        pass

    if last_text:
        # Truncate to 10000 chars
        if len(last_text) > 10000:
            last_text = last_text[-10000:]
        data['last_result'] = last_text

print(json.dumps(data))
" 2>/dev/null | curl -s -X POST http://127.0.0.1:18888/api/hook-notify \
    -H 'Content-Type: application/json' \
    -d @- 2>/dev/null || true
