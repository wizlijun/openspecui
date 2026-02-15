/**
 * Auto Fix State Machine — Pure logic extracted for testability.
 *
 * Used by App.tsx handleAutoFixReviewComplete to decide the next Auto Fix action.
 * All decision logic lives here so it can be covered by unit tests
 * (see autoFixStateMachine.test.ts).
 */

import { parseCheckboxItems, filterP0P1Items } from './checkboxUtils'
import { detectScenario } from './loadConfirmationCardConfig'
import type { ConfirmationCardConfig } from './loadConfirmationCardConfig'

export interface AutoFixState {
  active: boolean
  cycleCount: number
  stage: 'fixing' | 'reviewing'
}

export type AutoFixDecision =
  | { action: 'continue'; nextCycleCount: number; items: string[]; scenarioKey: string }
  | { action: 'complete'; cycleCount: number }
  | { action: 'stop'; reason: 'no_scenario_match' | 'zero_checkboxes' | 'max_cycles'; cycleCount: number; remainingCount?: number }

/**
 * Given a review result and the current Auto Fix state, decide what to do next.
 * This is a pure function — no side effects.
 */
export function decideAutoFixNext(
  resultText: string,
  state: AutoFixState,
  config: ConfirmationCardConfig,
  maxCycles: number,
): AutoFixDecision {
  // Parse review result for checkbox items
  const scenarioKey = detectScenario(resultText, config)

  if (scenarioKey === 'default') {
    return { action: 'stop', reason: 'no_scenario_match', cycleCount: state.cycleCount }
  }

  const scenario = config.scenarios[scenarioKey]
  const { items } = parseCheckboxItems(resultText, scenario?.trigger)

  if (items.length === 0) {
    return { action: 'stop', reason: 'zero_checkboxes', cycleCount: state.cycleCount }
  }

  const uncheckedItems = items.filter(item => !item.checked)
  const p0p1Items = filterP0P1Items(uncheckedItems)

  if (p0p1Items.length === 0) {
    return { action: 'complete', cycleCount: state.cycleCount }
  }

  if (state.cycleCount >= maxCycles) {
    return { action: 'stop', reason: 'max_cycles', cycleCount: state.cycleCount, remainingCount: p0p1Items.length }
  }

  return {
    action: 'continue',
    nextCycleCount: state.cycleCount + 1,
    items: p0p1Items.map(item => item.text),
    scenarioKey,
  }
}
