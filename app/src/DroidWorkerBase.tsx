import { useState, useCallback, useRef, useEffect } from 'react'
import { saveHistoryEntry } from './inputHistoryService'
import { MarkdownWithCheckbox } from './MarkdownWithCheckbox'
import { HumanConfirmationCard } from './HumanConfirmationCard'
import type { ConfirmationCardConfig, ButtonAction } from './loadConfirmationCardConfig'
import { detectScenario } from './loadConfirmationCardConfig'

const MAX_HISTORY = 200

function cappedHistory<T>(prev: T[], ...items: T[]): T[] {
  const next = [...prev, ...items]
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next
}

// ─── Types ─────────────────────────────────────────────────────────

export type WorkerMode = 'new_change' | 'continue_change' | 'fix_review'

export interface QuickButton {
  label: string
  role?: string
  /** Fixed prompt to send (mutually exclusive with promptTemplate) */
  prompt?: string
  /** Template with {input} placeholder — uses textarea content */
  promptTemplate?: string
  /** Special action name instead of sending prompt */
  action?: string
  /** Whether the button requires non-empty textarea input */
  requiresInput?: boolean
}

export interface ConfirmationConfig {
  enabled?: boolean
  responseTemplate?: string
}

export interface DroidWorkerConfig {
  mode: WorkerMode
  name: string
  /** Prompt to auto-send after init completes. Supports {changeId} placeholder. */
  autoInitPrompt?: string | null
  /** Buttons on the left side (below history) */
  leftButtons: QuickButton[]
  /** Buttons on the right side (before Send button) */
  rightButtons: QuickButton[]
  /** Human confirmation card config */
  confirmation?: ConfirmationConfig
}

// ─── Props ─────────────────────────────────────────────────────────

export interface DroidWorkerBaseProps {
  tabId: string
  changeId?: string
  resumeSessionId?: string
  projectPath: string | undefined
  config: DroidWorkerConfig
  onStopHookRef: React.MutableRefObject<((data: any) => void) | null>
  onRefresh: () => void
  resetKey?: number
  sessionIdRef: React.MutableRefObject<string | null>
  onSessionId?: (id: string) => void
  onBusyChange?: (busy: boolean) => void
  /** Called when "Review" action button is clicked */
  onReviewAction?: (changeId: string) => void
  /** Ref for external message injection (used by App for Droid Fix from Codex Worker). Returns true if sent successfully. */
  onSendMessageRef?: React.MutableRefObject<((message: string) => boolean) | null>
  /** Auto-send this message after Droid Worker is initialized (for fix_review mode) */
  autoSendMessage?: string
  /** Confirmation card config loaded from .openspec/confirmation_card.yml */
  confirmationCardConfig?: ConfirmationCardConfig
  /** Called when Droid Worker completes a fix task (used by App for Auto Fix loop) */
  onFixComplete?: (droidWorkerId: string) => void
  /** Called when autoSendMessage is successfully sent (used by App to activate deferred Auto Fix) */
  onAutoSendComplete?: (droidWorkerId: string) => void
  /** Called when autoSendMessage fails to send (used by App to clean up pending Auto Fix state) */
  onAutoSendFailed?: (droidWorkerId: string) => void
  /** Ref for external trigger to paste items into input and click Fix button.
   *  Called with items text; returns true if Fix was triggered successfully. */
  onTriggerFixRef?: React.MutableRefObject<((itemsText: string) => boolean) | null>
}

// ─── Component ─────────────────────────────────────────────────────

export function DroidWorkerBase({
  tabId, changeId, resumeSessionId, projectPath, config,
  onStopHookRef, onRefresh, resetKey, sessionIdRef, onSessionId, onBusyChange,
  onReviewAction, onSendMessageRef, autoSendMessage, confirmationCardConfig,
  onFixComplete, onAutoSendComplete, onAutoSendFailed, onTriggerFixRef,
}: DroidWorkerBaseProps) {
  // ─── HMR State Persistence ─────────────────────────────────────────
  // Store worker state in window to survive HMR unmount/remount
  if (!window.__workerStates) window.__workerStates = {}
  const savedState = window.__workerStates[tabId]
  
  const [message, setMessage] = useState('')
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>(
    savedState?.history || []
  )
  const [waiting, setWaiting] = useState(savedState?.waiting || false)
  const [initialized, setInitialized] = useState(savedState?.initialized || false)
  const [showInitButton, setShowInitButton] = useState(savedState?.showInitButton ?? true)
  const [confirmationData, setConfirmationData] = useState<{ text: string; scenarioKey: string } | null>(null)
  const initializedRef = useRef(savedState?.initializedRef || false)
  const initCalledRef = useRef(savedState?.initCalledRef || false)
  const autoPromptSentRef = useRef(savedState?.autoPromptSentRef || false)
  const autoSendMessageSentRef = useRef(savedState?.autoSendMessageSentRef || false)
  const resultRef = useRef<HTMLDivElement>(null)
  const handleSendMessageRef = useRef<(() => void) | null>(null)
  const handleQuickButtonRef = useRef<((btn: QuickButton, overrideInput?: string) => boolean) | null>(null)
  const pendingMessageRef = useRef<string | null>(null)  // Store message to send, avoiding closure issues
  
  // Save state to window on every change (for HMR recovery) — debounced to reduce overhead
  const workerStateSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (workerStateSaveTimerRef.current) clearTimeout(workerStateSaveTimerRef.current)
    workerStateSaveTimerRef.current = setTimeout(() => {
      if (window.__workerStates) {
        window.__workerStates[tabId] = {
          history,
          waiting,
          initialized,
          showInitButton,
          initializedRef: initializedRef.current,
          initCalledRef: initCalledRef.current,
          autoPromptSentRef: autoPromptSentRef.current,
          autoSendMessageSentRef: autoSendMessageSentRef.current,
        }
      }
    }, 500)
    return () => { if (workerStateSaveTimerRef.current) clearTimeout(workerStateSaveTimerRef.current) }
  }, [tabId, history, waiting, initialized, showInitButton])

  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh
  const onSessionIdRef = useRef(onSessionId)
  onSessionIdRef.current = onSessionId
  const confirmationCardConfigRef = useRef(confirmationCardConfig)
  confirmationCardConfigRef.current = confirmationCardConfig
  const onBusyChangeRef = useRef(onBusyChange)
  onBusyChangeRef.current = onBusyChange
  const onStopHookRefStable = useRef(onStopHookRef)
  onStopHookRefStable.current = onStopHookRef
  const onSendMessageRefStable = useRef(onSendMessageRef)
  onSendMessageRefStable.current = onSendMessageRef
  const sessionIdRefStable = useRef(sessionIdRef)
  sessionIdRefStable.current = sessionIdRef
  const onReviewActionRef = useRef(onReviewAction)
  onReviewActionRef.current = onReviewAction
  const onFixCompleteRef = useRef(onFixComplete)
  onFixCompleteRef.current = onFixComplete
  const onAutoSendCompleteRef = useRef(onAutoSendComplete)
  onAutoSendCompleteRef.current = onAutoSendComplete
  const onAutoSendFailedRef = useRef(onAutoSendFailed)
  onAutoSendFailedRef.current = onAutoSendFailed
  const onTriggerFixRefStable = useRef(onTriggerFixRef)
  onTriggerFixRefStable.current = onTriggerFixRef
  // Track waiting state via ref for reliable access inside hook closures
  const waitingRef = useRef(false)
  // Unique task ID per submitted message — used to correlate Stop events with
  // the task that triggered them, preventing spurious onFixComplete calls from
  // manual Stop or timing jitter.
  const taskIdRef = useRef<string | null>(null)

  const bridge = window.__nativeBridge

  // Reset when resetKey changes
  const prevResetKeyRef = useRef<number | undefined>(resetKey)
  useEffect(() => {
    if (resetKey !== undefined && prevResetKeyRef.current !== resetKey) {
      prevResetKeyRef.current = resetKey
      setMessage('')
      setHistory([])
      setWaiting(false)
      setInitialized(false)
      setShowInitButton(true)
      initializedRef.current = false
      initCalledRef.current = false
      autoPromptSentRef.current = false
      autoSendMessageSentRef.current = false
      taskIdRef.current = null
      sessionIdRefStable.current.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

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

  useEffect(() => {
    onStopHookRefStable.current.current = (data: any) => {
      const eventName = data.event || ''

      if (eventName === 'SessionStart') {
        if (initializedRef.current) return
        if (!data.session_id) {
          // No session_id — cannot safely bind; wait for a proper SessionStart
          console.warn(`[DroidWorkerBase:${tabId}] SessionStart without session_id, ignoring`)
          return
        }
        sessionIdRefStable.current.current = data.session_id
        if (onSessionIdRef.current) onSessionIdRef.current(data.session_id)
        if (bridge) bridge.trackChangeSession(tabId, data.session_id, changeId)
        initializedRef.current = true
        setInitialized(true)
        setWaiting(false)
        setHistory(prev => cappedHistory(prev, { role: 'assistant', text: '✓ Droid Ready' }))
        return
      }

      if (eventName === 'Stop') {
        // Ignore Stop events from other sessions (broadcast fallback)
        const hookSid = data.session_id || null
        const mySid = sessionIdRefStable.current.current
        if (hookSid && mySid && hookSid !== mySid) return

        const result = data.last_result || '(no response)'
        setHistory(prev => cappedHistory(prev, { role: 'assistant', text: result }))

        // Capture task ID and waiting state before resetting, then synchronously
        // clear both refs so duplicate Stop events are no-ops.
        const wasWaiting = waitingRef.current
        const completedTaskId = taskIdRef.current
        waitingRef.current = false
        taskIdRef.current = null
        setWaiting(false)

        // Only notify App of fix completion if:
        // 1. Droid was actually processing a task (wasWaiting)
        // 2. There was a valid task ID (rules out manual Stop which clears taskIdRef)
        if (wasWaiting && completedTaskId && onFixCompleteRef.current) {
          onFixCompleteRef.current(tabId)
        }

        // Detect scenario from config triggers (use ref to avoid stale closure)
        if (config.confirmation?.enabled !== false && confirmationCardConfigRef.current) {
          const scenarioKey = detectScenario(result, confirmationCardConfigRef.current)
          if (scenarioKey !== 'default') {
            setConfirmationData({ text: result, scenarioKey })
          }
        }

        if (onRefreshRef.current) onRefreshRef.current()
        return
      }
    }
    return () => { onStopHookRefStable.current.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, bridge, changeId, config.confirmation])

  // Terminal helpers
  const writeToTerminal = useCallback((text: string) => {
    if (bridge) bridge.writeChangeInput(tabId, text)
  }, [bridge, tabId])

  const sendToDroid = useCallback((text: string) => {
    // CRITICAL: Droid CLI truncates long bracketed paste inputs (displays as "... N lines]").
    // For long texts (>500 chars), send directly without bracketed paste mode.
    // Droid will still receive the full text, just without paste mode optimizations.
    if (text.length > 500) {
      // Long text: send directly without bracketed paste
      writeToTerminal(text)
      setTimeout(() => writeToTerminal('\r'), 100)
      setTimeout(() => writeToTerminal('\r'), 300)
    } else {
      // Short text: use bracketed paste mode for better handling
      writeToTerminal(`\x1b[200~${text}\x1b[201~`)
      setTimeout(() => writeToTerminal('\r'), 100)
      setTimeout(() => writeToTerminal('\r'), 300)
    }
  }, [writeToTerminal])

  // Register sendMessage function for external injection (Droid Fix from Codex Worker)
  // Guard: only send when Droid is initialized and has a session, otherwise the
  // command would fall through to the raw shell instead of the Droid REPL.
  // Instead of sending directly, paste into input box and trigger send via UI path.

  useEffect(() => {
    const ref = onSendMessageRefStable.current
    if (ref) {
      ref.current = (msg: string): boolean => {
        if (!initializedRef.current || !sessionIdRefStable.current.current) {
          console.warn(`[DroidWorkerBase:${tabId}] sendMessage rejected — Droid not ready (initialized=${initializedRef.current}, session=${sessionIdRefStable.current.current || 'none'})`)
          alert('Droid Worker 尚未就绪，请稍后重试')
          return false
        }
        // Store message in ref to avoid closure issues
        pendingMessageRef.current = msg
        // Paste message into input box
        setMessage(msg)
        // Trigger send on next tick after React flushes the state update
        setTimeout(() => {
          handleSendMessageRef.current?.()
        }, 50)
        return true
      }
    }
    return () => {
      const r = onSendMessageRefStable.current
      if (r) {
        r.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeId, projectPath, sendToDroid, tabId])

  // Register onTriggerFixRef: allows App/Self-Review Cycle to paste items into input
  // and simulate clicking the "Fix" button (which wraps items with its promptTemplate).
  useEffect(() => {
    const ref = onTriggerFixRefStable.current
    if (ref) {
      ref.current = (itemsText: string): boolean => {
        if (!initializedRef.current || !sessionIdRefStable.current.current) {
          console.warn(`[DroidWorkerBase:${tabId}] triggerFix rejected — Droid not ready`)
          return false
        }
        if (waitingRef.current) {
          console.warn(`[DroidWorkerBase:${tabId}] triggerFix rejected — Droid is busy`)
          return false
        }
        // Find the "fix" role button from config (fallback to label for backward compatibility)
        const fixButton = config.leftButtons.find(b => b.role === 'fix' && b.promptTemplate)
          || config.leftButtons.find(b => b.label === 'Fix' && b.promptTemplate)
        if (!fixButton || !handleQuickButtonRef.current) {
          console.warn(`[DroidWorkerBase:${tabId}] triggerFix failed — no Fix button with promptTemplate found`)
          return false
        }
        
        // CRITICAL: Fill textarea with items text, then simulate clicking Fix button.
        // This ensures the text goes through the normal UI flow (textarea → Fix button → Send button).
        setMessage(itemsText)
        
        // Trigger Fix button on next tick after React flushes the textarea update
        setTimeout(() => {
          if (handleQuickButtonRef.current) {
            handleQuickButtonRef.current(fixButton, undefined)  // undefined = read from textarea
          }
        }, 50)
        
        return true
      }
    }
    return () => {
      const r = onTriggerFixRefStable.current
      if (r) r.current = null
    }
  }, [tabId, config.leftButtons])

  // Ensure global callback registry exists
  if (!window.__onChangeCommandCallback) window.__onChangeCommandCallback = {}

  // Abort ref
  const abortedRef = useRef(false)

  // handleInit
  const handleInit = useCallback(() => {
    if (!bridge || initCalledRef.current) return
    initCalledRef.current = true
    abortedRef.current = false
    setShowInitButton(false)

    const isResumeMode = !!resumeSessionId
    const initMsg = isResumeMode
      ? `[Init] Resuming session ...${resumeSessionId.slice(-8)}`
      : '[Init] Starting terminal → cd → droid'

    setHistory(prev => cappedHistory(prev, { role: 'user', text: initMsg }))
    setWaiting(true)
    setInitialized(false)

    if (isResumeMode) {
      sessionIdRefStable.current.current = resumeSessionId
      if (onSessionIdRef.current) onSessionIdRef.current(resumeSessionId)
      if (bridge) bridge.trackChangeSession(tabId, resumeSessionId, changeId)
    } else {
      sessionIdRefStable.current.current = null
    }

    if (!window.__onChangeCommandCallback) window.__onChangeCommandCallback = {}

    const startDroid = () => {
      window.__onChangeCommandCallback![tabId] = () => {
        if (abortedRef.current) return
        // Droid process started, but NOT ready yet.
        // Wait for SessionStart hook to mark as initialized.
        console.log(`[DroidWorkerBase:${tabId}] Droid prompt detected, waiting for SessionStart hook...`)
      }
      const droidCmd = isResumeMode ? `droid resume ${resumeSessionId}` : 'droid'
      bridge.runChangeCommandWithCallback(tabId, droidCmd, `${tabId}-droid`, 'droid')
    }

    window.__onChangeCommandCallback[tabId] = (callbackId: string) => {
      if (abortedRef.current) return
      if (callbackId === `${tabId}-shell-ready`) {
        setHistory(prev => cappedHistory(prev, { role: 'assistant', text: '✓ Shell ready.' }))
        if (projectPath) {
          window.__onChangeCommandCallback![tabId] = (cbId: string) => {
            if (abortedRef.current) return
            if (cbId === `${tabId}-cd`) {
              setHistory(prev => cappedHistory(prev, { role: 'assistant', text: '✓ cd done.' }))
              startDroid()
            }
          }
          bridge.runChangeCommandWithCallback(tabId, `cd ${projectPath}`, `${tabId}-cd`, 'shell')
        } else {
          startDroid()
        }
      }
    }

    bridge.startChangeTerminal(tabId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, tabId, projectPath, resumeSessionId, changeId])

  // Cleanup — deps are intentionally empty: tabId is stable for the lifetime of the component,
  // and bridge is a global singleton. This ensures cleanup runs only on unmount.
  useEffect(() => {
    console.log(`[DroidWorker:${tabId}] ✅ MOUNTED, changeId=${changeId}, resumeSessionId=${resumeSessionId}`)
    abortedRef.current = false  // Reset on mount (important for HMR)
    // If not initialized and init was called before unmount, reset initCalledRef
    // so auto-init can retry (handles case where component unmounted during init)
    if (!initializedRef.current && initCalledRef.current) {
      console.warn(`[DroidWorker:${tabId}] Resetting initCalledRef — was unmounted during init`)
      initCalledRef.current = false
    }
    return () => {
      const isClosing = window.__closingTabs?.has(tabId)
      console.warn(`[DroidWorker:${tabId}] ❌ UNMOUNTED — isClosing=${isClosing}, closingTabs=${JSON.stringify([...(window.__closingTabs || [])])}`)
      abortedRef.current = true
      if (isClosing) {
        const b = window.__nativeBridge
        if (b) {
          b.stopChangeTerminal(tabId)
          b.untrackChangeSession(tabId)
        }
        window.__closingTabs?.delete(tabId)
      }
      // Only clean up callbacks if tab is actually closing (not HMR)
      if (isClosing) {
        if (window.__onChangeTerminalOutput) delete window.__onChangeTerminalOutput[tabId]
        if (window.__onChangeCommandCallback) delete window.__onChangeCommandCallback[tabId]
        if (window.__onChangeTerminalExit) delete window.__onChangeTerminalExit[tabId]
        if (window.__onChangeTerminalOutputBytes) delete window.__onChangeTerminalOutputBytes[tabId]
        // Clean up HMR state persistence
        if (window.__workerStates) delete window.__workerStates[tabId]
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
    setHistory(prev => cappedHistory(prev, { role: 'user', text: prompt }))
    taskIdRef.current = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setWaiting(true)
    if (projectPath) {
      saveHistoryEntry(projectPath, `droid-worker://${changeId || 'idle'}`, prompt, `Droid Worker (${changeId}) > Auto-init prompt`).catch(() => {})
    }
    sendToDroid(prompt)
  }, [initialized, waiting, config.autoInitPrompt, changeId, projectPath, sendToDroid])

  // Auto-send external message after initialized and not busy (for fix_review mode)
  // Trigger Fix button with items text instead of sending raw message
  useEffect(() => {
    if (!initialized || waiting || autoSendMessageSentRef.current) return
    if (!autoSendMessage) return
    // Wait for autoInitPrompt to be sent first (if any)
    if (config.autoInitPrompt && !autoPromptSentRef.current) return

    autoSendMessageSentRef.current = true
    
    // Find the "fix" role button from config (fallback to label for backward compatibility)
    const fixButton = config.leftButtons.find(b => b.role === 'fix' && b.promptTemplate)
      || config.leftButtons.find(b => b.label === 'Fix' && b.promptTemplate)
    if (!fixButton || !handleQuickButtonRef.current) {
      console.warn(`[DroidWorkerBase:${tabId}] autoSendMessage failed — no Fix button with promptTemplate found`)
      if (onAutoSendFailedRef.current) onAutoSendFailedRef.current(tabId)
      return
    }
    
    // Trigger Fix button with autoSendMessage as items text
    setTimeout(() => {
      const sent = handleQuickButtonRef.current?.(fixButton, autoSendMessage)
      if (sent && onAutoSendCompleteRef.current) {
        onAutoSendCompleteRef.current(tabId)
      } else if (!sent && onAutoSendFailedRef.current) {
        onAutoSendFailedRef.current(tabId)
      }
    }, 50)
  }, [initialized, waiting, autoSendMessage, config.autoInitPrompt, config.leftButtons, tabId])

  // ─── Confirmation handlers ───────────────────────────────────────
  // NOTE: useCallback must be declared before the early return to maintain
  // consistent hook call order across renders (Rules of Hooks).

  const handleConfirmationAction = useCallback((action: ButtonAction, selectedItems: string[]) => {
    if (action === 'cancel') {
      setConfirmationData(null)
      return
    }

    // CRITICAL: Use triggerFix (same as Self-Review Cycle) to ensure proper text handling.
    // This fills textarea with items and clicks Fix button, which wraps with promptTemplate
    // and sends via Send button path, avoiding Droid CLI bracketed paste truncation.
    const itemsText = selectedItems.map(item => `- ${item}`).join('\n')
    
    // Find the "fix" role button from config (fallback to label for backward compatibility)
    const fixButton = config.leftButtons.find(b => b.role === 'fix' && b.promptTemplate)
      || config.leftButtons.find(b => b.label === 'Fix' && b.promptTemplate)
    
    if (!fixButton || !handleQuickButtonRef.current) {
      console.warn(`[DroidWorkerBase:${tabId}] handleConfirmationAction failed — no Fix button with promptTemplate found`)
      alert('无法发送修复消息：未找到 Fix 按钮配置，请检查 worker_config.yml')
      return
    }
    
    setConfirmationData(null)
    
    // Fill textarea with items text, then trigger Fix button on next tick
    setMessage(itemsText)
    setTimeout(() => {
      if (handleQuickButtonRef.current) {
        handleQuickButtonRef.current(fixButton, undefined)  // undefined = read from textarea
      }
    }, 50)
  }, [config.leftButtons, tabId])

  if (!bridge) return <div className="panel-empty">Native bridge not available</div>

  // ─── Actions ─────────────────────────────────────────────────────

  const handleSendMessage = (): boolean => {
    // Check if there's a pending message from external ref (takes priority)
    const pending = pendingMessageRef.current
    if (pending) {
      pendingMessageRef.current = null
      // If history already contains this message (from handleQuickButton), just send it
      // Otherwise, add to history and set waiting state
      const lastMessage = history[history.length - 1]
      if (!lastMessage || lastMessage.role !== 'user' || lastMessage.text !== pending) {
        setHistory(prev => cappedHistory(prev, { role: 'user', text: pending }))
        taskIdRef.current = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        setWaiting(true)
        if (projectPath) saveHistoryEntry(projectPath, `droid-worker://${changeId || 'idle'}`, pending, `Droid Worker (${changeId || 'idle'}) > Send`).catch(() => {})
      }
      sendToDroid(pending)
      return true
    }
    
    // Otherwise use the input box message
    const trimmed = message.trim()
    if (!trimmed) return false
    setHistory(prev => cappedHistory(prev, { role: 'user', text: trimmed }))
    setMessage('')
    taskIdRef.current = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setWaiting(true)
    if (projectPath) saveHistoryEntry(projectPath, `droid-worker://${changeId || 'idle'}`, trimmed, `Droid Worker (${changeId || 'idle'}) > Send`).catch(() => {})
    sendToDroid(trimmed)
    return true
  }
  handleSendMessageRef.current = handleSendMessage

  const handleStop = () => {
    writeToTerminal('\x03')
    // Clear taskIdRef BEFORE clearing waiting — ensures the Stop hook handler
    // sees no valid task ID and won't call onFixComplete for a manual abort.
    taskIdRef.current = null
    setWaiting(false)
    waitingRef.current = false
    setHistory(prev => cappedHistory(prev, { role: 'assistant', text: '⏹ Stopped' }))
  }

  const handleQuickButton = (btn: QuickButton, overrideInput?: string): boolean => {
    // Special action
    if (btn.action) {
      // Support both new and legacy action names
      const normalizedAction = btn.action.toLowerCase().replace(/[_\s-]+/g, '_')
      if ((normalizedAction === 'open_codex_code_review' || normalizedAction === 'open_code_review' || normalizedAction === 'code_review') && onReviewActionRef.current && changeId) {
        onReviewActionRef.current(changeId)
      }
      return false
    }

    // Fixed prompt
    if (btn.prompt) {
      setHistory(prev => cappedHistory(prev, { role: 'user', text: btn.prompt! }))
      taskIdRef.current = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      setWaiting(true)
      if (projectPath) saveHistoryEntry(projectPath, `droid-worker://${changeId || 'idle'}`, btn.prompt!, `Droid Worker > ${btn.label}`).catch(() => {})
      sendToDroid(btn.prompt!)
      return true
    }

    // Template prompt with {input} — use overrideInput if provided, otherwise use textarea
    if (btn.promptTemplate) {
      const input = overrideInput !== undefined ? overrideInput : message.trim()
      if (btn.requiresInput && !input) return false
      const prompt = btn.promptTemplate.replace('{input}', input)
      
      // CRITICAL: Always use pendingMessageRef + Send button path for all promptTemplate texts.
      // This ensures consistent behavior and avoids Droid CLI's bracketed paste truncation.
      // Set history and waiting state immediately, then trigger send asynchronously.
      setHistory(prev => cappedHistory(prev, { role: 'user', text: prompt }))
      setMessage('')
      taskIdRef.current = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      setWaiting(true)
      if (projectPath) saveHistoryEntry(projectPath, `droid-worker://${changeId || 'idle'}`, prompt, `Droid Worker > ${btn.label}`).catch(() => {})
      
      // Use pendingMessageRef to pass the prompt to handleSendMessage
      pendingMessageRef.current = prompt
      // Trigger send on next tick
      setTimeout(() => {
        handleSendMessageRef.current?.()
      }, 50)
      return true
    }

    // No action taken
    return false
  }
  handleQuickButtonRef.current = handleQuickButton

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault()
      if (initialized) handleSendMessage()
    }
  }

  // ─── Render ──────────────────────────────────────────────────────

  const title = changeId ? `Droid Worker: ${changeId}` : 'Droid Worker'
  const titleSuffix = waiting && !initialized ? ' (Initializing...)' : ''

  return (
    <div className="wizard-panel">
      <div className="wizard-panel-header">
        <span className="wizard-panel-title">{title}{titleSuffix}</span>
      </div>

      {/* Init screen */}
      {showInitButton && !initialized && (
        <div className="wizard-init-screen">
          <p>Click the button below to initialize Droid Worker.</p>
          <button className="btn-primary" onClick={handleInit} disabled={waiting}>
            {waiting ? 'Initializing...' : 'Initialize Droid'}
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div className="wizard-history" ref={resultRef}>
          {history.map((h, i) => (
            <div key={i} className={`wizard-msg wizard-msg-${h.role}`}>
              <span className="wizard-msg-role">{h.role === 'user' ? '▶' : '◀'}</span>
              {h.role === 'assistant' && /- \[[ x]\]/i.test(h.text)
                ? <MarkdownWithCheckbox text={h.text} className="wizard-msg-text" />
                : <pre className="wizard-msg-text">{h.text}</pre>
              }
            </div>
          ))}
          {waiting && (
            <div className="wizard-msg wizard-msg-loading">
              <span className="wizard-spinner" />
              <span>Droid is working...</span>
            </div>
          )}
        </div>
      )}

      <div className="wizard-input-area">
        <label className="dialog-label">Send a message to Droid:</label>
        <textarea
          className="dialog-textarea"
          value={message}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={initialized ? "Type a message..." : "Initializing..."}
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
