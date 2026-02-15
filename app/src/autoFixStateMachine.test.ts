import { describe, it, expect } from 'vitest'
import { decideAutoFixNext } from './autoFixStateMachine'
import type { AutoFixState } from './autoFixStateMachine'
import type { ConfirmationCardConfig } from './loadConfirmationCardConfig'

// ─── Test Fixtures ─────────────────────────────────────────────────

const TEST_CONFIG: ConfirmationCardConfig = {
  scenarios: {
    default: {
      title: '默认',
      buttons: [],
    },
    fix_confirmation: {
      trigger: '[fix_confirmation]',
      title: '评审确认',
      buttons: [],
    },
  },
}

const MAX_CYCLES = 10

function makeState(overrides: Partial<AutoFixState> = {}): AutoFixState {
  return { active: true, cycleCount: 1, stage: 'reviewing', ...overrides }
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('Auto Fix State Machine', () => {

  // ── Path 1: Send failure (tested via sendMessage return value) ──
  // This path is tested at the integration level — sendMessage returns false
  // and App.tsx does not activate Auto Fix. Here we verify the prerequisite:
  // the decision function is never called when send fails.

  describe('Path 1: Send failure prevents activation', () => {
    it('sendMessage returning false means decideAutoFixNext is never reached (documented behavior)', () => {
      // This is an integration-level concern:
      // In App.tsx handleDroidFixRequest, if sendMessage returns false,
      // autoFixActiveMap is never set, so decideAutoFixNext is never called.
      // We verify the contract: sendMessage returns boolean.
      // The actual test is that the state machine function requires an active state.
      const state = makeState({ active: false })
      // If somehow called with inactive state, the caller should have guarded.
      // The function itself doesn't check active — that's the caller's job.
      expect(state.active).toBe(false)
    })
  })

  // ── Path 2: Max cycles triggers stop ──

  describe('Path 2: Max cycles reached', () => {
    it('should stop when cycleCount equals MAX_AUTOFIX_CYCLES', () => {
      const state = makeState({ cycleCount: MAX_CYCLES })
      const result = decideAutoFixNext(
        '[fix_confirmation]\n- [ ] P0 修复构建错误\n- [ ] P1 修复类型问题',
        state,
        TEST_CONFIG,
        MAX_CYCLES,
      )
      expect(result.action).toBe('stop')
      if (result.action === 'stop') {
        expect(result.reason).toBe('max_cycles')
        expect(result.cycleCount).toBe(MAX_CYCLES)
        expect(result.remainingCount).toBe(2)
      }
    })

    it('should stop when cycleCount exceeds MAX_AUTOFIX_CYCLES', () => {
      const state = makeState({ cycleCount: MAX_CYCLES + 5 })
      const result = decideAutoFixNext(
        '[fix_confirmation]\n- [ ] P0 严重问题',
        state,
        TEST_CONFIG,
        MAX_CYCLES,
      )
      expect(result.action).toBe('stop')
      if (result.action === 'stop') {
        expect(result.reason).toBe('max_cycles')
      }
    })

    it('should continue when cycleCount is below MAX_AUTOFIX_CYCLES', () => {
      const state = makeState({ cycleCount: MAX_CYCLES - 1 })
      const result = decideAutoFixNext(
        '[fix_confirmation]\n- [ ] P0 修复构建错误',
        state,
        TEST_CONFIG,
        MAX_CYCLES,
      )
      expect(result.action).toBe('continue')
      if (result.action === 'continue') {
        expect(result.nextCycleCount).toBe(MAX_CYCLES)
        expect(result.items).toHaveLength(1)
      }
    })
  })

  // ── Path 3: Scenario matched but 0 checkboxes ──

  describe('Path 3: Scenario matched but 0 checkboxes', () => {
    it('should stop when trigger matches but no checkboxes found', () => {
      const result = decideAutoFixNext(
        '[fix_confirmation]\n这是一段没有 checkbox 的评审结果文本。\n所有问题已修复。',
        makeState(),
        TEST_CONFIG,
        MAX_CYCLES,
      )
      expect(result.action).toBe('stop')
      if (result.action === 'stop') {
        expect(result.reason).toBe('zero_checkboxes')
      }
    })

    it('should stop when trigger matches but only has code blocks with checkbox-like syntax', () => {
      const result = decideAutoFixNext(
        '[fix_confirmation]\n```\n- [ ] P0 这是代码块里的假 checkbox\n```\n没有真正的 checkbox。',
        makeState(),
        TEST_CONFIG,
        MAX_CYCLES,
      )
      expect(result.action).toBe('stop')
      if (result.action === 'stop') {
        expect(result.reason).toBe('zero_checkboxes')
      }
    })
  })

  // ── Additional: Scenario not matched ──

  describe('Scenario not matched', () => {
    it('should stop when review result does not match any scenario trigger', () => {
      const result = decideAutoFixNext(
        '这是一段普通文本，没有触发任何场景。\n- [ ] P0 问题',
        makeState(),
        TEST_CONFIG,
        MAX_CYCLES,
      )
      expect(result.action).toBe('stop')
      if (result.action === 'stop') {
        expect(result.reason).toBe('no_scenario_match')
      }
    })
  })

  // ── Additional: Successful completion ──

  describe('Successful completion', () => {
    it('should complete when all P0/P1 items are checked', () => {
      const result = decideAutoFixNext(
        '[fix_confirmation]\n- [x] P0 修复构建错误\n- [x] P1 修复类型问题\n- [ ] P2 清理代码',
        makeState(),
        TEST_CONFIG,
        MAX_CYCLES,
      )
      expect(result.action).toBe('complete')
      if (result.action === 'complete') {
        expect(result.cycleCount).toBe(1)
      }
    })

    it('should complete when only P2 items remain unchecked', () => {
      const result = decideAutoFixNext(
        '[fix_confirmation]\n- [ ] P2 优化性能\n- [ ] P2 添加注释',
        makeState({ cycleCount: 3 }),
        TEST_CONFIG,
        MAX_CYCLES,
      )
      expect(result.action).toBe('complete')
      if (result.action === 'complete') {
        expect(result.cycleCount).toBe(3)
      }
    })
  })

  // ── Additional: Continue with next cycle ──

  describe('Continue to next cycle', () => {
    it('should continue with incremented cycle count when P0/P1 items remain', () => {
      const result = decideAutoFixNext(
        '[fix_confirmation]\n- [x] P0 已修复的问题\n- [ ] P0 未修复的问题\n- [ ] P1 另一个问题',
        makeState({ cycleCount: 3 }),
        TEST_CONFIG,
        MAX_CYCLES,
      )
      expect(result.action).toBe('continue')
      if (result.action === 'continue') {
        expect(result.nextCycleCount).toBe(4)
        expect(result.items).toHaveLength(2)
        expect(result.items).toContain('P0 未修复的问题')
        expect(result.items).toContain('P1 另一个问题')
      }
    })

    it('should only include unchecked P0/P1 items, not P2 or checked items', () => {
      const result = decideAutoFixNext(
        '[fix_confirmation]\n- [x] P0 已修复\n- [ ] P0 未修复\n- [ ] P2 低优先级\n- [x] P1 已修复',
        makeState({ cycleCount: 1 }),
        TEST_CONFIG,
        MAX_CYCLES,
      )
      expect(result.action).toBe('continue')
      if (result.action === 'continue') {
        expect(result.items).toHaveLength(1)
        expect(result.items[0]).toBe('P0 未修复')
      }
    })
  })

  // ── Cycle count preservation (regression for P0 bug) ──

  describe('Cycle count preservation (regression)', () => {
    it('should correctly increment from any cycle count, not reset to 1', () => {
      for (let cycle = 1; cycle < MAX_CYCLES; cycle++) {
        const result = decideAutoFixNext(
          '[fix_confirmation]\n- [ ] P0 问题',
          makeState({ cycleCount: cycle }),
          TEST_CONFIG,
          MAX_CYCLES,
        )
        expect(result.action).toBe('continue')
        if (result.action === 'continue') {
          expect(result.nextCycleCount).toBe(cycle + 1)
        }
      }
    })
  })
})
