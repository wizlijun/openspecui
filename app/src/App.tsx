import { useState, useCallback, useRef, useEffect } from 'react'
import './App.css'
import { pickDirectory, isFileSystemAccessSupported, isSpecNode, isArtifactNode, isChangeNode } from './useDirectoryPicker'
import type { FileTreeNode } from './useDirectoryPicker'
import { TreeView } from './TreeView'
import { Canvas } from './Canvas'
import { EditorPanel } from './EditorPanel'
import { EmbeddedTerminal } from './EmbeddedTerminal'
import { FolderPlusIcon, PlusCircleIcon, CloseIcon, RefreshIcon } from './Icons'
import { DroidWorkerBase } from './DroidWorkerBase'
import type { WorkerMode, DroidWorkerConfig } from './DroidWorkerBase'
import { loadWorkerConfigs, DEFAULT_WORKER_CONFIGS } from './loadWorkerConfig'
import { CodexWorkerBase } from './CodexWorkerBase'
import type { CodexWorkerMode, CodexWorkerConfig } from './CodexWorkerBase'
import { loadCodexWorkerConfigs, DEFAULT_CODEX_CONFIGS } from './loadCodexWorkerConfig'
import { loadConfirmationCardConfig, DEFAULT_CONFIRMATION_CARD_CONFIG } from './loadConfirmationCardConfig'
import type { ConfirmationCardConfig } from './loadConfirmationCardConfig'

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
  mode: CodexWorkerMode
  changeId?: string  // Optional: if provided, context is for this change
  resumeSessionId?: string  // If provided, resume existing session
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
  const [changeAutoSendMessages, setChangeAutoSendMessages] = useState<Map<string, string>>(new Map())
  const [workerConfigs, setWorkerConfigs] = useState<Record<WorkerMode, DroidWorkerConfig>>(DEFAULT_WORKER_CONFIGS)
  const [codexConfigs, setCodexConfigs] = useState<Record<CodexWorkerMode, CodexWorkerConfig>>(DEFAULT_CODEX_CONFIGS)
  const [confirmationCardConfig, setConfirmationCardConfig] = useState<ConfirmationCardConfig>(DEFAULT_CONFIRMATION_CARD_CONFIG)
  const changeStopHookRefs = useRef<Map<string, ((data: any) => void) | null>>(new Map())
  const codexStopHookRefs = useRef<Map<string, ((data: any) => void) | null>>(new Map())
  const changeSessionIdRefs = useRef<Map<string, string | null>>(new Map())
  const codexSessionIdRefs = useRef<Map<string, string | null>>(new Map())
  const changeSendMessageRefs = useRef<Map<string, ((message: string) => void) | null>>(new Map())
  // Track codex tabs waiting for their first ping (session binding) with unique tokens.
  // Maps pending_session_token → tabId for precise routing of codex-notify events.
  const codexPendingTokensRef = useRef<Map<string, string>>(new Map())  // token → tabId
  // Track codex tabs that are initializing (FIFO queue for session binding)
  const codexInitializingTabsRef = useRef<string[]>([])
  // Bidirectional worker binding: Codex Worker ↔ Droid Worker (by tabId/workerId)
  const codexToDroidRef = useRef<Map<string, string>>(new Map())  // codexTabId → droidTabId
  const droidToCodexRef = useRef<Map<string, string>>(new Map())  // droidTabId → codexTabId

  const supported = isFileSystemAccessSupported()

  // Load worker configs when project path changes
  useEffect(() => {
    if (!tree?.nativePath) {
      setWorkerConfigs(DEFAULT_WORKER_CONFIGS)
      setCodexConfigs(DEFAULT_CODEX_CONFIGS)
      setConfirmationCardConfig(DEFAULT_CONFIRMATION_CARD_CONFIG)
      return
    }
    loadWorkerConfigs(tree.nativePath).then(configs => {
      setWorkerConfigs(configs)
    })
    loadCodexWorkerConfigs(tree.nativePath).then(configs => {
      setCodexConfigs(configs)
    })
    loadConfirmationCardConfig(tree.nativePath).then(config => {
      setConfirmationCardConfig(config)
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
          mode: session.changeId ? 'code_review' : 'standalone',
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
          // Droid session started — broadcast to change tabs.
          // Only the tab waiting for init (initializedRef=false) will accept it.
          safeDispatch(changeStopHookRefs.current, data, 'SessionStart→change')
          break

        case 'Stop': {
          // Droid/Codex session stopped — prefer session routing; fallback to broadcast to both.
          if (hookSessionId) {
            if (!dispatchBySessionId(hookSessionId, data)) {
              console.warn(`[Hook] Stop: session_id=${hookSessionId} did not match any tab, broadcasting to all tabs`)
              safeDispatch(changeStopHookRefs.current, data, 'Stop(unmatched)→change')
              safeDispatch(codexStopHookRefs.current, data, 'Stop(unmatched)→codex')
            }
          } else {
            console.warn('[Hook] Stop: no session_id, broadcasting to all tabs')
            safeDispatch(changeStopHookRefs.current, data, 'Stop(no-session)→change')
            safeDispatch(codexStopHookRefs.current, data, 'Stop(no-session)→codex')
          }
          break
        }

        case 'codex-notify': {
          // Codex hook — route by session_id to the owning codex tab.
          // If session_id doesn't match any tab (e.g. first ping response before
          // session is bound), use pending_session_token for precise routing;
          // fall back to FIFO only if token is missing.
          if (hookSessionId) {
            if (!dispatchBySessionId(hookSessionId, data)) {
              // Unmatched session — try pending_session_token for precise routing
              const pendingToken: string = (data.pending_session_token || '').trim()
              const tokenMatchTabId = pendingToken ? codexPendingTokensRef.current.get(pendingToken) : undefined

              if (tokenMatchTabId) {
                const handler = codexStopHookRefs.current.get(tokenMatchTabId)
                if (handler) {
                  console.log(`[Hook] codex-notify(token-match) → tab ${tokenMatchTabId} via token ${pendingToken.slice(0, 16)}...`)
                  try { handler(data) } catch (e) { console.error(`[Hook] Error in codex tab ${tokenMatchTabId}:`, e) }
                }
              } else {
                // Fallback: FIFO — dispatch to the oldest initializing tab
                const pending = codexInitializingTabsRef.current
                if (pending.length > 0) {
                  const initTabId = pending[0]
                  const handler = codexStopHookRefs.current.get(initTabId)
                  if (handler) {
                    console.log(`[Hook] codex-notify(FIFO-fallback) → initializing tab ${initTabId} (${pending.length} pending)`)
                    try { handler(data) } catch (e) { console.error(`[Hook] Error in codex tab ${initTabId}:`, e) }
                  }
                } else {
                  console.warn('[Hook] codex-notify: unmatched session_id, no token match, and no initializing tabs')
                }
              }
            }
          } else {
            // No session_id — broadcast to codex tabs
            if (data.source === 'codex') {
              safeDispatch(codexStopHookRefs.current, data, 'codex-notify(no-session)→codex')
            }
          }
          break
        }

        case 'SubagentStop':
          // Subagent stopped — prefer session routing; fallback to broadcast.
          if (hookSessionId) {
            if (!dispatchBySessionId(hookSessionId, data)) {
              console.warn(`[Hook] SubagentStop: session_id=${hookSessionId} did not match any tab, broadcasting`)
              safeDispatch(changeStopHookRefs.current, data, 'SubagentStop(unmatched)→change')
              safeDispatch(codexStopHookRefs.current, data, 'SubagentStop(unmatched)→codex')
            }
          } else {
            console.warn('[Hook] SubagentStop: no session_id, broadcasting')
            safeDispatch(changeStopHookRefs.current, data, 'SubagentStop(no-session)→change')
            safeDispatch(codexStopHookRefs.current, data, 'SubagentStop(no-session)→codex')
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
    console.log(`[TabLifecycle] handleCloseChangeTab called for ${tabId}`)
    if (!window.confirm('Close this tab? Any unsaved progress will be lost.')) return
    // Mark this tab as closing so cleanup effect knows to kill terminal
    if (!window.__closingTabs) window.__closingTabs = new Set()
    window.__closingTabs.add(tabId)
    const bridge = window.__nativeBridge
    if (bridge) {
      bridge.stopChangeTerminal(tabId)
      bridge.untrackChangeSession(tabId)
    }
    const remaining = changeTabs.filter(t => t.id !== tabId)
    setChangeTabs(remaining)
    changeStopHookRefs.current.delete(tabId)
    changeSessionIdRefs.current.delete(tabId)
    changeSendMessageRefs.current.delete(tabId)
    setChangeSessionDisplays(prev => { const m = new Map(prev); m.delete(tabId); return m })
    setChangeResetKeys(prev => { const m = new Map(prev); m.delete(tabId); return m })
    setChangeBusyMap(prev => { const m = new Map(prev); m.delete(tabId); return m })
    // Clean up worker binding
    const boundCodexId = droidToCodexRef.current.get(tabId)
    if (boundCodexId) {
      codexToDroidRef.current.delete(boundCodexId)
      droidToCodexRef.current.delete(tabId)
      console.log(`[WorkerBinding] Removed binding for Droid ${tabId}`)
    }
    if (remaining.length === 0) {
      setActiveChangeTabId(null)
      setActiveTab('viewer')
    } else if (activeChangeTabId === tabId) {
      setActiveChangeTabId(remaining[remaining.length - 1].id)
    }
  }

  const handleCloseCodex = (tabId: string) => {
    console.log(`[TabLifecycle] handleCloseCodex called for ${tabId}`)
    if (!window.confirm('Close Codex Worker tab? Any unsaved progress will be lost.')) return
    // Mark this tab as closing so cleanup effect knows to kill terminal
    if (!window.__closingTabs) window.__closingTabs = new Set()
    window.__closingTabs.add(tabId)
    const bridge = window.__nativeBridge
    if (bridge) {
      bridge.stopChangeTerminal(tabId)
      bridge.untrackCodexSession(tabId)
    }
    const remaining = codexTabs.filter(t => t.id !== tabId)
    setCodexTabs(remaining)
    codexStopHookRefs.current.delete(tabId)
    codexSessionIdRefs.current.delete(tabId)
    // Remove from initializing queue if still pending
    codexInitializingTabsRef.current = codexInitializingTabsRef.current.filter(t => t !== tabId)
    setCodexSessionDisplays(prev => { const m = new Map(prev); m.delete(tabId); return m })
    // Clean up worker binding
    const boundDroidId = codexToDroidRef.current.get(tabId)
    if (boundDroidId) {
      droidToCodexRef.current.delete(boundDroidId)
      codexToDroidRef.current.delete(tabId)
      console.log(`[WorkerBinding] Removed binding for Codex ${tabId}`)
    }
    if (remaining.length === 0) {
      setActiveCodexTabId(null)
      setActiveTab('viewer')
    } else if (activeCodexTabId === tabId) {
      setActiveCodexTabId(remaining[remaining.length - 1].id)
    }
  }

  const handleCodexChange = (changeId: string) => {
    // Create Codex Worker tab for this change (review mode)
    const codexTabId = `codex-${changeId}-${Date.now()}`
    codexInitializingTabsRef.current = [...codexInitializingTabsRef.current, codexTabId]
    setCodexTabs(prev => [...prev, { id: codexTabId, mode: 'code_review', changeId }])
    setActiveCodexTabId(codexTabId)

    // NOTE: Droid Worker is NOT created here.
    // It will be auto-created on demand when user clicks "Droid Fix" (via handleDroidFixRequest).

    // Switch to Codex Worker tab
    setActiveTab('codex')
  }

  const handleDroidFixRequest = useCallback((selectedItems: string[], codexWorkerId: string) => {
    // Build fix message
    let template = '请按选择的评审意见，先思考原因，再解决，再调试通过：\n{selected_items}'
    for (const scenario of Object.values(confirmationCardConfig.scenarios)) {
      const btn = scenario.buttons.find(b => b.target === 'droid_worker')
      if (btn?.messageTemplate) {
        template = btn.messageTemplate
        break
      }
    }
    const itemsText = selectedItems.map(item => `- ${item}`).join('\n')
    const fixMessage = template.replace('{selected_items}', itemsText)

    // Find bound Droid Worker by workerId
    let droidWorkerId = codexToDroidRef.current.get(codexWorkerId)

    if (!droidWorkerId) {
      // No bound Droid Worker → create a fix_review mode Droid Worker
      console.log(`[DroidFixRequest] Auto-creating fix_review Droid Worker for Codex ${codexWorkerId}`)
      const newDroidTabId = `change-fix-${Date.now()}`
      const codexTab = codexTabs.find(t => t.id === codexWorkerId)
      const changeId = codexTab?.changeId
      
      const newTab = { id: newDroidTabId, mode: 'fix_review' as const, changeId }
      setChangeTabs(prev => [...prev, newTab])
      setChangeResetKeys(prev => new Map(prev).set(newDroidTabId, 0))
      setChangeAutoSendMessages(prev => new Map(prev).set(newDroidTabId, fixMessage))
      setActiveChangeTabId(newDroidTabId)
      setActiveTab('change')

      // Establish bidirectional binding
      codexToDroidRef.current.set(codexWorkerId, newDroidTabId)
      droidToCodexRef.current.set(newDroidTabId, codexWorkerId)
      console.log(`[WorkerBinding] Codex ${codexWorkerId} ↔ Droid ${newDroidTabId} (auto-created)`)
      return
    }

    // Get the send message function for the bound Droid Worker
    const sendMessage = changeSendMessageRefs.current.get(droidWorkerId)
    if (!sendMessage) {
      console.warn(`[DroidFixRequest] No sendMessage function for Droid Worker ${droidWorkerId}`)
      alert('Droid Worker 尚未就绪，请稍后重试')
      return
    }

    // Switch to the Droid Worker tab and send
    setActiveChangeTabId(droidWorkerId)
    setActiveTab('change')
    setTimeout(() => {
      sendMessage(fixMessage)
    }, 100)
  }, [codexTabs, confirmationCardConfig])

  const handleNewCodex = () => {
    // Create standalone Codex Worker tab (no changeId)
    const codexTabId = `codex-new-${Date.now()}`
    codexInitializingTabsRef.current = [...codexInitializingTabsRef.current, codexTabId]
    setCodexTabs(prev => [...prev, { id: codexTabId, mode: 'standalone' as const }])
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
                onSendMessageRef={{
                  get current() { return changeSendMessageRefs.current.get(tab.id) || null },
                  set current(value) { changeSendMessageRefs.current.set(tab.id, value) }
                }}
                autoSendMessage={changeAutoSendMessages.get(tab.id)}
                confirmationCardConfig={confirmationCardConfig}
              />
            </div>
            <div className="split-right">
              <div className="split-right-header">Terminal</div>
              <EmbeddedTerminal channel="droid" tabId={tab.id} />
            </div>
          </div>
        ))}

        {/* Codex Worker tabs */}
        {window.__isNativeApp && codexTabs.map(tab => (
          <div key={tab.id} className="split-layout" style={{ display: activeTab === 'codex' && activeCodexTabId === tab.id ? 'flex' : 'none' }}>
            <div className="split-left">
              <CodexWorkerBase
                tabId={tab.id}
                changeId={tab.changeId}
                resumeSessionId={tab.resumeSessionId}
                projectPath={tree?.nativePath}
                config={codexConfigs[tab.mode]}
                onStopHookRef={{
                  get current() { return codexStopHookRefs.current.get(tab.id) || null },
                  set current(value) { codexStopHookRefs.current.set(tab.id, value) }
                }}
                onRefresh={refreshDirectory}
                sessionIdRef={{
                  get current() { return codexSessionIdRefs.current.get(tab.id) || null },
                  set current(value) { codexSessionIdRefs.current.set(tab.id, value) }
                }}
                onSessionId={(id) => {
                  setCodexSessionDisplays(prev => new Map(prev).set(tab.id, id))
                  // Remove this tab from the initializing queue now that its session is bound
                  codexInitializingTabsRef.current = codexInitializingTabsRef.current.filter(t => t !== tab.id)
                }}
                onBusyChange={(busy) => setCodexBusyMap(prev => new Map(prev).set(tab.id, busy))}
                onDroidFixRequest={handleDroidFixRequest}
                confirmationCardConfig={confirmationCardConfig}
                onInitComplete={() => {
                  // Dequeue from initializing list when init completes (success or timeout)
                  codexInitializingTabsRef.current = codexInitializingTabsRef.current.filter(t => t !== tab.id)
                }}
                onPendingToken={(token) => {
                  if (token) {
                    // Register token → tabId for precise routing
                    codexPendingTokensRef.current.set(token, tab.id)
                  } else {
                    // Clear: remove any token pointing to this tab
                    codexPendingTokensRef.current.forEach((tid, tk) => {
                      if (tid === tab.id) codexPendingTokensRef.current.delete(tk)
                    })
                  }
                }}
              />
            </div>
            <div className="split-right">
              <div className="split-right-header">Terminal</div>
              <EmbeddedTerminal channel="codex" tabId={tab.id} />
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
