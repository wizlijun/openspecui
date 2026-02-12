#!/bin/bash
# Test hook notification to desktop app

echo "Testing hook notification..."
curl -X POST http://127.0.0.1:18888/api/hook-notify \
  -H 'Content-Type: application/json' \
  -d '{"event":"SessionEnd","timestamp":"2026-02-11T10:00:00Z"}' \
  -v

echo ""
echo "Test complete!"
