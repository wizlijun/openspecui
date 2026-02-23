import { useState, useCallback, useRef, useEffect } from 'react'
import { saveHistoryEntry } from './inputHistoryService'
import { MarkdownWithCheckbox } from './MarkdownWithCheckbox'
import { HumanConfirmationCard } from './HumanConfirmationCard'
import type { ConfirmationCardConfig, ConfirmationButton, ButtonAction } from './loadConfirmationCardConfig'
import { detectScenario } from './loadConfirmationCardConfig'

const MAX_HISTORY = 200

function cappedHistory<T>(prev: T[], ...items: T[]): T[] {
  const next = [...prev, ...items]
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next
}

// ─── Types ─────────────────────────────────────────────────────────

export type CodexWorkerMode = 'standalone' | 'code_review'

export interface CodexQuickButton {
  label: string
  role?: string
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
  /** Auto-init prompt from YAML config; may contain {changeId} placeholder */
  autoInitPrompt?: string | null
  leftButtons: CodexQuickButton[]
  rightButtons: CodexQuickButton[]
  /** Human confirmation card config */
  confirmation?: ConfirmationConfig
}

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
  /** Called when user clicks "Auto Fix" in confirmation card — starts Codex↔Droid auto-fix loop */
  onAutoFixStart?: (selectedItems: string[], codexWorkerId: string) => void
  /** Confirmation card config loaded from .openspec/confirmation_card.yml */
  confirmationCardConfig?: ConfirmationCardConfig
  /** Called when initialization completes (success or timeout) to dequeue from initializing list */
  onInitComplete?: () => void
  /** Register a pending session token for precise routing. Called with (token, tabId) on init, (null, tabId) on bind/cleanup. */
  onPendingToken?: (token: string | null) => void
  /** Ref for external trigger to re-review after Droid fix completes (used by App for Auto Fix loop).
   *  Returns true if review was successfully triggered, false on failure (not initialized, button missing, etc.) */
  onTriggerReReviewRef?: React.MutableRefObject<(() => boolean) | null>
  /** Ref for external injection of status messages into Codex history (used by App for Auto Fix status) */
  onPushHistoryRef?: React.MutableRefObject<((msg: string) => void) | null>
  /** Ref for external dismissal of confirmation card (used by Auto Fix window) */
  onDismissConfirmationRef?: React.MutableRefObject<(() => void) | null>
  /** Ref for external message sending (used by Self-Review Cycle window) */
  onSendMessageRef?: React.MutableRefObject<((message: string) => boolean) | null>
  /** Called when Auto Fix review completes — passes review result text to App for P0/P1 analysis */
  onAutoFixReviewComplete?: (resultText: string, codexWorkerId: string) => void
  /** Whether this Codex Worker is in Auto Fix mode (controlled by App) */
  autoFixActive?: boolean
  /** Current Auto Fix stage (controlled by App) */
  autoFixStage?: 'fixing' | 'reviewing' | null
  /** Called when user clicks "停止 Auto Fix" button */
  onAutoFixStop?: (codexWorkerId: string) => void
  /** Auto-initialize without user clicking the Init button (used by Self-Review Cycle) */
  autoInit?: boolean
  /** Suppress auto-sending config.autoInitPrompt after init (used by Self-Review Cycle which sends its own prompt) */
  suppressAutoInitPrompt?: boolean
}

// ─── Component ─────────────────────────────────────────────────────

export function CodexWorkerBase({
  tabId, changeId, resumeSessionId, projectPath, config,
  onStopHookRef, onRefresh, sessionIdRef, onSessionId, onBusyChange,
  onDroidFixRequest, onAutoFixStart, confirmationCardConfig, onInitComplete, onPendingToken,
  onTriggerReReviewRef, onPushHistoryRef, onDismissConfirmationRef, onSendMessageRef, onAutoFixReviewComplete, autoFixActive, autoFixStage, onAutoFixStop,
  autoInit, suppressAutoInitPrompt,
}: CodexWorkerBaseProps) {
  // ─── HMR State Persistence ─────────────────────────────────────────
  // Store worker state in window to survive HMR unmount/remount
  if (!window.__workerStates) window.__workerStates = {}
  const savedState = window.__workerStates[tabId]
  
  const [message, setMessage] = useState('')
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>(
    savedState?.history || []
  )
  const [waiting, setWaiting] = useState(savedState?.waiting || false)
  const [stopped, setStopped] = useState(savedState?.stopped || false)
  const [initialized, setInitialized] = useState(savedState?.initialized || false)
  const [showInitButton, setShowInitButton] = useState(savedState?.showInitButton ?? true)
  const [confirmationData, setConfirmationData] = useState<{ text: string; scenarioKey: string } | null>(null)
  // Remove internal autoFixMode and autoFixStage - now controlled by App via props
  const initCalledRef = useRef(savedState?.initCalledRef || false)
  const initializedRef = useRef(savedState?.initializedRef || false)
  const autoPromptSentRef = useRef(savedState?.autoPromptSentRef || false)
  /** Tracks whether the first Review has been sent (to distinguish Review vs Review Again) */
  const reviewSentRef = useRef(savedState?.reviewSentRef || false)
  const waitingRef = useRef(false)
  const abortedRef = useRef(false)
  const resultRef = useRef<HTMLDivElement>(null)
  
  // Save state to window on every change (for HMR recovery) — debounced to reduce overhead
  const workerStateSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (workerStateSaveTimerRef.current) clearTimeout(workerStateSaveTimerRef.current)
    workerStateSaveTimerRef.current = setTimeout(() => {
      if (window.__workerStates) {
        window.__workerStates[tabId] = {
          history,
          waiting,
          stopped,
          initialized,
          showInitButton,
          initCalledRef: initCalledRef.current,
          initializedRef: initializedRef.current,
          autoPromptSentRef: autoPromptSentRef.current,
          reviewSentRef: reviewSentRef.current,
        }
      }
    }, 500)
    return () => { if (workerStateSaveTimerRef.current) clearTimeout(workerStateSaveTimerRef.current) }
  }, [tabId, history, waiting, stopped, initialized, showInitButton])

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
  const onAutoFixStartRef = useRef(onAutoFixStart)
  onAutoFixStartRef.current = onAutoFixStart
  const onTriggerReReviewRefStable = useRef(onTriggerReReviewRef)
  onTriggerReReviewRefStable.current = onTriggerReReviewRef
  const onPushHistoryRefStable = useRef(onPushHistoryRef)
  onPushHistoryRefStable.current = onPushHistoryRef
  const onDismissConfirmationRefStable = useRef(onDismissConfirmationRef)
  onDismissConfirmationRefStable.current = onDismissConfirmationRef
  const onSendMessageRefStable = useRef(onSendMessageRef)
  onSendMessageRefStable.current = onSendMessageRef
  const onAutoFixReviewCompleteRef = useRef(onAutoFixReviewComplete)
  onAutoFixReviewCompleteRef.current = onAutoFixReviewComplete
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
    waitingRef.current = waiting
    onBusyChangeRef.current?.(waiting)
  }, [waiting])

  // Terminal helpers (defined before hook listener so it can reference sendToReview)
  const sendToReview = useCallback((text: string) => {
    if (bridge) {
      bridge.writeChangeInput(tabId, text)
      setTimeout(() => bridge.writeChangeInput(tabId, '\r'), 200)
    }
  }, [bridge, tabId])

  // Register onTriggerReReviewRef: allows App/Self-Review Cycle to externally trigger a review.
  // First call uses "Review" button, subsequent calls use "Review Again" button.
  const handleQuickButtonRef = useRef<((btn: CodexQuickButton) => boolean) | null>(null)
  useEffect(() => {
    const ref = onTriggerReReviewRefStable.current
    if (ref) {
      ref.current = (): boolean => {
        if (!initializedRef.current) {
          console.warn(`[CodexWorkerBase] triggerReReview failed: not initialized (tab=${tabId})`)
          return false
        }
        if (waitingRef.current) {
          console.warn(`[CodexWorkerBase] triggerReReview failed: worker is busy (tab=${tabId})`)
          return false
        }
        // Choose button based on whether first review has been sent:
        // - First time: use "review" role button
        // - Subsequent: use "review_again" role button
        // Fallback to label match for backward compatibility with YAML configs without role
        let reviewButton: CodexQuickButton | undefined
        let usedFallback = false
        if (!reviewSentRef.current) {
          reviewButton = config.leftButtons.find(b => b.role === 'review')
          if (!reviewButton) {
            reviewButton = config.leftButtons.find(b => b.label === 'Review')
            if (reviewButton) usedFallback = true
          }
          if (!reviewButton) {
            reviewButton = config.leftButtons.find(b => b.role === 'review_again')
              || config.leftButtons.find(b => b.label === 'Review Again')
            if (reviewButton) {
              console.warn(`[CodexWorkerBase:${tabId}] First review using 'review_again' button because 'review' role not found`)
              usedFallback = true
            }
          }
        } else {
          reviewButton = config.leftButtons.find(b => b.role === 'review_again')
          if (!reviewButton) {
            reviewButton = config.leftButtons.find(b => b.label === 'Review Again')
            if (reviewButton) usedFallback = true
          }
          if (!reviewButton) {
            reviewButton = config.leftButtons.find(b => b.role === 'review')
              || config.leftButtons.find(b => b.label === 'Review')
            if (reviewButton) {
              console.warn(`[CodexWorkerBase:${tabId}] Subsequent review using 'review' button because 'review_again' role not found`)
              usedFallback = true
            }
          }
        }
        if (usedFallback && reviewButton && !reviewButton.role) {
          console.warn(`[CodexWorkerBase:${tabId}] Using button with label '${reviewButton.label}' (no role) — consider adding role field to YAML config`)
        }
        if (reviewButton && handleQuickButtonRef.current) {
          const sent = handleQuickButtonRef.current(reviewButton)
          if (sent) reviewSentRef.current = true
          return sent
        }
        // Fallback to auto_init_prompt (supports {changeId} substitution)
        if (config.autoInitPrompt) {
          const prompt = config.autoInitPrompt.replace('{changeId}', changeId || '')
          setHistory(prev => cappedHistory(prev, { role: 'user', text: prompt }))
          setWaiting(true)
          sendToReview(prompt)
          reviewSentRef.current = true
          return true
        }
        console.warn(`[CodexWorkerBase] triggerReReview failed: no Review button and no autoInitPrompt found (tab=${tabId})`)
        return false
      }
    }
    return () => {
      const r = onTriggerReReviewRefStable.current
      if (r) r.current = null
    }
  }, [config.autoInitPrompt, config.leftButtons, tabId, changeId, sendToReview])

  // Register onPushHistoryRef: allows App to inject status messages into Codex history
  useEffect(() => {
    const ref = onPushHistoryRefStable.current
    if (ref) {
      ref.current = (msg: string) => {
        setHistory(prev => cappedHistory(prev, { role: 'assistant', text: msg }))
      }
    }
    return () => {
      const r = onPushHistoryRefStable.current
      if (r) r.current = null
    }
  }, [])

  // Register onDismissConfirmationRef: allows App to dismiss the confirmation card
  useEffect(() => {
    const ref = onDismissConfirmationRefStable.current
    if (ref) {
      ref.current = () => {
        setConfirmationData(null)
      }
    }
    return () => {
      const r = onDismissConfirmationRefStable.current
      if (r) r.current = null
    }
  }, [])

  // Register onSendMessageRef: allows Self-Review Cycle window to send messages
  useEffect(() => {
    const ref = onSendMessageRefStable.current
    if (ref) {
      ref.current = (message: string) => {
        if (waiting || !initialized) {
          console.warn(`[CodexWorkerBase:${tabId}] sendMessage rejected — busy or not initialized`)
          return false
        }
        setHistory(prev => cappedHistory(prev, { role: 'user', text: message }))
        setWaiting(true)
        sendToReview(message)
        return true
      }
    }
    return () => {
      const r = onSendMessageRefStable.current
      if (r) r.current = null
    }
  }, [waiting, initialized, sendToReview, tabId])

  // Hook listener — all callback/ref props are stabilized above.
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
          setHistory(prev => cappedHistory(prev, { role: 'assistant', text: '✓ Codex is ready.' }))
          // CRITICAL: Dequeue from initializing list on successful init
          if (onInitCompleteRef.current) onInitCompleteRef.current()
          return
        }

        // Subsequent events: check if task is complete
        if (isCodexTurnComplete(data)) {
          const finalMessage = extractCodexFinalMessage(data) || '✅ Codex task completed.'
          setHistory(prev => cappedHistory(prev, { role: 'assistant', text: finalMessage }))
          setWaiting(false)

          // Auto-fix mode (reviewing stage): notify App with review result
          // Only route to auto-fix handler when in reviewing stage; otherwise fall through to normal handling
          if (autoFixActive && autoFixStage === 'reviewing' && onAutoFixReviewCompleteRef.current) {
            onAutoFixReviewCompleteRef.current(finalMessage, tabId)
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
        setHistory(prev => cappedHistory(prev, { role: 'assistant', text: result }))
        setWaiting(false)

        // Auto-fix mode (reviewing stage): notify App with review result
        // Only route to auto-fix handler when in reviewing stage; otherwise fall through to normal handling
        if (autoFixActive && autoFixStage === 'reviewing' && onAutoFixReviewCompleteRef.current) {
          onAutoFixReviewCompleteRef.current(result, tabId)
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
  }, [tabId, changeId, bridge, config.confirmation, autoFixActive, autoFixStage])

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
    setHistory(prev => cappedHistory(prev, { role: 'user', text: initMsg }))

    if (isResumeMode) {
      sessionIdRefStable.current.current = resumeSessionId!
      if (onSessionIdRef.current) onSessionIdRef.current(resumeSessionId!)
      if (bridge) bridge.trackCodexSession(tabId, resumeSessionId!, changeId)
    }

    if (!window.__onChangeCommandCallback) window.__onChangeCommandCallback = {}

    const step3_startCodex = () => {
      if (abortedRef.current) return
      setHistory(prev => cappedHistory(prev, { role: 'assistant', text: '✓ Init script ready (if present). Starting codex with ping...' }))
      window.__onChangeCommandCallback![tabId] = (callbackId: string) => {
        if (abortedRef.current) return
        if (callbackId === `${tabId}-codex`) {
          // Codex prompt detected — wait for ping response via hook
          setHistory(prev => cappedHistory(prev, { role: 'assistant', text: '✓ Codex started, waiting for ping response...' }))

          // Fallback: if codex-notify hook never fires within 120s, fail and require re-init.
          // Clean up the pending token so it doesn't block other tabs.
          setTimeout(() => {
            if (abortedRef.current) return
            if (!initializedRef.current) {
              console.warn('[CodexWorkerBase] codex-notify timeout (120s) — init failed, requiring re-init')
              // Reset init state so user can retry
              initCalledRef.current = false
              setInitialized(false)
              setWaiting(false)
              setShowInitButton(true)
              setHistory(prev => cappedHistory(prev, { role: 'assistant', text: '❌ Codex hook timeout (120s) — initialization failed. Please click "Initialize Codex" to retry.' }))
              // Clean up pending token so it doesn't misroute future events
              if (pendingTokenRef.current) {
                onPendingTokenRef.current?.(null)
                pendingTokenRef.current = null
              }
              // Stop the terminal to clean up resources
              if (bridge) {
                bridge.stopChangeTerminal(tabId)
                bridge.untrackCodexSession(tabId)
              }
              sessionIdRefStable.current.current = null
              // Dequeue from initializing list
              if (onInitCompleteRef.current) onInitCompleteRef.current()
            }
          }, 120_000)
        }
      }
      bridge.runChangeCommandWithCallback(tabId, buildCodexStartCommand(token), `${tabId}-codex`, 'droid')
    }

    const step2_sourceReviewCmd = () => {
      if (abortedRef.current) return
      setHistory(prev => cappedHistory(prev, { role: 'assistant', text: '✓ cd done. Checking .openspec files & sourcing init script...' }))
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
        setHistory(prev => cappedHistory(prev, { role: 'assistant', text: '✓ Shell ready.' }))
        step1_cd()
      }
    }
    bridge.startChangeTerminal(tabId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, tabId, projectPath, resumeSessionId, changeId, buildCodexStartCommand])

  // Cleanup — deps are intentionally empty: tabId is stable for the lifetime of the component,
  // and bridge is a global singleton. This ensures cleanup runs only on unmount.
  useEffect(() => {
    console.log(`[CodexWorker:${tabId}] ✅ MOUNTED, changeId=${changeId}, resumeSessionId=${resumeSessionId}`)
    abortedRef.current = false  // Reset on mount (important for HMR)
    return () => {
      const isClosing = window.__closingTabs?.has(tabId)
      console.warn(`[CodexWorker:${tabId}] ❌ UNMOUNTED — isClosing=${isClosing}, closingTabs=${JSON.stringify([...(window.__closingTabs || [])])}`)
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
        // Clean up HMR state persistence
        if (window.__workerStates) delete window.__workerStates[tabId]
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-init after all components are mounted (unless autoInit is explicitly false)
  useEffect(() => {
    if (!bridge || autoInit === false) return
    const raf = requestAnimationFrame(() => {
      setTimeout(() => {
        if (!initCalledRef.current && !abortedRef.current) {
          handleInit()
        }
      }, 300)
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, autoInit])  // Only depend on bridge and autoInit, not handleInit

  // ─── Confirmation handlers ───────────────────────────────────────
  // NOTE: useCallback must be declared before the early return to maintain
  // consistent hook call order across renders (Rules of Hooks).

  const handleConfirmationAction = useCallback((action: ButtonAction, selectedItems: string[], button: ConfirmationButton) => {
    if (action === 'cancel') {
      setConfirmationData(null)
      return
    }

    // Auto Fix mode: delegate to App via onAutoFixStart (starts Codex↔Droid loop)
    // CRITICAL: Check action before target — auto_fix may have target 'droid_worker' or 'current',
    // but must always go through the Auto Fix state machine, not the plain Droid Fix path.
    if (action === 'auto_fix') {
      setConfirmationData(null)
      if (onAutoFixStartRef.current) {
        onAutoFixStartRef.current(selectedItems, tabId)
      }
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
    const template = button.messageTemplate || config.confirmation?.responseTemplate
    if (!template) {
      console.error('[CodexWorkerBase] No message template found for confirmation action')
      return
    }
    const itemsText = selectedItems.map(item => `- ${item}`).join('\n')
    const fixMessage = template.replace('{selected_items}', itemsText)

    // Fix / submit: send in current Codex Worker
    setHistory(prev => cappedHistory(prev, { role: 'user', text: fixMessage }))
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

  // ─── handleQuickButton (must be before auto-review useEffect) ────
  const handleQuickButton = useCallback((btn: CodexQuickButton): boolean => {
    // Special actions
    if (btn.action === 'droid_fix') {
      // Show confirmation card if there's recent review data
      if (confirmationData) {
        // Confirmation card is already showing, user should use the card buttons
        return false
      }
      // No confirmation data available
      alert('请先执行 Review，然后在确认卡片中选择 Droid Fix')
      return false
    }

    if (btn.action === 'auto_fix') {
      // Show confirmation card if there's recent review data
      if (confirmationData) {
        // Confirmation card is already showing, user should use the card buttons
        return false
      }
      // No confirmation data available
      alert('请先执行 Review，然后在确认卡片中选择 Auto Fix')
      return false
    }

    // Fixed prompt
    if (btn.prompt) {
      const resolvedPrompt = btn.prompt.replace('{changeId}', changeId || '')
      setHistory(prev => cappedHistory(prev, { role: 'user', text: resolvedPrompt }))
      setWaiting(true)
      if (projectPath) saveHistoryEntry(projectPath, `codex://${changeId || 'standalone'}`, resolvedPrompt, `Codex Worker > ${btn.label}`).catch(() => {})
      sendToReview(resolvedPrompt)
      return true
    }

    // Template prompt with {input}
    if (btn.promptTemplate) {
      const trimmed = message.trim()
      if (btn.requiresInput && !trimmed) return false
      const prompt = btn.promptTemplate.replace('{input}', trimmed)
      setHistory(prev => cappedHistory(prev, { role: 'user', text: prompt }))
      setMessage('')
      setWaiting(true)
      if (projectPath) saveHistoryEntry(projectPath, `codex://${changeId || 'standalone'}`, prompt, `Codex Worker > ${btn.label}`).catch(() => {})
      sendToReview(prompt)
      return true
    }

    // No action taken
    return false
  }, [confirmationData, message, projectPath, changeId, sendToReview])

  // Assign handleQuickButton to ref for use in onTriggerReReviewRef
  handleQuickButtonRef.current = handleQuickButton

  // Auto-click Review button after initialized (for code_review mode)
  // Skip if suppressAutoInitPrompt is true (used by Self-Review Cycle which sends its own prompt)
  useEffect(() => {
    if (!initialized || waiting || autoPromptSentRef.current || suppressAutoInitPrompt) return
    if (config.mode !== 'code_review') return
    
    // Prefer clicking the "review" role button (supports {changeId} substitution in handleQuickButton)
    // Fallback to label match for backward compatibility
    const reviewButton = config.leftButtons.find(b => b.role === 'review')
      || config.leftButtons.find(b => b.label === 'Review')
    if (reviewButton) {
      const sent = handleQuickButton(reviewButton)
      if (sent) {
        autoPromptSentRef.current = true
        reviewSentRef.current = true
      }
      return
    }
    
    // Fallback: use auto_init_prompt directly (supports {changeId} substitution)
    if (config.autoInitPrompt) {
      const prompt = config.autoInitPrompt.replace('{changeId}', changeId || '')
      setHistory(prev => cappedHistory(prev, { role: 'user', text: prompt }))
      setWaiting(true)
      if (projectPath) saveHistoryEntry(projectPath, `codex://${changeId || 'standalone'}`, prompt, 'Codex Worker > Auto Init').catch(() => {})
      sendToReview(prompt)
      autoPromptSentRef.current = true
      reviewSentRef.current = true
      return
    }
    
    // Last fallback: find "review_again" role button (with label fallback)
    const reviewAgainButton = config.leftButtons.find(b => b.role === 'review_again')
      || config.leftButtons.find(b => b.label === 'Review Again')
    if (reviewAgainButton) {
      const sent = handleQuickButton(reviewAgainButton)
      if (sent) {
        autoPromptSentRef.current = true
        reviewSentRef.current = true
      }
    }
  }, [initialized, waiting, config.mode, config.autoInitPrompt, config.leftButtons, suppressAutoInitPrompt, changeId, projectPath, sendToReview, handleQuickButton])

  if (!bridge) return <div className="panel-empty">Native bridge not available</div>

  // ─── Actions ─────────────────────────────────────────────────────

  const handleSendMessage = () => {
    const trimmed = message.trim()
    if (!trimmed) return
    setHistory(prev => cappedHistory(prev, { role: 'user', text: trimmed }))
    setMessage('')
    setWaiting(true)
    if (projectPath) saveHistoryEntry(projectPath, `codex://${changeId || 'standalone'}`, trimmed, `Codex Worker > Send`).catch(() => {})
    sendToReview(trimmed)
  }

  const handleStop = () => {
    if (bridge) bridge.writeChangeInput(tabId, '\x03')
    setWaiting(false)
    setStopped(true)
    setHistory(prev => cappedHistory(prev, { role: 'assistant', text: '⏹ Stopped' }))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault()
      if (initialized) handleSendMessage()
    }
  }

  // ─── Render ──────────────────────────────────────────────────────

  const title = changeId ? `Codex Worker: ${changeId}` : 'Codex Worker'
  const titleSuffix = stopped ? ' (Stopped)' : ''

  return (
    <div className="wizard-panel">
      <div className="wizard-panel-header">
        <span className="wizard-panel-title">{title}{titleSuffix}</span>
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
          {autoFixActive && onAutoFixStop && (
            <button className="btn-stop" onClick={() => onAutoFixStop(tabId)} style={{ marginLeft: '8px' }}>
              ⏹ Stop Auto Fix
            </button>
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
