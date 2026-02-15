"""
Tests for autofix_logic.py — shared Auto Fix pure functions.

Covers:
  - Checkbox parsing (parse_checkbox_items, filter_p0p1_items)
  - Codex turn detection (is_codex_turn_complete)
  - Final message extraction (extract_codex_final_message)
  - Auto Fix decision logic (decide_autofix_next)

These tests mirror the TS tests in app/src/autoFixStateMachine.test.ts
to ensure Python and TS implementations stay in sync.
"""

import unittest
import sys
import os

# Ensure the desktop directory is on sys.path so the test can be run from any working directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from autofix_logic import (
    parse_checkbox_items,
    filter_p0p1_items,
    is_codex_turn_complete,
    extract_codex_final_message,
    decide_autofix_next,
    detect_scenario,
)

MAX_CYCLES = 10

# Default scenarios dict matching the YAML config structure
DEFAULT_SCENARIOS = {
    'review_confirm': {
        'trigger': '[fix_confirmation]',
        'title': '评审结果',
    }
}


# ─── Checkbox Parsing ───────────────────────────────────────────────

class TestParseCheckboxItems(unittest.TestCase):

    def test_basic_unchecked(self):
        text = '- [ ] P0 修复构建错误\n- [ ] P1 修复类型问题'
        result = parse_checkbox_items(text)
        self.assertEqual(len(result['items']), 2)
        self.assertFalse(result['items'][0]['checked'])
        self.assertEqual(result['items'][0]['text'], 'P0 修复构建错误')

    def test_basic_checked(self):
        text = '- [x] P0 已修复\n- [X] P1 也修复了'
        result = parse_checkbox_items(text)
        self.assertEqual(len(result['items']), 2)
        self.assertTrue(result['items'][0]['checked'])
        self.assertTrue(result['items'][1]['checked'])

    def test_mixed(self):
        text = '- [x] P0 已修复\n- [ ] P1 未修复\n- [ ] P2 低优先级'
        result = parse_checkbox_items(text)
        self.assertEqual(len(result['items']), 3)
        self.assertTrue(result['items'][0]['checked'])
        self.assertFalse(result['items'][1]['checked'])

    def test_skips_code_blocks(self):
        text = '```\n- [ ] P0 这是代码块里的假 checkbox\n```\n- [ ] P0 真正的 checkbox'
        result = parse_checkbox_items(text)
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(result['items'][0]['text'], 'P0 真正的 checkbox')

    def test_skips_trigger_line(self):
        text = '[fix_confirmation]\n- [ ] P0 问题'
        result = parse_checkbox_items(text, '[fix_confirmation]')
        self.assertEqual(len(result['items']), 1)
        # Trigger line should not appear in context_lines
        self.assertNotIn('[fix_confirmation]', ' '.join(result['context_lines']))

    def test_empty_text(self):
        result = parse_checkbox_items('')
        self.assertEqual(len(result['items']), 0)
        self.assertEqual(len(result['context_lines']), 0)

    def test_no_checkboxes(self):
        text = '这是一段没有 checkbox 的文本。\n所有问题已修复。'
        result = parse_checkbox_items(text)
        self.assertEqual(len(result['items']), 0)
        self.assertTrue(len(result['context_lines']) > 0)

    def test_context_lines(self):
        text = '评审结果：\n- [ ] P0 问题\n总结：没有严重问题'
        result = parse_checkbox_items(text)
        self.assertEqual(len(result['items']), 1)
        self.assertIn('评审结果：', result['context_lines'])
        self.assertIn('总结：没有严重问题', result['context_lines'])


class TestFilterP0P1Items(unittest.TestCase):

    def test_filters_p0_p1(self):
        items = [
            {'text': 'P0 严重问题', 'checked': False},
            {'text': 'P1 中等问题', 'checked': False},
            {'text': 'P2 低优先级', 'checked': False},
        ]
        result = filter_p0p1_items(items)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]['text'], 'P0 严重问题')
        self.assertEqual(result[1]['text'], 'P1 中等问题')

    def test_handles_markdown_formatting(self):
        items = [
            {'text': '**P0** 加粗问题', 'checked': False},
            {'text': '*P1* 斜体问题', 'checked': False},
            {'text': '[P0] 括号问题', 'checked': False},
        ]
        result = filter_p0p1_items(items)
        self.assertEqual(len(result), 3)

    def test_empty_list(self):
        self.assertEqual(filter_p0p1_items([]), [])

    def test_no_p0p1(self):
        items = [
            {'text': 'P2 低优先级', 'checked': False},
            {'text': 'P3 建议', 'checked': False},
        ]
        result = filter_p0p1_items(items)
        self.assertEqual(len(result), 0)


# ─── Codex Turn Detection ──────────────────────────────────────────

class TestIsCodexTurnComplete(unittest.TestCase):

    def test_codex_is_done_flag(self):
        self.assertTrue(is_codex_turn_complete({'codex_is_done': True}))

    def test_codex_is_done_false(self):
        self.assertFalse(is_codex_turn_complete({'codex_is_done': False}))

    def test_event_type_completed(self):
        self.assertTrue(is_codex_turn_complete({'event_type': 'agent-turn-complete'}))

    def test_event_type_done(self):
        self.assertTrue(is_codex_turn_complete({'type': 'done'}))

    def test_payload_status_complete(self):
        self.assertTrue(is_codex_turn_complete({'payload': {'status': 'completed'}}))

    def test_payload_status_success(self):
        self.assertTrue(is_codex_turn_complete({'payload': {'status': 'success'}}))

    def test_slash_separated_complete(self):
        self.assertTrue(is_codex_turn_complete({'hook_event_name': 'response/complete'}))

    def test_underscore_separated(self):
        self.assertTrue(is_codex_turn_complete({'codex_event_type': 'agent_turn_complete'}))

    def test_done_flag(self):
        self.assertTrue(is_codex_turn_complete({'done': True}))

    def test_complete_flag(self):
        self.assertTrue(is_codex_turn_complete({'complete': True}))

    def test_payload_done_flag(self):
        self.assertTrue(is_codex_turn_complete({'payload': {'done': True}}))

    def test_not_complete(self):
        self.assertFalse(is_codex_turn_complete({'event_type': 'message-delta'}))

    def test_empty_data(self):
        self.assertFalse(is_codex_turn_complete({}))

    def test_payload_event_type(self):
        self.assertTrue(is_codex_turn_complete({'payload': {'event_type': 'turn-completed'}}))

    def test_item_complete(self):
        """item-complete token — present in TS but was missing from old Python inline impl."""
        self.assertTrue(is_codex_turn_complete({'type': 'item-complete'}))

    def test_session_complete(self):
        """session-complete token — present in TS but was missing from old Python inline impl."""
        self.assertTrue(is_codex_turn_complete({'type': 'session-completed'}))

    def test_message_done(self):
        """message-done token — present in TS but was missing from old Python inline impl."""
        self.assertTrue(is_codex_turn_complete({'type': 'message-done'}))

    def test_finished_suffix(self):
        """'-finished' suffix — present in TS but was missing from old Python inline impl."""
        self.assertTrue(is_codex_turn_complete({'type': 'task-finished'}))


# ─── Final Message Extraction ──────────────────────────────────────

class TestExtractCodexFinalMessage(unittest.TestCase):

    def test_payload_last_assistant_message(self):
        data = {'payload': {'last-assistant-message': 'hello'}}
        self.assertEqual(extract_codex_final_message(data), 'hello')

    def test_payload_underscore_variant(self):
        data = {'payload': {'last_assistant_message': 'world'}}
        self.assertEqual(extract_codex_final_message(data), 'world')

    def test_top_level_last_result(self):
        data = {'last_result': 'result text'}
        self.assertEqual(extract_codex_final_message(data), 'result text')

    def test_payload_last_result(self):
        data = {'payload': {'last_result': 'payload result'}}
        self.assertEqual(extract_codex_final_message(data), 'payload result')

    def test_priority_order(self):
        """payload.last-assistant-message takes priority over last_result."""
        data = {
            'payload': {'last-assistant-message': 'priority', 'last_result': 'fallback'},
            'last_result': 'top-level',
        }
        self.assertEqual(extract_codex_final_message(data), 'priority')

    def test_empty_string_skipped(self):
        data = {'payload': {'last-assistant-message': '  '}, 'last_result': 'fallback'}
        self.assertEqual(extract_codex_final_message(data), 'fallback')

    def test_none_when_no_message(self):
        self.assertIsNone(extract_codex_final_message({}))
        self.assertIsNone(extract_codex_final_message({'payload': {}}))


# ─── Auto Fix Decision Logic ───────────────────────────────────────

class TestDecideAutoFixNext(unittest.TestCase):

    # ── Stop: no scenario match ──

    def test_stop_no_scenario_match(self):
        result = decide_autofix_next(
            '这是一段普通文本，没有触发任何场景。\n- [ ] P0 问题',
            cycle_count=1, max_cycles=MAX_CYCLES, scenarios=DEFAULT_SCENARIOS,
        )
        self.assertEqual(result['action'], 'stop')
        self.assertEqual(result['reason'], 'no_scenario_match')

    # ── Stop: zero checkboxes ──

    def test_stop_zero_checkboxes(self):
        result = decide_autofix_next(
            '[fix_confirmation]\n这是一段没有 checkbox 的评审结果文本。',
            cycle_count=1, max_cycles=MAX_CYCLES, scenarios=DEFAULT_SCENARIOS,
        )
        self.assertEqual(result['action'], 'stop')
        self.assertEqual(result['reason'], 'zero_checkboxes')

    def test_stop_checkboxes_only_in_code_block(self):
        result = decide_autofix_next(
            '[fix_confirmation]\n```\n- [ ] P0 假 checkbox\n```\n没有真正的 checkbox。',
            cycle_count=1, max_cycles=MAX_CYCLES, scenarios=DEFAULT_SCENARIOS,
        )
        self.assertEqual(result['action'], 'stop')
        self.assertEqual(result['reason'], 'zero_checkboxes')

    # ── Stop: max cycles ──

    def test_stop_max_cycles(self):
        result = decide_autofix_next(
            '[fix_confirmation]\n- [ ] P0 修复构建错误\n- [ ] P1 修复类型问题',
            cycle_count=MAX_CYCLES, max_cycles=MAX_CYCLES, scenarios=DEFAULT_SCENARIOS,
        )
        self.assertEqual(result['action'], 'stop')
        self.assertEqual(result['reason'], 'max_cycles')
        self.assertEqual(result['remaining_count'], 2)

    def test_stop_exceeds_max_cycles(self):
        result = decide_autofix_next(
            '[fix_confirmation]\n- [ ] P0 严重问题',
            cycle_count=MAX_CYCLES + 5, max_cycles=MAX_CYCLES, scenarios=DEFAULT_SCENARIOS,
        )
        self.assertEqual(result['action'], 'stop')
        self.assertEqual(result['reason'], 'max_cycles')

    # ── Complete: no P0/P1 remaining ──

    def test_complete_all_checked(self):
        result = decide_autofix_next(
            '[fix_confirmation]\n- [x] P0 修复构建错误\n- [x] P1 修复类型问题\n- [ ] P2 清理代码',
            cycle_count=1, max_cycles=MAX_CYCLES, scenarios=DEFAULT_SCENARIOS,
        )
        self.assertEqual(result['action'], 'complete')
        self.assertEqual(result['cycle_count'], 1)

    def test_complete_only_p2_remaining(self):
        result = decide_autofix_next(
            '[fix_confirmation]\n- [ ] P2 优化性能\n- [ ] P2 添加注释',
            cycle_count=3, max_cycles=MAX_CYCLES, scenarios=DEFAULT_SCENARIOS,
        )
        self.assertEqual(result['action'], 'complete')
        self.assertEqual(result['cycle_count'], 3)

    # ── Continue: P0/P1 items remain ──

    def test_continue_with_p0p1(self):
        result = decide_autofix_next(
            '[fix_confirmation]\n- [x] P0 已修复\n- [ ] P0 未修复\n- [ ] P1 另一个问题',
            cycle_count=3, max_cycles=MAX_CYCLES, scenarios=DEFAULT_SCENARIOS,
        )
        self.assertEqual(result['action'], 'continue')
        self.assertEqual(result['next_cycle_count'], 4)
        self.assertEqual(len(result['items']), 2)
        self.assertIn('P0 未修复', result['items'])
        self.assertIn('P1 另一个问题', result['items'])

    def test_continue_excludes_p2_and_checked(self):
        result = decide_autofix_next(
            '[fix_confirmation]\n- [x] P0 已修复\n- [ ] P0 未修复\n- [ ] P2 低优先级\n- [x] P1 已修复',
            cycle_count=1, max_cycles=MAX_CYCLES, scenarios=DEFAULT_SCENARIOS,
        )
        self.assertEqual(result['action'], 'continue')
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(result['items'][0], 'P0 未修复')

    def test_continue_below_max_cycles(self):
        result = decide_autofix_next(
            '[fix_confirmation]\n- [ ] P0 修复构建错误',
            cycle_count=MAX_CYCLES - 1, max_cycles=MAX_CYCLES, scenarios=DEFAULT_SCENARIOS,
        )
        self.assertEqual(result['action'], 'continue')
        self.assertEqual(result['next_cycle_count'], MAX_CYCLES)

    # ── Cycle count preservation (regression) ──

    def test_cycle_count_increments_correctly(self):
        for cycle in range(1, MAX_CYCLES):
            result = decide_autofix_next(
                '[fix_confirmation]\n- [ ] P0 问题',
                cycle_count=cycle, max_cycles=MAX_CYCLES, scenarios=DEFAULT_SCENARIOS,
            )
            self.assertEqual(result['action'], 'continue')
            self.assertEqual(result['next_cycle_count'], cycle + 1)


if __name__ == '__main__':
    unittest.main()
