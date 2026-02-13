import { useState, useCallback, useRef, useEffect } from 'react'
import { saveHistoryEntry } from './inputHistoryService'
import { MarkdownWithCheckbox } from './MarkdownWithCheckbox'
import { HumanConfirmationCard } from './HumanConfirmationCard'
import { DEFAULT_CODEX_CONFIGS } from './loadCodexWorkerConfig'
import type { ConfirmationCardConfig, ConfirmationButton, ButtonAction } from './loadConfirmationCardConfig'
import { detectScenario } from './loadConfirmationCardConfig'
import { parseCheckboxItems } from './checkboxUtils'

// ─── Types ─────────────────────────────────────────────────────────

export type CodexWorkerMode = 'standalone' | 'code_review'

export interface CodexQuickButton {
  label: string
  prompt?: string
  promptTemplate?: string
  action?: string
  requiresInput?: boolean
}

export interface ConfirmationConfig {
  enabled?: boolean
  responseTemplate?: string
}

export interface CodexWorkerConfig {
  mode: CodexWorkerMode
  name: string
  autoInitPrompt?: string | null
  leftButtons: CodexQuickButton[]
  rightButtons: CodexQuickButton[]
  /** Human confirmation card config */
  confirmation?: ConfirmationConfig
}

// Re-export for backward compatibility
export { DEFAULT_CODEX_CONFIGS }

// ─── Helper functions ──────────────────────────────────────────────

const normalizeEventToken = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase().replace(/[\/_\s]+/g, '-')

const isCodexTurnComplete = (data: any): boolean => {
  if (data?.codex_is_done === true) return true

  const doneTokens = new Set([
    'agent-turn-complete', 'agent-turn-completed', 'agent-turn-done',
    'turn-complete', 'turn-completed', 'turn-done',
    'item-complete', 'item-completed',
    'session-complete', 'session-completed',
    'response-complete', 'response-completed', 'response-done',
    'message-complete', 'message-completed', 'message-done',
    'completion', 'completed', 'done', 'finished', 'stop', 'stopped',
  ])

  const eventCandidates = [
    data?.codex_event_type, data?.event_type, data?.type,
    data?.hook_event_name, data?.payload?.type, data?.payload?.event_type,
    data?.payload?.hook_event_name, data?.payload?.event,
  ]

  for (const candidate of eventCandidates) {
    const raw = String(candidate ?? '').trim().toLowerCase()
    if (raw.endsWith('/complete') || raw.endsWith('/completed') || raw.endsWith('/done') || raw.endsWith('/finished')) {
      return true
    }
    const token = normalizeEventToken(candidate)
    if (!token) continue
    if (doneTokens.has(token) || token.endsWith('-complete') || token.endsWith('-completed') || token.endsWith('-done') || token.endsWith('-finished')) {
      return true
    }
  }

  const statusCandidates = [data?.status, data?.payload?.status]
  for (const status of statusCandidates) {
    const token = normalizeEventToken(status)
    if (['complete', 'completed', 'done', 'finished', 'stopped', 'success', 'ok'].includes(token)) {
      return true
    }
  }

  return Boolean(data?.done || data?.complete || data?.payload?.done || data?.payload?.complete)
}

const extractCodexFinalMessage = (data: any): string | null => {
  const candidates = [
    data?.payload?.['last-assistant-message'],
    data?.payload?.last_assistant_message,
    data?.['last-assistant-message'],
    data?.last_assistant_message,
    data?.payload?.last_result,
    data?.last_result,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }
  return null
}

// ─── Celebration Effect (Confetti) ─────────────────────────────────

function triggerCelebration() {
  const colors = ['#ff0', '#f0f', '#0ff', '#f00', '#0f0', '#00f', '#ff8800', '#ff0088']
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:99999;overflow:hidden'
  document.body.appendChild(container)

  for (let i = 0; i < 150; i++) {
    const confetti = document.createElement('div')
    const size = Math.random() * 10 + 5
    const color = colors[Math.floor(Math.random() * colors.length)]
    const left = Math.random() * 100
    const delay = Math.random() * 2
    const duration = Math.random() * 2 + 2
    const rotation = Math.random() * 360

    confetti.style.cssText = `
      position:absolute;
      left:${left}%;
      top:-20px;
      width:${size}px;
      height:${size * 0.6}px;
      background:${color};
      border-radius:2px;
      opacity:0.9;
      transform:rotate(${rotation}deg);
      animation:confetti-fall ${duration}s ease-in ${delay}s forwards;
    `
    container.appendChild(confetti)
  }

  // Inject keyframes if not already present
  if (!document.getElementById('confetti-keyframes')) {
    const style = document.createElement('style')
    style.id = 'confetti-keyframes'
    style.textContent = `
      @keyframes confetti-fall {
        0% { top: -20px; opacity: 1; transform: rotate(0deg) translateX(0); }
        25% { opacity: 1; transform: rotate(180deg) translateX(${Math.random() > 0.5 ? '' : '-'}30px); }
        50% { opacity: 0.8; transform: rotate(360deg) translateX(${Math.random() > 0.5 ? '-' : ''}20px); }
        100% { top: 110vh; opacity: 0; transform: rotate(720deg) translateX(${Math.random() > 0.5 ? '' : '-'}40px); }
      }
    `
    document.head.appendChild(style)
  }

  // Clean up after animation
  setTimeout(() => container.remove(), 5000)
}

// ─── Props ─────────────────────────────────────────────────────────

export interface CodexWorkerBaseProps {
  tabId: string
  changeId?: string
  resumeSessionId?: string
  projectPath: string | undefined
  config: CodexWorkerConfig
  onStopHookRef: React.MutableRefObject<((data: any) => void) | null>
  onRefresh: () => void
  sessionIdRef: React.MutableRefObject<string | null>
  onSessionId?: (id: string) => void
  onBusyChange?: (busy: boolean) => void
  /** Called when user clicks "Droid Fix" in confirmation card — sends selected items to bound Droid Worker */
  onDroidFixRequest?: (selectedItems: string[], codexWorkerId: string) => void
  /** Confirmation card config loaded from .openspec/confirmation_card.yml */
  confirmationCardConfig?: ConfirmationCardConfig
  /** Called when initialization completes (success or timeout) to dequeue from initializing list */
  onInitComplete?: () => void
  /** Register a pending session token for precise routing. Called with (token, tabId) on init, (null, tabId) on bind/cleanup. */
  onPendingToken?: (token: string | null) => void
}

// ─── Component ─────────────────────────────────────────────────────

export function CodexWorkerBase({
  tabId, changeId, resumeSessionId, projectPath, config,
  onStopHookRef, onRefresh, sessionIdRef, onSessionId, onBusyChange,
  onDroidFixRequest, confirmationCardConfig, onInitComplete, onPendingToken,
}: CodexWorkerBaseProps) {
  const [message, setMessage] = useState('')
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([])
  const [waiting, setWaiting] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [showInitButton, setShowInitButton] = useState(true)
  const [confirmationData, setConfirmationData] = useState<{ text: string; scenarioKey: string } | null>(null)
  const [autoFixMode, setAutoFixMode] = useState(false)
  const [autoFixStage, setAutoFixStage] = useState<'fixing' | 'reviewing' | null>(null)
  const initCalledRef = useRef(false)
  const initializedRef = useRef(false)
  const autoPromptSentRef = useRef(false)
  const abortedRef = useRef(false)
  const resultRef = useRef<HTMLDivElement>(null)

  const autoFixModeRef = useRef(false)
  const autoFixStageRef = useRef<'fixing' | 'reviewing' | null>(null)

  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh
  const onSessionIdRef = useRef(onSessionId)
  onSessionIdRef.current = onSessionId
  const onInitCompleteRef = useRef(onInitComplete)
  onInitCompleteRef.current = onInitComplete
  const onPendingTokenRef = useRef(onPendingToken)
  onPendingTokenRef.current = onPendingToken
  const onBusyChangeRef = useRef(onBusyChange)
  onBusyChangeRef.current = onBusyChange
  const onStopHookRefStable = useRef(onStopHookRef)
  onStopHookRefStable.current = onStopHookRef
  const sessionIdRefStable = useRef(sessionIdRef)
  sessionIdRefStable.current = sessionIdRef
  const confirmationCardConfigRef = useRef(confirmationCardConfig)
  confirmationCardConfigRef.current = confirmationCardConfig
  const onDroidFixRequestRef = useRef(onDroidFixRequest)
  onDroidFixRequestRef.current = onDroidFixRequest
  // Unique token generated at init time for precise session routing
  const pendingTokenRef = useRef<string | null>(null)

  const bridge = window.__nativeBridge

  // Auto-scroll
  useEffect(() => {
    if (resultRef.current) {
      resultRef.current.scrollTop = resultRef.current.scrollHeight
    }
  }, [history])

  // Busy state
  useEffect(() => {
    onBusyChangeRef.current?.(waiting)
  }, [waiting])

  // Terminal helpers (defined before hook listener so it can reference sendToReview)
  const sendToReview = useCallback((text: string) => {
    if (bridge) {
      bridge.writeChangeInput(tabId, text)
      setTimeout(() => bridge.writeChangeInput(tabId, '\r'), 200)
    }
  }, [bridge, tabId])

  // Get the Review Again prompt from config for auto-fix cycle
  const reviewAgainPrompt = config.leftButtons.find(b => b.label === 'Review Again')?.prompt
    || '请再次严格评审修改的代码,无需修改代码和构建，只给评审建议，要求文法简洁、清晰、认知负荷低。结果按优先级P0、P1、P2排序，以todo的列表形式返回， 每一项的文本前面加上 P0/P1，例如 - [ ] P0 描述。请在返回结果最开始加上[fix_confirmation]'

  // Auto-fix cycle handler: processes completed task results
  const handleAutoFixCycle = useCallback((resultText: string) => {
    const stage = autoFixStageRef.current

    if (stage === 'fixing') {
      // Fix completed → send Review Again
      setHistory(prev => [...prev, { role: 'user', text: `[Auto Fix → Review] ${reviewAgainPrompt}` }])
      setAutoFixStage('reviewing')
      autoFixStageRef.current = 'reviewing'
      setWaiting(true)
      if (projectPath) {
        saveHistoryEntry(projectPath, `codex://${changeId || 'standalone'}`, reviewAgainPrompt, 'Codex Worker > Auto Fix Review').catch(() => {})
      }
      sendToReview(reviewAgainPrompt)
      return true
    }

    if (stage === 'reviewing' && confirmationCardConfig) {
      // Review completed → check if there are still items to fix
      const scenarioKey = detectScenario(resultText, confirmationCardConfig)
      if (scenarioKey !== 'default') {
        const scenario = confirmationCardConfig.scenarios[scenarioKey]
        const { items } = parseCheckboxItems(resultText, scenario?.trigger)

        // Filter to only unchecked items
        const uncheckedItems = items.filter(item => !item.checked)

        if (uncheckedItems.length === 0) {
          // No more unchecked items → Auto Fix complete!
          setAutoFixMode(false)
          autoFixModeRef.current = false
          setAutoFixStage(null)
          autoFixStageRef.current = null
          setHistory(prev => [...prev, { role: 'assistant', text: '🎉 Auto Fix 完成！所有问题已解决！' }])
          triggerCelebration()
          return true
        }

        // Still have unchecked items → auto-select all and send fix
        const selectedItems = uncheckedItems.map(item => item.text)
        const template = scenario?.buttons.find(b => b.action === 'auto_fix')?.messageTemplate
          || '请按选择的评审意见，先思考原因，再解决，再调试通过：\n{selected_items}'
        const itemsText = selectedItems.map(item => `- ${item}`).join('\n')
        const fixMessage = template.replace('{selected_items}', itemsText)

        setHistory(prev => [...prev, { role: 'user', text: `[Auto Fix → Fix] ${fixMessage}` }])
        setAutoFixStage('fixing')
        autoFixStageRef.current = 'fixing'
        setWaiting(true)
        if (projectPath) {
          saveHistoryEntry(projectPath, `codex://${changeId || 'standalone'}`, fixMessage, 'Codex Worker > Auto Fix Cycle').catch(() => {})
        }
        sendToReview(fixMessage)
        return true
      }

      // No trigger matched → treat as fix complete, review again
      setAutoFixMode(false)
      autoFixModeRef.current = false
      setAutoFixStage(null)
      autoFixStageRef.current = null
      setHistory(prev => [...prev, { role: 'assistant', text: '🎉 Auto Fix 完成！' }])
      triggerCelebration()
      return true
    }

    return false
  }, [reviewAgainPrompt, confirmationCardConfig, projectPath, changeId, sendToReview])

  // Hook listener — all callback/ref props are stabilized above.
  const handleAutoFixCycleRef = useRef(handleAutoFixCycle)
  handleAutoFixCycleRef.current = handleAutoFixCycle

  useEffect(() => {
    onStopHookRefStable.current.current = (data: any) => {
      const eventName = data.event || ''
      if (eventName === 'codex-notify') {
        // Capture session_id from any codex event
        const sid = data.session_id || data.payload?.['thread-id'] || data.payload?.thread_id || null
        if (sid && !sessionIdRefStable.current.current) {
          sessionIdRefStable.current.current = sid
          onSessionIdRef.current?.(sid)
          if (bridge) bridge.trackCodexSession(tabId, sid, changeId)
          // Clear pending token — session is now bound, routing uses session_id from here
          if (pendingTokenRef.current) {
            onPendingTokenRef.current?.(null)
            pendingTokenRef.current = null
          }
        }

        // First codex-notify = ping response → mark as ready
        if (!initializedRef.current) {
          initializedRef.current = true
          setInitialized(true)
          setWaiting(false)
          setHistory(prev => [...prev, { role: 'assistant', text: '✓ Codex is ready.' }])
          // CRITICAL: Dequeue from initializing list on successful init
          if (onInitCompleteRef.current) onInitCompleteRef.current()
          return
        }

        // Subsequent events: check if task is complete
        if (isCodexTurnComplete(data)) {
          const finalMessage = extractCodexFinalMessage(data) || '✅ Codex task completed.'
          setHistory(prev => [...prev, { role: 'assistant', text: finalMessage }])
          setWaiting(false)

          // Auto-fix mode: handle cycle automatically
          if (autoFixModeRef.current && handleAutoFixCycleRef.current(finalMessage)) {
            if (onRefreshRef.current) onRefreshRef.current()
            return
          }
          
          // Normal mode: detect scenario and show confirmation card
          if (config.confirmation?.enabled !== false && confirmationCardConfigRef.current) {
            const scenarioKey = detectScenario(finalMessage, confirmationCardConfigRef.current)
            if (scenarioKey !== 'default') {
              setConfirmationData({ text: finalMessage, scenarioKey })
            }
          }
          
          if (onRefreshRef.current) onRefreshRef.current()
        }
      } else if (eventName === 'Stop') {
        // Ignore Stop events from other sessions (broadcast fallback)
        const hookSid = data.session_id || null
        const mySid = sessionIdRefStable.current.current
        if (hookSid && mySid && hookSid !== mySid) return

        const result = data.last_result || '(no response)'
        setHistory(prev => [...prev, { role: 'assistant', text: result }])
        setWaiting(false)

        // Auto-fix mode: handle cycle automatically
        if (autoFixModeRef.current && handleAutoFixCycleRef.current(result)) {
          if (onRefreshRef.current) onRefreshRef.current()
          return
        }
        
        // Normal mode: detect scenario and show confirmation card
        if (config.confirmation?.enabled !== false && confirmationCardConfigRef.current) {
          const scenarioKey = detectScenario(result, confirmationCardConfigRef.current)
          if (scenarioKey !== 'default') {
            setConfirmationData({ text: result, scenarioKey })
          }
        }
        
        if (onRefreshRef.current) onRefreshRef.current()
      }
    }
    return () => { onStopHookRefStable.current.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, changeId, bridge, config.confirmation])

  const shellSingleQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

  const buildCodexStartCommand = useCallback((pendingToken: string) => {
    const tokenEnv = `OPENSPEC_PENDING_TOKEN=${shellSingleQuote(pendingToken)}`
    if (resumeSessionId) {
      const quotedSessionId = shellSingleQuote(resumeSessionId)
      return `${tokenEnv} bash -c 'if typeset -f resume_codex >/dev/null 2>&1; then resume_codex ${quotedSessionId}; else codex resume ${quotedSessionId} "ping"; fi'`
    }
    return `${tokenEnv} bash -c 'if typeset -f start_codex >/dev/null 2>&1; then start_codex; else codex "ping"; fi'`
  }, [resumeSessionId])

  // handleInit
  const handleInit = useCallback(() => {
    if (!bridge || initCalledRef.current) return
    initCalledRef.current = true
    abortedRef.current = false
    setShowInitButton(false)

    // Generate unique pending token for precise session routing
    const token = `${tabId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    pendingTokenRef.current = token
    onPendingTokenRef.current?.(token)

    const isResumeMode = !!resumeSessionId
    setWaiting(true)

    const initMsg = isResumeMode
      ? `[Init] Resuming codex session ${resumeSessionId!.slice(0, 8)}...`
      : '[Init] Starting codex terminal → cd → init script → codex'
    setHistory(prev => [...prev, { role: 'user', text: initMsg }])

    if (isResumeMode) {
      sessionIdRefStable.current.current = resumeSessionId!
      if (onSessionIdRef.current) onSessionIdRef.current(resumeSessionId!)
      if (bridge) bridge.trackCodexSession(tabId, resumeSessionId!, changeId)
    }

    if (!window.__onChangeCommandCallback) window.__onChangeCommandCallback = {}

    const step3_startCodex = () => {
      if (abortedRef.current) return
      setHistory(prev => [...prev, { role: 'assistant', text: '✓ Init script ready (if present). Starting codex with ping...' }])
      window.__onChangeCommandCallback![tabId] = (callbackId: string) => {
        if (abortedRef.current) return
        if (callbackId === `${tabId}-codex`) {
          // Codex prompt detected — wait for ping response via hook
          setHistory(prev => [...prev, { role: 'assistant', text: '✓ Codex started, waiting for ping response...' }])

          // Fallback: if codex-notify hook never fires within 15s, degrade to ready
          // and clean up the pending token so it doesn't block other tabs.
          setTimeout(() => {
            if (abortedRef.current) return
            if (!initializedRef.current) {
              console.warn('[CodexWorkerBase] codex-notify timeout — degrading to ready, cleaning up pending token')
              initializedRef.current = true
              setInitialized(true)
              setWaiting(false)
              setHistory(prev => [...prev, { role: 'assistant', text: '⚠ Codex hook timeout — ready (degraded).' }])
              // Clean up pending token so it doesn't misroute future events
              if (pendingTokenRef.current) {
                onPendingTokenRef.current?.(null)
                pendingTokenRef.current = null
              }
              // Dequeue from initializing list
              if (onInitCompleteRef.current) onInitCompleteRef.current()
            }
          }, 15_000)
        }
      }
      bridge.runChangeCommandWithCallback(tabId, buildCodexStartCommand(token), `${tabId}-codex`, 'droid')
    }

    const step2_sourceReviewCmd = () => {
      if (abortedRef.current) return
      setHistory(prev => [...prev, { role: 'assistant', text: '✓ cd done. Checking .openspec files & sourcing init script...' }])
      window.__onChangeCommandCallback![tabId] = (callbackId: string) => {
        if (abortedRef.current) return
        if (callbackId === `${tabId}-source`) step3_startCodex()
      }
      // Validate critical .openspec files exist, warn if missing, then source init script
      const checkAndSource = [
        // Existence checks with warnings
        'if [ ! -f ./.openspec/codex_init_cmd.sh ]; then echo "⚠ WARNING: .openspec/codex_init_cmd.sh not found — Codex init may not work correctly"; fi',
        'if [ ! -f ./.openspec/codex-notify.sh ]; then echo "⚠ WARNING: .openspec/codex-notify.sh not found — Codex hook notifications will not work"; fi',
        // Source init script (with fallback to legacy path)
        'if [ -f ./.openspec/codex_init_cmd.sh ]; then source ./.openspec/codex_init_cmd.sh; elif [ -f ./openspec/reviewcmd.sh ]; then source ./openspec/reviewcmd.sh; else echo "⚠ No init script found, proceeding without setup"; fi',
      ].join('; ')
      bridge.runChangeCommandWithCallback(
        tabId,
        checkAndSource,
        `${tabId}-source`,
        'shell',
      )
    }

    const step1_cd = () => {
      if (abortedRef.current) return
      if (projectPath) {
        window.__onChangeCommandCallback![tabId] = (callbackId: string) => {
          if (abortedRef.current) return
          if (callbackId === `${tabId}-cd`) step2_sourceReviewCmd()
        }
        bridge.runChangeCommandWithCallback(tabId, `cd ${shellSingleQuote(projectPath)}`, `${tabId}-cd`, 'shell')
      } else {
        step2_sourceReviewCmd()
      }
    }

    window.__onChangeCommandCallback[tabId] = (callbackId: string) => {
      if (abortedRef.current) return
      if (callbackId === `${tabId}-shell-ready`) {
        setHistory(prev => [...prev, { role: 'assistant', text: '✓ Shell ready.' }])
        step1_cd()
      }
    }
    bridge.startChangeTerminal(tabId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, tabId, projectPath, resumeSessionId, changeId, buildCodexStartCommand])

  // Cleanup — deps are intentionally empty: tabId is stable for the lifetime of the component,
  // and bridge is a global singleton. This ensures cleanup runs only on unmount.
  useEffect(() => {
    console.log(`[CodexWorker:${tabId}] ✅ MOUNTED`)
    abortedRef.current = false  // Reset on mount (important for HMR)
    return () => {
      // Only kill terminal if the tab is being explicitly closed by the user.
      // During Vite HMR, components unmount/remount but the tab is not closing —
      // killing the terminal would disrupt running processes.
      const isClosing = window.__closingTabs?.has(tabId)
      console.warn(`[CodexWorker:${tabId}] ❌ UNMOUNTED — isClosing=${isClosing}`, new Error('unmount stack'))
      abortedRef.current = true
      // Clean up pending token
      if (pendingTokenRef.current) {
        onPendingTokenRef.current?.(null)
        pendingTokenRef.current = null
      }
      if (isClosing) {
        const b = window.__nativeBridge
        if (b) {
          b.stopChangeTerminal(tabId)
          b.untrackCodexSession(tabId)
        }
        window.__closingTabs?.delete(tabId)
      }
      // Only clean up callbacks if tab is actually closing (not HMR)
      if (isClosing) {
        if (window.__onChangeCommandCallback) delete window.__onChangeCommandCallback[tabId]
        if (window.__onChangeTerminalOutput) delete window.__onChangeTerminalOutput[tabId]
        if (window.__onChangeTerminalOutputBytes) delete window.__onChangeTerminalOutputBytes[tabId]
        if (window.__onChangeTerminalExit) delete window.__onChangeTerminalExit[tabId]
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-init after all components are mounted
  useEffect(() => {
    if (!bridge) return
    const raf = requestAnimationFrame(() => {
      setTimeout(() => {
        if (!initCalledRef.current && !abortedRef.current) {
          handleInit()
        }
      }, 300)
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge])  // Only depend on bridge, not handleInit

  // Auto-send init prompt after initialized AND ready (config-driven)
  useEffect(() => {
    if (!initialized || waiting || autoPromptSentRef.current) return
    if (!config.autoInitPrompt) return

    autoPromptSentRef.current = true
    const prompt = config.autoInitPrompt.replace('{changeId}', changeId || '')
    setHistory(prev => [...prev, { role: 'user', text: prompt }])
    setWaiting(true)
    if (projectPath) {
      saveHistoryEntry(projectPath, `codex://${changeId || 'standalone'}`, prompt, `Codex Worker (${changeId}) > Auto-init prompt`).catch(() => {})
    }
    sendToReview(prompt)
  }, [initialized, waiting, config.autoInitPrompt, changeId, projectPath, sendToReview])

  if (!bridge) return <div className="panel-empty">Native bridge not available</div>

  // ─── Actions ─────────────────────────────────────────────────────

  const handleSendMessage = () => {
    const trimmed = message.trim()
    if (!trimmed) return
    setHistory(prev => [...prev, { role: 'user', text: trimmed }])
    setMessage('')
    setWaiting(true)
    if (projectPath) saveHistoryEntry(projectPath, `codex://${changeId || 'standalone'}`, trimmed, `Codex Worker > Send`).catch(() => {})
    sendToReview(trimmed)
  }

  const handleStop = () => {
    if (bridge) bridge.writeChangeInput(tabId, '\x03')
    setWaiting(false)
    setStopped(true)
    setHistory(prev => [...prev, { role: 'assistant', text: '⏹ Stopped' }])
  }

  const handleQuickButton = (btn: CodexQuickButton) => {
    // Special actions
    if (btn.action === 'droid_fix') {
      // Show confirmation card if there's recent review data
      if (confirmationData) {
        // Confirmation card is already showing, user should use the card buttons
        return
      }
      // No confirmation data available
      alert('请先执行 Review，然后在确认卡片中选择 Droid Fix')
      return
    }

    if (btn.action === 'auto_fix') {
      // Show confirmation card if there's recent review data
      if (confirmationData) {
        // Confirmation card is already showing, user should use the card buttons
        return
      }
      // No confirmation data available
      alert('请先执行 Review，然后在确认卡片中选择 Auto Fix')
      return
    }

    // Fixed prompt
    if (btn.prompt) {
      setHistory(prev => [...prev, { role: 'user', text: btn.prompt! }])
      setWaiting(true)
      if (projectPath) saveHistoryEntry(projectPath, `codex://${changeId || 'standalone'}`, btn.prompt!, `Codex Worker > ${btn.label}`).catch(() => {})
      sendToReview(btn.prompt!)
      return
    }

    // Template prompt with {input}
    if (btn.promptTemplate) {
      const trimmed = message.trim()
      if (btn.requiresInput && !trimmed) return
      const prompt = btn.promptTemplate.replace('{input}', trimmed)
      setHistory(prev => [...prev, { role: 'user', text: prompt }])
      setMessage('')
      setWaiting(true)
      if (projectPath) saveHistoryEntry(projectPath, `codex://${changeId || 'standalone'}`, prompt, `Codex Worker > ${btn.label}`).catch(() => {})
      sendToReview(prompt)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault()
      if (initialized) handleSendMessage()
    }
  }

  // ─── Confirmation handlers ───────────────────────────────────────

  const handleConfirmationAction = useCallback((action: ButtonAction, selectedItems: string[], button: ConfirmationButton) => {
    if (action === 'cancel') {
      setConfirmationData(null)
      return
    }

    // For droid_fix target, delegate to App via onDroidFixRequest
    if (button.target === 'droid_worker') {
      setConfirmationData(null)
      if (onDroidFixRequestRef.current) {
        onDroidFixRequestRef.current(selectedItems, tabId)
      }
      return
    }

    // Build fix message from template
    const template = button.messageTemplate || config.confirmation?.responseTemplate || '请按选择的评审意见，先思考原因，再解决，再调试通过：\n{selected_items}'
    const itemsText = selectedItems.map(item => `- ${item}`).join('\n')
    const fixMessage = template.replace('{selected_items}', itemsText)

    // Auto Fix mode: enable auto-fix loop
    if (action === 'auto_fix') {
      setAutoFixMode(true)
      autoFixModeRef.current = true
      setAutoFixStage('fixing')
      autoFixStageRef.current = 'fixing'
      setHistory(prev => [...prev, { role: 'user', text: `[Auto Fix 开始] ${fixMessage}` }])
      setConfirmationData(null)
      setWaiting(true)
      if (projectPath) {
        saveHistoryEntry(projectPath, `codex://${changeId || 'standalone'}`, fixMessage, 'Codex Worker > Auto Fix Start').catch(() => {})
      }
      sendToReview(fixMessage)
      return
    }

    // Fix / submit: send in current Codex Worker
    setHistory(prev => [...prev, { role: 'user', text: fixMessage }])
    setConfirmationData(null)
    setWaiting(true)
    if (projectPath) {
      saveHistoryEntry(projectPath, `codex://${changeId || 'standalone'}`, fixMessage, `Codex Worker > ${button.label}`).catch(() => {})
    }
    sendToReview(fixMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.confirmation?.responseTemplate, changeId, projectPath, sendToReview])

  // Check if a message matches a confirmation trigger
  const getScenarioKeyForMessage = useCallback((text: string): string | null => {
    if (!confirmationCardConfig) return null
    const key = detectScenario(text, confirmationCardConfig)
    return key !== 'default' ? key : null
  }, [confirmationCardConfig])

  // ─── Render ──────────────────────────────────────────────────────

  const title = changeId ? `Codex Worker: ${changeId}` : 'Codex Worker'
  const titleSuffix = stopped ? ' (Stopped)' : autoFixMode ? ` [Auto Fix ${autoFixStage === 'fixing' ? '修复中' : '评审中'}...]` : ''

  return (
    <div className="wizard-panel">
      <div className="wizard-panel-header">
        <span className="wizard-panel-title">{title}{titleSuffix}</span>
        {autoFixMode && (
          <button 
            className="btn-stop" 
            onClick={() => {
              setAutoFixMode(false)
              autoFixModeRef.current = false
              setAutoFixStage(null)
              autoFixStageRef.current = null
              setHistory(prev => [...prev, { role: 'assistant', text: '⏹ Auto Fix 已停止' }])
            }}
            style={{ marginLeft: '10px', fontSize: '12px', padding: '4px 8px' }}
          >
            停止 Auto Fix
          </button>
        )}
      </div>

      {/* Init screen */}
      {showInitButton && !initialized && (
        <div className="wizard-init-screen">
          <p>Click the button below to initialize Codex Worker.</p>
          <button className="btn-primary" onClick={handleInit} disabled={waiting}>
            {waiting ? 'Initializing...' : 'Initialize Codex'}
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div className="wizard-history" ref={resultRef}>
          {history.map((h, i) => {
            const scenarioKey = h.role === 'assistant' ? getScenarioKeyForMessage(h.text) : null
            return (
              <div key={i} className={`wizard-msg wizard-msg-${h.role}`}>
                <span className="wizard-msg-role">{h.role === 'user' ? '▶' : '◀'}</span>
                {h.role === 'assistant' && /- \[[ x]\]/i.test(h.text)
                  ? <MarkdownWithCheckbox text={h.text} className="wizard-msg-text" />
                  : <pre className="wizard-msg-text">{h.text}</pre>
                }
                {scenarioKey && (
                  <button
                    className="btn-secondary btn-human-confirm"
                    onClick={() => setConfirmationData({ text: h.text, scenarioKey })}
                    style={{ marginLeft: '8px', fontSize: '11px', padding: '2px 8px', flexShrink: 0 }}
                  >
                    Human
                  </button>
                )}
              </div>
            )
          })}
          {waiting && (
            <div className="wizard-msg wizard-msg-loading">
              <span className="wizard-spinner" />
              <span>{initialized ? 'Codex is working...' : 'Initializing...'}</span>
            </div>
          )}
        </div>
      )}

      <div className="wizard-input-area">
        <label className="dialog-label">Send a message to Codex:</label>
        <textarea
          className="dialog-textarea"
          value={message}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={initialized ? "Type a message to Codex..." : "Initializing Codex..."}
          rows={3}
          disabled={!initialized}
        />
      </div>

      <div className="wizard-actions">
        <div className="wizard-actions-left">
          {config.leftButtons.map((btn, i) => (
            <button
              key={i}
              className="btn-secondary"
              onClick={() => handleQuickButton(btn)}
              disabled={!initialized || waiting || (btn.requiresInput && !message.trim())}
            >
              {btn.label}
            </button>
          ))}
          {waiting && (
            <button className="btn-stop" onClick={handleStop}>⏹ Stop</button>
          )}
        </div>
        <div className="wizard-actions-right">
          {config.rightButtons.map((btn, i) => (
            <button
              key={i}
              className="btn-secondary"
              onClick={() => handleQuickButton(btn)}
              disabled={!initialized || waiting || (btn.requiresInput && !message.trim())}
            >
              {btn.label}
            </button>
          ))}
          <button className="btn-primary" onClick={handleSendMessage} disabled={!initialized || !message.trim() || waiting}>
            Send →
          </button>
        </div>
      </div>

      {/* Human Confirmation Card */}
      {confirmationData && (
        <HumanConfirmationCard
          text={confirmationData.text}
          scenario={confirmationCardConfig?.scenarios[confirmationData.scenarioKey]}
          onAction={handleConfirmationAction}
        />
      )}
    </div>
  )
}
