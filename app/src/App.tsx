import { useState, useCallback, useRef, useEffect } from 'react'
import './App.css'
import { pickDirectory, isFileSystemAccessSupported, isSpecNode, isArtifactNode, isChangeNode } from './useDirectoryPicker'
import type { FileTreeNode } from './useDirectoryPicker'
import { TreeView } from './TreeView'
import { Canvas } from './Canvas'
import { EditorPanel } from './EditorPanel'
import { EmbeddedTerminal } from './EmbeddedTerminal'
import { FolderPlusIcon, PlusCircleIcon, CloseIcon, RefreshIcon } from './Icons'
import { saveHistoryEntry } from './inputHistoryService'
import { MarkdownWithCheckbox } from './MarkdownWithCheckbox'
import { DroidWorkerBase } from './DroidWorkerBase'
import type { WorkerMode, DroidWorkerConfig } from './DroidWorkerBase'
import { loadWorkerConfigs, DEFAULT_WORKER_CONFIGS } from './loadWorkerConfig'

// Tab types
type TabType = 'viewer' | 'change' | 'codex'

interface ChangeTab {
  id: string
  mode: WorkerMode
  changeId?: string  // If provided, auto-load context
  resumeSessionId?: string  // If provided, resume existing session
}

interface CodexTab {
  id: string
  changeId?: string  // Optional: if provided, context is for this change
  resumeSessionId?: string  // If provided, resume existing session
}

const normalizeEventToken = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase().replace(/[\/_\s]+/g, '-')

const isCodexTurnComplete = (data: any): boolean => {
  if (data?.codex_is_done === true) return true

  const doneTokens = new Set([
    'agent-turn-complete',
    'agent-turn-completed',
    'agent-turn-done',
    'turn-complete',
    'turn-completed',
    'turn-done',
    'item-complete',
    'item-completed',
    'session-complete',
    'session-completed',
    'response-complete',
    'response-completed',
    'response-done',
    'message-complete',
    'message-completed',
    'message-done',
    'completion',
    'completed',
    'done',
    'finished',
    'stop',
    'stopped',
  ])

  const eventCandidates = [
    data?.codex_event_type,
    data?.event_type,
    data?.type,
    data?.hook_event_name,
    data?.payload?.type,
    data?.payload?.event_type,
    data?.payload?.hook_event_name,
    data?.payload?.event,
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




// ─── Codex Worker Panel ────────────────────────────────────────────

interface CodexPanelProps {
  tabId: string  // Unique tab ID for tracking
  changeId?: string
  projectPath: string | undefined
  resumeSessionId?: string  // If provided, resume existing codex session
  onStopHookRef: React.MutableRefObject<((data: any) => void) | null>
  onRefresh: () => void
  sessionIdRef: React.MutableRefObject<string | null>
  onSessionId?: (id: string) => void
  onBusyChange?: (busy: boolean) => void
}

function CodexPanel({ tabId, changeId, projectPath, resumeSessionId, onStopHookRef, onRefresh, sessionIdRef, onSessionId, onBusyChange }: CodexPanelProps) {
  const [message, setMessage] = useState('')
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([])
  const [waiting, setWaiting] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [showInitButton, setShowInitButton] = useState(true)
  const initCalledRef = useRef(false)
  const resultRef = useRef<HTMLDivElement>(null)

  // Stable refs for callback props to avoid re-triggering effects
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh
  const onSessionIdRef = useRef(onSessionId)
  onSessionIdRef.current = onSessionId

  useEffect(() => {
    if (resultRef.current) {
      resultRef.current.scrollTop = resultRef.current.scrollHeight
    }
  }, [history])

  useEffect(() => {
    onBusyChange?.(waiting)
  }, [waiting, onBusyChange])

  useEffect(() => {
    onStopHookRef.current = (data: any) => {
      const eventName = data.event || ''
      if (eventName === 'codex-notify') {
        // Always try to capture session_id from codex events
        const sid = data.session_id || data.payload?.['thread-id'] || data.payload?.thread_id || null
        if (sid && !sessionIdRef.current) {
          sessionIdRef.current = sid
          onSessionIdRef.current?.(sid)
          // Track session in Python for persistence
          if (bridge) bridge.trackCodexSession(tabId, sid, changeId)
        }
        // Only update UI when the task is actually done
        if (isCodexTurnComplete(data)) {
          const finalMessage = extractCodexFinalMessage(data) || '✅ Codex task completed.'
          setHistory(prev => [...prev, { role: 'assistant', text: finalMessage }])
          setWaiting(false)
          if (onRefreshRef.current) onRefreshRef.current()
        }
      } else if (eventName === 'Stop') {
        // Droid Stop hook
        const result = data.last_result || '(no response)'
        setHistory(prev => [...prev, { role: 'assistant', text: result }])
        setWaiting(false)
        if (onRefreshRef.current) onRefreshRef.current()
      }
    }
    return () => { onStopHookRef.current = null }
  }, [onStopHookRef, tabId, changeId])

  const bridge = window.__nativeBridge
  if (!bridge) return <div className="panel-empty">Native bridge not available</div>

  const sendToReview = (text: string) => {
    bridge.writeReviewInput(text)
    setTimeout(() => bridge.writeReviewInput('\r'), 200)
  }

  const shellSingleQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

  const buildCodexStartCommand = () => {
    if (resumeSessionId) {
      const notifyScriptPath = projectPath ? `${projectPath}/openspec/codex-notify.sh` : './openspec/codex-notify.sh'
      const notifyConfig = `notify=["bash",${JSON.stringify(notifyScriptPath)}]`
      return `codex resume ${resumeSessionId} -c ${shellSingleQuote(notifyConfig)}`
    }
    const notifyScriptPath = projectPath ? `${projectPath}/openspec/codex-notify.sh` : './openspec/codex-notify.sh'
    const notifyConfig = `notify=["bash",${JSON.stringify(notifyScriptPath)}]`
    return `codex -c ${shellSingleQuote(notifyConfig)}`
  }

  const handleInit = () => {
    if (initCalledRef.current) return
    initCalledRef.current = true
    
    setShowInitButton(false)
    
    const isResumeMode = !!resumeSessionId
    setInitialized(true)
    setWaiting(true)
    
    const initMsg = isResumeMode
      ? `[Init] Resuming codex session ${resumeSessionId!.slice(0, 8)}...`
      : '[Init] Starting codex terminal → cd → reviewcmd.sh → codex'
    setHistory(prev => [...prev, { role: 'user', text: initMsg }])

    // In resume mode, we already know the session_id
    if (isResumeMode) {
      sessionIdRef.current = resumeSessionId!
      if (onSessionId) onSessionId(resumeSessionId!)
      // Track session in Python for persistence
      if (bridge) bridge.trackCodexSession(tabId, resumeSessionId!, changeId)
    }

    // Save previous callback
    const prevReviewCallback = window.__onReviewCommandCallback

    const step3_startCodex = () => {
      setHistory(prev => [...prev, { role: 'assistant', text: '✓ reviewcmd.sh sourced. Starting codex...' }])
      window.__onReviewCommandCallback = (callbackId: string) => {
        if (callbackId === 'review-codex') {
          window.__onReviewCommandCallback = prevReviewCallback
          setWaiting(false)
          setHistory(prev => [...prev, { role: 'assistant', text: '✓ Codex is ready.' }])
        }
      }
      bridge.runReviewCommandWithCallback(buildCodexStartCommand(), 'review-codex', 'droid')
    }

    const step2_sourceReviewCmd = () => {
      setHistory(prev => [...prev, { role: 'assistant', text: '✓ cd done. Sourcing reviewcmd.sh...' }])
      window.__onReviewCommandCallback = (callbackId: string) => {
        if (callbackId === 'review-source') step3_startCodex()
      }
      bridge.runReviewCommandWithCallback('source ./openspec/reviewcmd.sh', 'review-source', 'shell')
    }

    const step1_cd = () => {
      if (projectPath) {
        window.__onReviewCommandCallback = (callbackId: string) => {
          if (callbackId === 'review-cd') step2_sourceReviewCmd()
        }
        bridge.runReviewCommandWithCallback(`cd ${projectPath}`, 'review-cd', 'shell')
      } else {
        step2_sourceReviewCmd()
      }
    }

    // Start the review PTY — backend registers 'review-shell-ready' callback
    // Wait for shell prompt to be detected before sending first command
    window.__onReviewCommandCallback = (callbackId: string) => {
      if (callbackId === 'review-shell-ready') {
        setHistory(prev => [...prev, { role: 'assistant', text: '✓ Shell ready.' }])
        step1_cd()
      }
    }
    bridge.startReviewTerminal(projectPath || '')
  }

  const handleSend = () => {
    const trimmed = message.trim()
    if (!trimmed) return
    setHistory(prev => [...prev, { role: 'user', text: trimmed }])
    setMessage('')
    setWaiting(true)
    if (projectPath) saveHistoryEntry(projectPath, `codex://${changeId || 'standalone'}`, trimmed, `Codex Worker (${changeId || 'standalone'}) > 输入框`).catch(() => {})
    sendToReview(trimmed)
  }

  const handleReview = () => {
    const reviewPrompt = '严格评审修改的代码,无需修改代码和构建，只给评审建议，结果按优先级P0、P1、P2排序，以todo的列表形式返回。'
    setHistory(prev => [...prev, { role: 'user', text: reviewPrompt }])
    setWaiting(true)
    if (projectPath) saveHistoryEntry(projectPath, `codex://${changeId || 'standalone'}`, reviewPrompt, `Codex Worker (${changeId || 'standalone'}) > Review按钮`).catch(() => {})
    sendToReview(reviewPrompt)
  }

  const handleStop = () => {
    bridge.writeReviewInput('\x03')
    setWaiting(false)
    setStopped(true)
    setHistory(prev => [...prev, { role: 'assistant', text: '⏹ Stopped' }])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault()
      handleSend()
    }
  }

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
  }, [bridge])

  // Cleanup: untrack session on unmount
  useEffect(() => {
    return () => {
      if (bridge) bridge.untrackCodexSession(tabId)
    }
  }, [bridge, tabId])

  return (
    <div className="wizard-panel">
      <div className="wizard-panel-header">
        <span className="wizard-panel-title">Codex Worker{changeId ? `: ${changeId}` : ''}{stopped ? ' (Stopped)' : ''}</span>
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
          <button className="btn-secondary" onClick={handleReview} disabled={!initialized || waiting}>
            Review
          </button>
          {waiting && (
            <button className="btn-stop" onClick={handleStop}>⏹ Stop</button>
          )}
        </div>
        <button className="btn-primary" onClick={handleSend} disabled={!initialized || !message.trim() || waiting}>
          Send →
        </button>
      </div>
    </div>
  )
}

// ─── Main App ──────────────────────────────────────────────────────

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('viewer')
  const [tree, setTree] = useState<FileTreeNode | null>(null)
  const [canvasNode, setCanvasNode] = useState<FileTreeNode | null>(null)
  const [selectedSpec, setSelectedSpec] = useState<FileTreeNode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [autoLoaded, setAutoLoaded] = useState(false)
  const [changeTabs, setChangeTabs] = useState<ChangeTab[]>([])
  const [activeChangeTabId, setActiveChangeTabId] = useState<string | null>(null)
  const [codexTabs, setCodexTabs] = useState<CodexTab[]>([])
  const [activeCodexTabId, setActiveCodexTabId] = useState<string | null>(null)
  const [changeSessionDisplays, setChangeSessionDisplays] = useState<Map<string, string>>(new Map())
  const [codexSessionDisplays, setCodexSessionDisplays] = useState<Map<string, string>>(new Map())
  const [changeBusyMap, setChangeBusyMap] = useState<Map<string, boolean>>(new Map())
  const [codexBusyMap, setCodexBusyMap] = useState<Map<string, boolean>>(new Map())
  const [changeResetKeys, setChangeResetKeys] = useState<Map<string, number>>(new Map())
  const [workerConfigs, setWorkerConfigs] = useState<Record<WorkerMode, DroidWorkerConfig>>(DEFAULT_WORKER_CONFIGS)
  const changeStopHookRefs = useRef<Map<string, ((data: any) => void) | null>>(new Map())
  const codexStopHookRefs = useRef<Map<string, ((data: any) => void) | null>>(new Map())
  const changeSessionIdRefs = useRef<Map<string, string | null>>(new Map())
  const codexSessionIdRefs = useRef<Map<string, string | null>>(new Map())

  const supported = isFileSystemAccessSupported()

  // Load worker configs when project path changes
  useEffect(() => {
    if (!tree?.nativePath) {
      setWorkerConfigs(DEFAULT_WORKER_CONFIGS)
      return
    }
    loadWorkerConfigs(tree.nativePath).then(configs => {
      setWorkerConfigs(configs)
    })
  }, [tree?.nativePath])

  // Auto-load last directory on startup (native app only)
  if (window.__isNativeApp && !autoLoaded && window.__lastDirectory) {
    setAutoLoaded(true)
    const lastDir = window.__lastDirectory
    if (lastDir) {
      pickDirectory(lastDir)
        .then(root => { setTree(root); setCanvasNode(root) })
        .catch(e => console.error('Failed to auto-load last directory:', e))
    }
  }

  // Restore saved sessions after directory is loaded
  const sessionsRestoredRef = useRef(false)
  useEffect(() => {
    if (!tree || sessionsRestoredRef.current || !window.__isNativeApp) return
    const saved = window.__savedSessions
    if (!saved) return
    
    const hasChangeSessions = saved.changeTabs && saved.changeTabs.length > 0
    const hasCodexSessions = saved.codexTabs && saved.codexTabs.length > 0
    if (!hasChangeSessions && !hasCodexSessions) return
    
    sessionsRestoredRef.current = true
    console.log('[SessionRestore] Restoring saved sessions:', saved)

    // Restore Droid Worker tabs
    if (hasChangeSessions) {
      const newChangeTabs: ChangeTab[] = []
      let lastChangeTabId: string | null = null
      for (const session of saved.changeTabs) {
        const tabId = `change-resume-${session.sessionId.slice(0, 8)}-${Date.now()}`
        newChangeTabs.push({
          id: tabId,
          mode: session.changeId ? 'continue_change' : 'new_change',
          changeId: session.changeId || undefined,
          resumeSessionId: session.sessionId,
        })
        lastChangeTabId = tabId
      }
      if (newChangeTabs.length > 0) {
        setChangeTabs(prev => [...prev, ...newChangeTabs])
        setActiveChangeTabId(lastChangeTabId)
        setActiveTab('change')
      }
    }

    // Restore Codex Worker tabs
    if (hasCodexSessions) {
      const newCodexTabs: CodexTab[] = []
      let lastCodexTabId: string | null = null
      for (const session of saved.codexTabs) {
        const tabId = `codex-resume-${session.sessionId.slice(0, 8)}-${Date.now()}`
        newCodexTabs.push({
          id: tabId,
          changeId: session.changeId || undefined,
          resumeSessionId: session.sessionId,
        })
        lastCodexTabId = tabId
      }
      if (newCodexTabs.length > 0) {
        setCodexTabs(prev => [...prev, ...newCodexTabs])
        setActiveCodexTabId(lastCodexTabId)
        // Only switch to codex if no change tabs were restored
        if (!hasChangeSessions) setActiveTab('codex')
      }
    }

    // Clear saved sessions after restoring (they'll be re-saved on next exit)
    window.__savedSessions = undefined
  }, [tree])

  const refreshDirectory = useCallback(async () => {
    if (!tree?.nativePath) return
    try {
      const root = await pickDirectory(tree.nativePath)
      setTree(root)
      if (canvasNode?.nativePath) {
        const findNode = (node: FileTreeNode, path: string): FileTreeNode | null => {
          if (node.nativePath === path) return node
          if (node.children) {
            for (const child of node.children) {
              const found = findNode(child, path)
              if (found) return found
            }
          }
          return null
        }
        const newCanvas = findNode(root, canvasNode.nativePath)
        if (newCanvas) setCanvasNode(newCanvas)
      }
    } catch (e) {
      console.error('Failed to refresh directory:', e)
    }
  }, [tree, canvasNode])

  // Keep a ref to refreshDirectory so the hook handler always uses the latest version
  const refreshDirectoryRef = useRef(refreshDirectory)
  useEffect(() => {
    refreshDirectoryRef.current = refreshDirectory
  }, [refreshDirectory])

  // ─── Hook Notification Dispatcher ────────────────────────────────
  // All refs used here are stable (useRef) — no deps needed.
  // The handler is set once on mount and cleaned up on unmount.
  useEffect(() => {
    if (!window.__isNativeApp) return

    // Safe dispatch: call each handler in a try/catch so one failure
    // doesn't prevent other panels from receiving the event.
    const safeDispatch = (refs: Map<string, ((data: any) => void) | null>, data: any, label: string) => {
      refs.forEach((handler, tabId) => {
        if (!handler) return
        try {
          handler(data)
        } catch (e) {
          console.error(`[Hook] Error dispatching ${label} to tab ${tabId}:`, e)
        }
      })
    }

    // Dispatch to a specific tab by session_id. Returns true if matched.
    const dispatchBySessionId = (hookSessionId: string, data: any): boolean => {
      let matched = false
      // Check change tabs
      changeSessionIdRefs.current.forEach((sid, tabId) => {
        if (sid === hookSessionId) {
          const handler = changeStopHookRefs.current.get(tabId)
          if (handler) {
            try { handler(data) } catch (e) { console.error(`[Hook] Error in change tab ${tabId}:`, e) }
          }
          matched = true
        }
      })
      // Check codex tabs
      codexSessionIdRefs.current.forEach((sid, tabId) => {
        if (sid === hookSessionId) {
          const handler = codexStopHookRefs.current.get(tabId)
          if (handler) {
            try { handler(data) } catch (e) { console.error(`[Hook] Error in codex tab ${tabId}:`, e) }
          }
          matched = true
        }
      })
      return matched
    }

    // Broadcast to all change + codex tabs
    const broadcastToAll = (data: any, label: string) => {
      safeDispatch(changeStopHookRefs.current, data, `${label}→change`)
      safeDispatch(codexStopHookRefs.current, data, `${label}→codex`)
    }

    window.__onHookNotify = (data: any) => {
      if (!data || typeof data !== 'object') {
        console.warn('[Hook] Received invalid hook data:', data)
        return
      }

      const eventName = data.event || data.hook_event_name || 'unknown'
      const hookSessionId: string | null = data.session_id || null
      console.log(`[Hook] ${eventName}: session=${hookSessionId}`, data)

      // ── 1. Refresh file tree for events that modify files ──
      const refreshEvents = new Set(['SessionEnd', 'PostToolUse', 'Stop', 'SubagentStop', 'codex-notify'])
      if (refreshEvents.has(eventName)) {
        setTimeout(() => refreshDirectoryRef.current(), 500)
      }

      // ── 2. Route event to the appropriate panel(s) ──
      switch (eventName) {
        case 'SessionStart':
          // Droid session started — broadcast to all change tabs for init detection.
          // Each DroidWorkerBase checks if it's waiting for init and captures session_id.
          safeDispatch(changeStopHookRefs.current, data, 'SessionStart→change')
          break

        case 'Stop': {
          // Droid session stopped — contains last_result with the droid's response.
          // Route by session_id if available; fallback to broadcast.
          if (hookSessionId) {
            const matched = dispatchBySessionId(hookSessionId, data)
            if (!matched) {
              console.warn(`[Hook] Stop: session_id=${hookSessionId} did not match any tab, broadcasting to all`)
              broadcastToAll(data, 'Stop(unmatched)')
            }
          } else {
            broadcastToAll(data, 'Stop(no-session)')
          }
          break
        }

        case 'codex-notify':
          // Codex hook — route to codex tabs.
          // Always forward to codex tabs so they can capture session_id and
          // detect completion. The panel handler decides what to do with it.
          if (data.source === 'codex') {
            safeDispatch(codexStopHookRefs.current, data, 'codex-notify→codex')
          }
          break

        case 'SubagentStop':
          // Subagent stopped — route by session_id or broadcast
          if (hookSessionId) {
            if (!dispatchBySessionId(hookSessionId, data)) {
              broadcastToAll(data, 'SubagentStop(unmatched)')
            }
          } else {
            broadcastToAll(data, 'SubagentStop(no-session)')
          }
          break

        // SessionEnd, PostToolUse, PreToolUse, UserPromptSubmit, Notification:
        // These are informational — file tree refresh is already handled above.
        // No panel dispatch needed for these events.
        default:
          break
      }
    }

    return () => {
      window.__onHookNotify = undefined
    }
  }, [])

  const handleContinueChange = (changeId: string) => {
    const tabId = `change-${changeId}-${Date.now()}`
    setChangeTabs(prev => [...prev, { id: tabId, mode: 'continue_change', changeId }])
    setActiveChangeTabId(tabId)
    setActiveTab('change')
  }

  const handleNewChange = () => {
    const tabId = `change-new-${Date.now()}`
    setChangeTabs(prev => [...prev, { id: tabId, mode: 'new_change' }])
    setChangeResetKeys(prev => new Map(prev).set(tabId, 0))
    setActiveChangeTabId(tabId)
    setActiveTab('change')
  }

  const handleReactivateChange = async (archivedName: string, originalName: string) => {
    if (!tree?.nativePath) return

    const confirmed = window.confirm(
      `Reactivate change "${originalName}"?\n\n` +
      `This will move the archived change back to active changes.\n` +
      `Warning: There may be conflicts if a change with the same name already exists.`
    )

    if (!confirmed) return

    const bridge = window.__nativeBridge
    if (!bridge) {
      alert('Native bridge not available')
      return
    }

    const archivePath = `${tree.nativePath}/openspec/changes/archive/${archivedName}`
    const targetPath = `${tree.nativePath}/openspec/changes/${originalName}`

    try {
      // Check if target already exists
      const checkResult = await bridge.readDirectory(targetPath)
      if (checkResult.success) {
        alert(`Cannot reactivate: A change named "${originalName}" already exists in active changes.`)
        return
      }
    } catch (e) {
      // Target doesn't exist, proceed
    }

    // Execute mv command via terminal
    const command = `mv "${archivePath}" "${targetPath}"`
    bridge.runCommand(command)

    // Wait a bit then refresh
    setTimeout(() => refreshDirectory(), 1000)
  }

  const handleCloseChangeTab = (tabId: string) => {
    if (!window.confirm('Close this tab? Any unsaved progress will be lost.')) return
    const bridge = window.__nativeBridge
    if (bridge) {
      bridge.stopChangeTerminal(tabId)
      bridge.untrackChangeSession(tabId)
    }
    const remaining = changeTabs.filter(t => t.id !== tabId)
    setChangeTabs(remaining)
    changeStopHookRefs.current.delete(tabId)
    changeSessionIdRefs.current.delete(tabId)
    setChangeSessionDisplays(prev => { const m = new Map(prev); m.delete(tabId); return m })
    setChangeResetKeys(prev => { const m = new Map(prev); m.delete(tabId); return m })
    setChangeBusyMap(prev => { const m = new Map(prev); m.delete(tabId); return m })
    if (remaining.length === 0) {
      setActiveChangeTabId(null)
      setActiveTab('viewer')
    } else if (activeChangeTabId === tabId) {
      setActiveChangeTabId(remaining[remaining.length - 1].id)
    }
  }

  const handleCloseCodex = (tabId: string) => {
    if (!window.confirm('Close Codex Worker tab? Any unsaved progress will be lost.')) return
    const bridge = window.__nativeBridge
    if (bridge) {
      bridge.stopReviewTerminal()
      bridge.untrackCodexSession(tabId)
    }
    const remaining = codexTabs.filter(t => t.id !== tabId)
    setCodexTabs(remaining)
    codexStopHookRefs.current.delete(tabId)
    codexSessionIdRefs.current.delete(tabId)
    setCodexSessionDisplays(prev => { const m = new Map(prev); m.delete(tabId); return m })
    if (remaining.length === 0) {
      setActiveCodexTabId(null)
      setActiveTab('viewer')
    } else if (activeCodexTabId === tabId) {
      setActiveCodexTabId(remaining[remaining.length - 1].id)
    }
  }

  const handleCodexChange = (changeId: string) => {
    // Create Codex Worker tab for this change
    const codexTabId = `codex-${changeId}-${Date.now()}`
    setCodexTabs(prev => [...prev, { id: codexTabId, changeId }])
    setActiveCodexTabId(codexTabId)
    
    // Create Droid Worker tab (no changeId = idle)
    const changeTabId = `change-new-${Date.now()}`
    setChangeTabs(prev => [...prev, { id: changeTabId, mode: 'new_change' }])
    setChangeResetKeys(prev => new Map(prev).set(changeTabId, 0))
    setActiveChangeTabId(changeTabId)
    
    // Switch to Codex Worker tab
    setActiveTab('codex')
  }

  const handleNewCodex = () => {
    // Create standalone Codex Worker tab (no changeId)
    const codexTabId = `codex-new-${Date.now()}`
    setCodexTabs(prev => [...prev, { id: codexTabId }])
    setActiveCodexTabId(codexTabId)
    setActiveTab('codex')
  }

  const handleNewDroid = () => {
    // Same as handleNewChange — create a new Droid Worker tab
    const tabId = `change-new-${Date.now()}`
    setChangeTabs(prev => [...prev, { id: tabId, mode: 'new_change' }])
    setChangeResetKeys(prev => new Map(prev).set(tabId, 0))
    setActiveChangeTabId(tabId)
    setActiveTab('change')
  }

  const handleOpen = async () => {
    try {
      setError(null)
      const root = await pickDirectory()
      setTree(root)
      setCanvasNode(root)
    } catch (e: any) {
      if (e.name !== 'AbortError') setError(e.message || 'Failed to open directory')
    }
  }

  const handleTreeSelect = (node: FileTreeNode) => {
    if (isSpecNode(node) || isArtifactNode(node)) setSelectedSpec(node)
    else if (isChangeNode(node) || node.kind === 'directory') setCanvasNode(node)
  }

  return (
    <div className="app">
      {/* Toolbar */}
      <header className="toolbar">
        <span className="logo">OpenSpec</span>
        <div className="toolbar-actions">
          {supported && (
            <>
              <button onClick={handleOpen}><FolderPlusIcon size={14} /> Open Project</button>
              {tree && window.__isNativeApp && (
                <>
                  <button onClick={refreshDirectory}><RefreshIcon size={14} /> Refresh</button>
                  <button onClick={handleNewDroid}><PlusCircleIcon size={14} /> New Droid</button>
                  <button onClick={handleNewCodex}><PlusCircleIcon size={14} /> New Codex</button>
                </>
              )}
            </>
          )}
          {error && <span style={{ color: '#e94560', fontSize: 12 }}>{error}</span>}
        </div>
      </header>

      {/* Tab bar */}
      <nav className="tab-bar">
        <button
          className={`tab-btn ${activeTab === 'viewer' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('viewer')}
        >
          Viewer
        </button>
        {window.__isNativeApp && (
          <>
            {changeTabs.map(tab => (
              <button
                key={tab.id}
                className={`tab-btn ${activeTab === 'change' && activeChangeTabId === tab.id ? 'tab-btn-active' : ''}`}
                onClick={() => {
                  setActiveChangeTabId(tab.id)
                  setActiveTab('change')
                }}
              >
                {changeBusyMap.get(tab.id) && <span className="tab-spinner" />}
                {' '}{tab.resumeSessionId ? '↻ ' : ''}{tab.changeId || 'Droid Worker'}
                {changeSessionDisplays.get(tab.id) ? ` (${changeSessionDisplays.get(tab.id)!.slice(0, 8)})` : ''}
                <span className="tab-close" onClick={(e) => { e.stopPropagation(); handleCloseChangeTab(tab.id) }}>
                  <CloseIcon size={12} />
                </span>
              </button>
            ))}
            {codexTabs.map(tab => (
              <button
                key={tab.id}
                className={`tab-btn ${activeTab === 'codex' && activeCodexTabId === tab.id ? 'tab-btn-active' : ''}`}
                onClick={() => { setActiveCodexTabId(tab.id); setActiveTab('codex') }}
              >
                {codexBusyMap.get(tab.id) && <span className="tab-spinner" />}
                {' '}{tab.resumeSessionId ? '↻ ' : ''}Codex Worker{tab.changeId ? `: ${tab.changeId}` : ''}
                {codexSessionDisplays.get(tab.id) ? ` (${codexSessionDisplays.get(tab.id)!.slice(0, 8)})` : ''}
                <span className="tab-close" onClick={(e) => { e.stopPropagation(); handleCloseCodex(tab.id) }}>
                  <CloseIcon size={12} />
                </span>
              </button>
            ))}
          </>
        )}
      </nav>

      {/* Tab content */}
      <div className="tab-content">
        {/* Tab 1: Viewer */}
        <div className="viewer-layout" style={{ display: activeTab === 'viewer' ? 'flex' : 'none' }}>
            <aside className="sidebar">
              {tree ? (
                <TreeView tree={tree} onSelectNode={handleTreeSelect} selectedSpec={selectedSpec} onContinueChange={handleContinueChange} onNewChange={handleNewChange} onReactivateChange={handleReactivateChange} onCodexChange={handleCodexChange} />
              ) : (
                <div className="sidebar-empty">No directory loaded</div>
              )}
            </aside>
            <section className="canvas">
              {canvasNode ? (
                <Canvas node={canvasNode} onSelectSpec={n => setSelectedSpec(n)} onOpenDir={n => setCanvasNode(n)} />
              ) : (
                <div className="canvas-empty">Select a directory to begin</div>
              )}
            </section>
        </div>

        {/* Change tabs (both new and continue) */}
        {window.__isNativeApp && changeTabs.map(tab => (
          <div key={tab.id} className="split-layout" style={{ display: activeTab === 'change' && activeChangeTabId === tab.id ? 'flex' : 'none' }}>
            <div className="split-left">
              <DroidWorkerBase
                tabId={tab.id}
                changeId={tab.changeId}
                resumeSessionId={tab.resumeSessionId}
                projectPath={tree?.nativePath}
                config={workerConfigs[tab.mode]}
                onStopHookRef={{
                  get current() { return changeStopHookRefs.current.get(tab.id) || null },
                  set current(value) { changeStopHookRefs.current.set(tab.id, value) }
                }}
                onRefresh={refreshDirectory}
                resetKey={changeResetKeys.get(tab.id) || 0}
                sessionIdRef={{
                  get current() { return changeSessionIdRefs.current.get(tab.id) || null },
                  set current(value) { changeSessionIdRefs.current.set(tab.id, value) }
                }}
                onSessionId={(id) => setChangeSessionDisplays(prev => new Map(prev).set(tab.id, id))}
                onBusyChange={(busy) => setChangeBusyMap(prev => new Map(prev).set(tab.id, busy))}
                onReviewAction={(changeId) => handleCodexChange(changeId)}
              />
            </div>
            <div className="split-right">
              <div className="split-right-header">Terminal</div>
              <EmbeddedTerminal channel="change" tabId={tab.id} />
            </div>
          </div>
        ))}

        {/* Codex Worker tabs */}
        {window.__isNativeApp && codexTabs.map(tab => (
          <div key={tab.id} className="split-layout" style={{ display: activeTab === 'codex' && activeCodexTabId === tab.id ? 'flex' : 'none' }}>
            <div className="split-left">
              <CodexPanel
                tabId={tab.id}
                changeId={tab.changeId}
                resumeSessionId={tab.resumeSessionId}
                projectPath={tree?.nativePath}
                onStopHookRef={{
                  get current() { return codexStopHookRefs.current.get(tab.id) || null },
                  set current(value) { codexStopHookRefs.current.set(tab.id, value) }
                }}
                onRefresh={refreshDirectory}
                sessionIdRef={{
                  get current() { return codexSessionIdRefs.current.get(tab.id) || null },
                  set current(value) { codexSessionIdRefs.current.set(tab.id, value) }
                }}
                onSessionId={(id) => setCodexSessionDisplays(prev => new Map(prev).set(tab.id, id))}
                onBusyChange={(busy) => setCodexBusyMap(prev => new Map(prev).set(tab.id, busy))}
              />
            </div>
            <div className="split-right">
              <div className="split-right-header">Terminal</div>
              <EmbeddedTerminal channel="review" />
            </div>
          </div>
        ))}

      </div>

      {/* Editor panel (viewer tab only) */}
      {activeTab === 'viewer' && selectedSpec && (
        <EditorPanel spec={selectedSpec} onClose={() => setSelectedSpec(null)} projectPath={tree?.nativePath} />
      )}
    </div>
  )
}

export default App
