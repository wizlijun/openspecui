#!/bin/bash
# Test script for Codex notify hook
# Tests various scenarios to ensure the hook works correctly

set -e

NOTIFY_SCRIPT="/Users/bruce/git/openspecui/.codex/notify.sh"
LOG_FILE="/tmp/openspec-codex-notify.log"
DESKTOP_URL="http://127.0.0.1:18888/api/hook-notify"

echo "=========================================="
echo "Codex Notify Hook Test Suite"
echo "=========================================="
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
    local test_name="$1"
    local event_name="$2"
    local json_payload="$3"
    
    TESTS_RUN=$((TESTS_RUN + 1))
    echo -e "${YELLOW}Test $TESTS_RUN: $test_name${NC}"
    
    # Clear log
    > "$LOG_FILE" 2>/dev/null || true
    
    # Run the hook
    if bash "$NOTIFY_SCRIPT" "$event_name" "$json_payload" 2>&1; then
        # Check if log was created
        if [[ -f "$LOG_FILE" ]] && [[ -s "$LOG_FILE" ]]; then
            echo -e "${GREEN}✓ PASSED${NC}"
            echo "  Log output:"
            tail -1 "$LOG_FILE" | sed 's/^/    /'
            TESTS_PASSED=$((TESTS_PASSED + 1))
        else
            echo -e "${RED}✗ FAILED - No log output${NC}"
            TESTS_FAILED=$((TESTS_FAILED + 1))
        fi
    else
        echo -e "${RED}✗ FAILED - Script error${NC}"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
    echo ""
}

# Pre-flight checks
echo "Pre-flight checks:"
echo "  Script: $NOTIFY_SCRIPT"
if [[ -f "$NOTIFY_SCRIPT" ]]; then
    echo -e "    ${GREEN}✓ Exists${NC}"
else
    echo -e "    ${RED}✗ Not found${NC}"
    exit 1
fi

if bash -n "$NOTIFY_SCRIPT" 2>/dev/null; then
    echo -e "    ${GREEN}✓ Syntax OK${NC}"
else
    echo -e "    ${RED}✗ Syntax error${NC}"
    exit 1
fi

echo ""
echo "  Desktop server: $DESKTOP_URL"
if curl -s -o /dev/null -w '' --connect-timeout 2 "$DESKTOP_URL" 2>/dev/null; then
    echo -e "    ${GREEN}✓ Reachable${NC}"
else
    echo -e "    ${YELLOW}⚠ Not reachable (tests will still run)${NC}"
fi

echo ""
echo "=========================================="
echo "Running Tests"
echo "=========================================="
echo ""

# Test 1: Basic agent-turn-complete with thread-id
run_test "Basic agent-turn-complete with thread-id" \
    "agent-turn-complete" \
    '{"type":"agent-turn-complete","thread-id":"test-session-001"}'

# Test 2: agent-turn-complete with additional fields
run_test "agent-turn-complete with last-assistant-message" \
    "agent-turn-complete" \
    '{"type":"agent-turn-complete","thread-id":"test-session-002","last-assistant-message":"Task completed successfully"}'

# Test 3: agent-turn-complete with input-messages array
run_test "agent-turn-complete with input-messages" \
    "agent-turn-complete" \
    '{"type":"agent-turn-complete","thread-id":"test-session-003","input-messages":["User prompt 1","User prompt 2"]}'

# Test 4: Minimal payload (no thread-id)
run_test "Minimal payload without thread-id" \
    "agent-turn-complete" \
    '{"type":"agent-turn-complete"}'

# Test 5: Empty payload (should construct from event name)
run_test "Empty payload (construct from event name)" \
    "agent-turn-complete" \
    ''

# Test 6: Malformed JSON (should handle gracefully)
run_test "Malformed JSON payload" \
    "agent-turn-complete" \
    'not-valid-json'

# Test 7: Complex nested payload
run_test "Complex nested payload" \
    "agent-turn-complete" \
    '{"type":"agent-turn-complete","thread-id":"test-session-007","metadata":{"model":"gpt-5.3-codex","tokens":1500},"status":"success"}'

# Test 8: Unicode characters in payload
run_test "Unicode characters in payload" \
    "agent-turn-complete" \
    '{"type":"agent-turn-complete","thread-id":"test-session-008","message":"测试中文 🚀"}'

# Test 9: Very long thread-id
run_test "Long thread-id" \
    "agent-turn-complete" \
    '{"type":"agent-turn-complete","thread-id":"very-long-session-id-with-many-characters-0123456789abcdef"}'

# Test 10: Different event types (hypothetical)
run_test "Custom event type" \
    "custom-event" \
    '{"type":"custom-event","thread-id":"test-session-010","data":"custom data"}'

echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo "Total tests run: $TESTS_RUN"
echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
echo ""

if [[ $TESTS_FAILED -eq 0 ]]; then
    echo -e "${GREEN}All tests passed!${NC}"
    echo ""
    echo "View full log:"
    echo "  cat $LOG_FILE"
    exit 0
else
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
fi
