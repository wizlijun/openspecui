import { useState, useCallback, useRef, useEffect } from 'react'
import { saveHistoryEntry } from './inputHistoryService'
import { MarkdownWithCheckbox } from './MarkdownWithCheckbox'

// ─── Types ─────────────────────────────────────────────────────────

export type WorkerMode = 'new_change' | 'continue_change'

export interface QuickButton {
  label: string
  /** Fixed prompt to send (mutually exclusive with promptTemplate) */
  prompt?: string
  /** Template with {input} placeholder — uses textarea content */
  promptTemplate?: string
  /** Special action name instead of sending prompt */
  action?: string
  /** Whether the button requires non-empty textarea input */
  requiresInput?: boolean
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
}

export const WORKER_CONFIGS: Record<WorkerMode, DroidWorkerConfig> = {
  new_change: {
    mode: 'new_change',
    name: 'New Change',
    autoInitPrompt: null,
    leftButtons: [],
    rightButtons: [
      { label: 'New Change', promptTemplate: '/opsx-new {input}', requiresInput: true },
    ],
  },
  continue_change: {
    mode: 'continue_change',
    name: 'Continue Change',
    autoInitPrompt: '请重新加载openspec的change上下文，changeId为{changeId}',
    leftButtons: [
      { label: 'Continue', prompt: '/opsx-continue' },
      { label: 'Apply', prompt: '/opsx-apply' },
      { label: 'Review', action: 'open_codex_review' },
    ],
    rightButtons: [],
  },
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
}

// ─── Component ─────────────────────────────────────────────────────

export function DroidWorkerBase({
  tabId, changeId, resumeSessionId, projectPath, config,
  onStopHookRef, onRefresh, resetKey, sessionIdRef, onSessionId, onBusyChange,
  onReviewAction,
}: DroidWorkerBaseProps) {
  const [message, setMessage] = useState('')
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([])
  const [waiting, setWaiting] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [showInitButton, setShowInitButton] = useState(true)
  const initializedRef = useRef(false)
  const initCalledRef = useRef(false)
  const autoPromptSentRef = useRef(false)
  const resultRef = useRef<HTMLDivElement>(null)

  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh
  const onSessionIdRef = useRef(onSessionId)
  onSessionIdRef.current = onSessionId

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
      sessionIdRef.current = null
    }
  }, [resetKey, sessionIdRef])

  // Auto-scroll
  useEffect(() => {
    if (resultRef.current) {
      resultRef.current.scrollTop = resultRef.current.scrollHeight
    }
  }, [history])

  // Busy state
  useEffect(() => {
    onBusyChange?.(waiting)
  }, [waiting, onBusyChange])

  // Hook listener
  useEffect(() => {
    onStopHookRef.current = (data: any) => {
      const eventName = data.event || ''

      if (eventName === 'SessionStart') {
        if (initializedRef.current) return
        if (data.session_id) {
          sessionIdRef.current = data.session_id
          if (onSessionIdRef.current) onSessionIdRef.current(data.session_id)
          if (bridge) bridge.trackChangeSession(tabId, data.session_id, changeId)
        }
        initializedRef.current = true
        setInitialized(true)
        setWaiting(false)
        setHistory(prev => [...prev, { role: 'assistant', text: '✓ Droid Ready' }])
        return
      }

      if (eventName === 'Stop') {
        const result = data.last_result || '(no response)'
        setHistory(prev => [...prev, { role: 'assistant', text: result }])
        setWaiting(false)
        if (onRefreshRef.current) onRefreshRef.current()
        return
      }
    }
    return () => { onStopHookRef.current = null }
  }, [onStopHookRef, tabId, bridge, changeId])

  // Terminal helpers
  const writeToTerminal = useCallback((text: string) => {
    if (bridge) bridge.writeChangeInput(tabId, text)
  }, [bridge, tabId])

  const sendToDroid = useCallback((text: string) => {
    writeToTerminal(text)
    setTimeout(() => writeToTerminal('\r'), 200)
  }, [writeToTerminal])

  // Register per-tab command callback
  useEffect(() => {
    if (!window.__onChangeCommandCallback) window.__onChangeCommandCallback = {}
    return () => {
      if (window.__onChangeCommandCallback) delete window.__onChangeCommandCallback[tabId]
    }
  }, [tabId])

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
      ? `[Init] Resuming session ${resumeSessionId.slice(0, 8)}...`
      : '[Init] Starting terminal → cd → droid'

    setHistory(prev => [...prev, { role: 'user', text: initMsg }])
    setWaiting(true)
    setInitialized(false)

    if (isResumeMode) {
      sessionIdRef.current = resumeSessionId
      if (onSessionIdRef.current) onSessionIdRef.current(resumeSessionId)
      if (bridge) bridge.trackChangeSession(tabId, resumeSessionId, changeId)
    } else {
      sessionIdRef.current = null
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
        setHistory(prev => [...prev, { role: 'assistant', text: '✓ Shell ready.' }])
        if (projectPath) {
          window.__onChangeCommandCallback![tabId] = (cbId: string) => {
            if (abortedRef.current) return
            if (cbId === `${tabId}-cd`) {
              setHistory(prev => [...prev, { role: 'assistant', text: '✓ cd done.' }])
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
  }, [bridge, tabId, projectPath, resumeSessionId, sessionIdRef, changeId])

  // Cleanup
  useEffect(() => {
    return () => {
      abortedRef.current = true
      if (bridge) {
        bridge.stopChangeTerminal(tabId)
        bridge.untrackChangeSession(tabId)
      }
      if (window.__onChangeTerminalOutput) delete window.__onChangeTerminalOutput[tabId]
      if (window.__onChangeCommandCallback) delete window.__onChangeCommandCallback[tabId]
      if (window.__onChangeTerminalExit) delete window.__onChangeTerminalExit[tabId]
    }
  }, [bridge, tabId])

  // Auto-init after all components are mounted
  useEffect(() => {
    if (!bridge) return
    const raf = requestAnimationFrame(() => {
      setTimeout(() => {
        if (!initCalledRef.current) {
          handleInit()
        }
      }, 300)
    })
    return () => cancelAnimationFrame(raf)
  }, [bridge, handleInit])

  // Auto-send init prompt after initialized AND ready (config-driven)
  useEffect(() => {
    if (!initialized || waiting || autoPromptSentRef.current) return
    if (!config.autoInitPrompt) return

    autoPromptSentRef.current = true
    const prompt = config.autoInitPrompt.replace('{changeId}', changeId || '')
    setHistory(prev => [...prev, { role: 'user', text: prompt }])
    setWaiting(true)
    if (projectPath) {
      saveHistoryEntry(projectPath, `droid-worker://${changeId || 'idle'}`, prompt, `Droid Worker (${changeId}) > Auto-init prompt`).catch(() => {})
    }
    sendToDroid(prompt)
  }, [initialized, waiting, config.autoInitPrompt, changeId, projectPath, sendToDroid])

  if (!bridge) return <div className="panel-empty">Native bridge not available</div>

  // ─── Actions ─────────────────────────────────────────────────────

  const handleSendMessage = () => {
    const trimmed = message.trim()
    if (!trimmed) return
    setHistory(prev => [...prev, { role: 'user', text: trimmed }])
    setMessage('')
    setWaiting(true)
    if (projectPath) saveHistoryEntry(projectPath, `droid-worker://${changeId || 'idle'}`, trimmed, `Droid Worker (${changeId || 'idle'}) > Send`).catch(() => {})
    sendToDroid(trimmed)
  }

  const handleStop = () => {
    writeToTerminal('\x03')
    setWaiting(false)
    setHistory(prev => [...prev, { role: 'assistant', text: '⏹ Stopped' }])
  }

  const handleQuickButton = (btn: QuickButton) => {
    // Special action
    if (btn.action) {
      if (btn.action === 'open_codex_review' && onReviewAction && changeId) {
        onReviewAction(changeId)
      }
      return
    }

    // Fixed prompt
    if (btn.prompt) {
      setHistory(prev => [...prev, { role: 'user', text: btn.prompt! }])
      setWaiting(true)
      if (projectPath) saveHistoryEntry(projectPath, `droid-worker://${changeId || 'idle'}`, btn.prompt!, `Droid Worker > ${btn.label}`).catch(() => {})
      sendToDroid(btn.prompt!)
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
      if (projectPath) saveHistoryEntry(projectPath, `droid-worker://${changeId || 'idle'}`, prompt, `Droid Worker > ${btn.label}`).catch(() => {})
      sendToDroid(prompt)
    }
  }

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
    </div>
  )
}
