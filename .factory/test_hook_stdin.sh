#!/bin/bash
# Test hook with stdin data

echo '{"hook_event_name":"SessionEnd","session_id":"test-session","reason":"user_exit","cwd":"/tmp","transcript_path":"/tmp/test.jsonl"}' | cat /dev/stdin | curl -s -X POST http://127.0.0.1:18888/api/hook-notify -H 'Content-Type: application/json' -d @-

echo "Test completed"
