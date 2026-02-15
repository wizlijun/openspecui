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
import { triggerCelebration } from './celebrationUtils'
import { nativeLog } from './nativeLog'
import { saveReviewEntry, startCommitPolling, stopCommitPolling } from './reviewPersistenceService'
import { decideAutoFixNext } from './autoFixStateMachine'

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
  disableAutoInitPrompt?: boolean  // If true, skip auto-sending config.autoInitPrompt (used by Self-Review Cycle)
}

const formatSessionDisplay = (sessionId: string): string => {
  if (!sessionId) return ''
  return sessionId.length <= 8 ? sessionId : sessionId.slice(-8)
}



// ─── Main App ──────────────────────────────────────────────────────

function App() {
  const [activeTab, setActiveTabRaw] = useState<TabType>('viewer')

  // Wrap setActiveTab with logging
  const setActiveTab = useCallback((tab: TabType) => {
    console.log(`[TabLifecycle] setActiveTab: ${activeTab} → ${tab}`)
    setActiveTabRaw(tab)
  }, [activeTab])

  const [tree, setTree] = useState<FileTreeNode | null>(null)
  const [canvasNode, setCanvasNode] = useState<FileTreeNode | null>(null)
  const [selectedSpec, setSelectedSpec] = useState<FileTreeNode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [autoLoaded, setAutoLoaded] = useState(false)
  const [changeTabs, setChangeTabsRaw] = useState<ChangeTab[]>([])
  const [activeChangeTabId, setActiveChangeTabId] = useState<string | null>(null)
  const [codexTabs, setCodexTabsRaw] = useState<CodexTab[]>([])
  const [activeCodexTabId, setActiveCodexTabId] = useState<string | null>(null)

  // Wrap tab setters with logging
  const setChangeTabs: typeof setChangeTabsRaw = useCallback((action) => {
    setChangeTabsRaw(prev => {
      const next = typeof action === 'function' ? action(prev) : action
      console.log(`[TabLifecycle] setChangeTabs: ${prev.map(t=>t.id).join(',')} → ${next.map(t=>t.id).join(',')} (count: ${prev.length} → ${next.length})`)
      if (next.length < prev.length) {
        const removed = prev.filter(t => !next.find(n => n.id === t.id))
        console.warn(`[TabLifecycle] ⚠ Change tabs REMOVED: ${removed.map(t=>t.id).join(',')}`)
        nativeLog('warn', `[TabLifecycle] ⚠ Change tabs REMOVED: ${removed.map(t=>t.id).join(',')}`)
        console.trace('[TabLifecycle] Change tabs removal stack')
      }
      return next
    })
  }, [])

  const setCodexTabs: typeof setCodexTabsRaw = useCallback((action) => {
    setCodexTabsRaw(prev => {
      const next = typeof action === 'function' ? action(prev) : action
      console.log(`[TabLifecycle] setCodexTabs: ${prev.map(t=>t.id).join(',')} → ${next.map(t=>t.id).join(',')} (count: ${prev.length} → ${next.length})`)
      if (next.length < prev.length) {
        const removed = prev.filter(t => !next.find(n => n.id === t.id))
        console.warn(`[TabLifecycle] ⚠ Codex tabs REMOVED: ${removed.map(t=>t.id).join(',')}`)
        nativeLog('warn', `[TabLifecycle] ⚠ Codex tabs REMOVED: ${removed.map(t=>t.id).join(',')}`)
        console.trace('[TabLifecycle] Codex tabs removal stack')
      }
      return next
    })
  }, [])
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
  const changeSendMessageRefs = useRef<Map<string, ((message: string) => boolean) | null>>(new Map())
  const codexSendMessageRefs = useRef<Map<string, ((message: string) => boolean) | null>>(new Map())
  // Track codex tabs waiting for their first ping (session binding) with unique tokens.
  // Maps pending_session_token → tabId for precise routing of codex-notify events.
  const codexPendingTokensRef = useRef<Map<string, string>>(new Map())  // token → tabId
  // Track codex tabs that are initializing (FIFO queue for session binding)
  const codexInitializingTabsRef = useRef<string[]>([])
  // Bidirectional worker binding: Codex Worker ↔ Droid Worker (by tabId/workerId)
  const codexToDroidRef = useRef<Map<string, string>>(new Map())  // codexTabId → droidTabId
  const droidToCodexRef = useRef<Map<string, string>>(new Map())  // droidTabId → codexTabId
  // Auto Fix loop state: tracks which Codex Workers are in Auto Fix mode
  const [autoFixActiveMap, setAutoFixActiveMap] = useState<Map<string, { active: boolean; cycleCount: number; stage: 'fixing' | 'reviewing' }>>(new Map())
  // Refs for triggering re-review on Codex Workers (set by CodexWorkerBase)
  const codexTriggerReReviewRefs = useRef<Map<string, (() => void) | null>>(new Map())
  // Refs for pushing status messages to Codex Worker history (set by CodexWorkerBase)
  const codexPushHistoryRefs = useRef<Map<string, ((msg: string) => void) | null>>(new Map())
  // Refs for dismissing confirmation cards on Codex Workers (set by CodexWorkerBase)
  const codexDismissConfirmationRefs = useRef<Map<string, (() => void) | null>>(new Map())
  // Track pending Auto Fix activations (droidTabId → codexTabId) — activated when Droid sends autoSendMessage
  const pendingAutoFixActivationsRef = useRef<Map<string, string>>(new Map())
  const MAX_AUTOFIX_CYCLES = 10

  const supported = isFileSystemAccessSupported()

  // ─── App lifecycle tracking ──────────────────────────────────────
  useEffect(() => {
    nativeLog('log', '[App] ✅ MOUNTED — changeTabs:', changeTabs.length, 'codexTabs:', codexTabs.length)
    return () => {
      nativeLog('warn', '[App] ❌ UNMOUNTED — this means React tree was destroyed!')
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

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

  // Task 4.1: Start/stop git commit polling when project path changes
  useEffect(() => {
    if (!tree?.nativePath) {
      stopCommitPolling()
      return
    }
    startCommitPolling(tree.nativePath)
    return () => stopCommitPolling()
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
      // Extract session id with fallback to payload keys for backward compatibility.
      // Some hook emitters only provide thread-id in payload.
      const payload = (data.payload && typeof data.payload === 'object') ? data.payload : {}
      const hookSessionId: string | null = (
        data.session_id ||
        payload['thread-id'] ||
        payload.thread_id ||
        payload.session_id ||
        payload['session-id'] ||
        payload.conversation_id ||
        payload['conversation-id'] ||
        null
      )
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
            // No session_id — never broadcast to all codex tabs, otherwise multiple
            // tabs may bind to the same session. Try pending_session_token only.
            const pendingToken: string = (data.pending_session_token || '').trim()
            const tokenMatchTabId = pendingToken ? codexPendingTokensRef.current.get(pendingToken) : undefined
            if (tokenMatchTabId) {
              const handler = codexStopHookRefs.current.get(tokenMatchTabId)
              if (handler) {
                console.log(`[Hook] codex-notify(no-session token-match) → tab ${tokenMatchTabId} via token ${pendingToken.slice(0, 16)}...`)
                try { handler(data) } catch (e) { console.error(`[Hook] Error in codex tab ${tokenMatchTabId}:`, e) }
              }
            } else {
              console.warn('[Hook] codex-notify: no session_id and no token match, event ignored to avoid misbinding')
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

  // ─── Auto Fix Worker Creation Handler ────────────────────────────
  // Called by the native Auto Fix window to create visible Codex + Droid tabs
  useEffect(() => {
    if (!window.__isNativeApp) return

    window.__onCreateAutoFixWorkers = (data: any) => {
      const { codexTabId, droidTabId, changeId } = data
      console.log(`[SelfReviewCycle] Creating worker tabs: codex=${codexTabId}, droid=${droidTabId}, change=${changeId}`)

      // Create Codex Worker tab (do NOT add to codexInitializingTabsRef — Self-Review Cycle has its own init detection)
      // CRITICAL: disableAutoInitPrompt=true to prevent race with Self-Review Cycle's own review prompt
      setCodexTabs(prev => [...prev, { id: codexTabId, mode: 'code_review' as CodexWorkerMode, changeId: changeId || undefined, disableAutoInitPrompt: true }])
      setActiveCodexTabId(codexTabId)

      // Create Droid Worker tab
      const droidTab = { id: droidTabId, mode: 'fix_review' as WorkerMode, changeId: changeId || undefined }
      setChangeTabs(prev => [...prev, droidTab])
      setChangeResetKeys(prev => new Map(prev).set(droidTabId, 0))
      setActiveChangeTabId(droidTabId)

      // Switch to Codex tab to show it
      setActiveTab('codex')
    }

    return () => {
      window.__onCreateAutoFixWorkers = undefined
    }
  }, [])

  // ─── Auto Fix Dismiss Confirmation Card Handler ──────────────────
  useEffect(() => {
    if (!window.__isNativeApp) return

    window.__onDismissConfirmationCard = (data: any) => {
      const { codexTabId } = data
      console.log(`[AutoFix] Dismissing confirmation card for Codex ${codexTabId}`)
      const dismiss = codexDismissConfirmationRefs.current.get(codexTabId)
      if (dismiss) dismiss()
    }

    return () => {
      window.__onDismissConfirmationCard = undefined
    }
  }, [])

  // ─── Auto Fix Complete Handler ────────────────────────────────────
  useEffect(() => {
    if (!window.__isNativeApp) return

    window.__onAutoFixComplete = (data: any) => {
      const { success, message, cycles, changeId } = data
      console.log(`[AutoFix] Complete: success=${success}, cycles=${cycles}, change=${changeId}, msg=${message}`)
      // Optional: show a notification or update UI state
      // For now, just log it — the Auto Fix window already shows the result
    }

    return () => {
      window.__onAutoFixComplete = undefined
    }
  }, [])

  // ─── Self-Review Cycle: Send to Worker Handler ───────────────────
  // Called by the native Self-Review Cycle window to send messages to worker tabs via UI
  useEffect(() => {
    if (!window.__isNativeApp) return

    window.__onAutoFixSendToWorker = (data: any) => {
      const { workerType, tabId, message } = data
      console.log(`[SelfReviewCycle] Send to ${workerType} tab ${tabId}: ${message.substring(0, 50)}...`)

      let success = false
      if (workerType === 'codex') {
        const sendRef = codexSendMessageRefs.current.get(tabId)
        if (sendRef) {
          success = sendRef(message)
        } else {
          console.warn(`[SelfReviewCycle] No sendMessage ref for Codex tab ${tabId}`)
        }
      } else if (workerType === 'droid') {
        const sendRef = changeSendMessageRefs.current.get(tabId)
        if (sendRef) {
          success = sendRef(message)
        } else {
          console.warn(`[SelfReviewCycle] No sendMessage ref for Droid tab ${tabId}`)
        }
      }

      // Report send result back to Python Auto Fix window
      if (!success) {
        console.warn(`[SelfReviewCycle] Send FAILED for ${workerType} tab ${tabId}`)
        try {
          const handler = window.webkit?.messageHandlers?.nativeBridge
          if (handler) {
            handler.postMessage(JSON.stringify({
              type: 'autoFixSendFailed',
              workerType,
              tabId,
            }))
          }
        } catch (e) {
          console.error('[SelfReviewCycle] Failed to notify Python of send failure:', e)
        }
      }
    }

    return () => {
      window.__onAutoFixSendToWorker = undefined
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
    nativeLog('log', `[TabLifecycle] handleCloseChangeTab called for ${tabId}`)
    if (!window.confirm('Close this tab? Any unsaved progress will be lost.')) {
      nativeLog('log', `[TabLifecycle] User cancelled close for change tab ${tabId}`)
      return
    }
    nativeLog('log', `[TabLifecycle] User confirmed close for change tab ${tabId}`)
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
      // Clean up Auto Fix state if bound Codex was in Auto Fix mode
      setAutoFixActiveMap(prev => { const m = new Map(prev); m.delete(boundCodexId); return m })
      console.log(`[WorkerBinding] Removed binding for Droid ${tabId}`)
    }
    // Clean up pending Auto Fix activations for this Droid tab
    pendingAutoFixActivationsRef.current.delete(tabId)
    if (remaining.length === 0) {
      setActiveChangeTabId(null)
      setActiveTab('viewer')
      console.log(`[TabLifecycle] Last change tab closed → switching to viewer`)
    } else if (activeChangeTabId === tabId) {
      setActiveChangeTabId(remaining[remaining.length - 1].id)
      console.log(`[TabLifecycle] Active change tab closed → switching to ${remaining[remaining.length - 1].id}`)
    }
  }

  const handleCloseCodex = (tabId: string) => {
    nativeLog('log', `[TabLifecycle] handleCloseCodex called for ${tabId}`)
    if (!window.confirm('Close Codex Worker tab? Any unsaved progress will be lost.')) {
      nativeLog('log', `[TabLifecycle] User cancelled close for codex tab ${tabId}`)
      return
    }
    nativeLog('log', `[TabLifecycle] User confirmed close for codex tab ${tabId}`)
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
    // Clean up pending tokens for this tab
    codexPendingTokensRef.current.forEach((tid, tk) => {
      if (tid === tabId) codexPendingTokensRef.current.delete(tk)
    })
    setCodexSessionDisplays(prev => { const m = new Map(prev); m.delete(tabId); return m })
    // Clean up Auto Fix state
    setAutoFixActiveMap(prev => { const m = new Map(prev); m.delete(tabId); return m })
    // Remove any pending Auto Fix activations that target this Codex tab
    pendingAutoFixActivationsRef.current.forEach((cid, did) => {
      if (cid === tabId) pendingAutoFixActivationsRef.current.delete(did)
    })
    codexTriggerReReviewRefs.current.delete(tabId)
    codexPushHistoryRefs.current.delete(tabId)
    codexDismissConfirmationRefs.current.delete(tabId)
    codexSendMessageRefs.current.delete(tabId)
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
      console.log(`[TabLifecycle] Last codex tab closed → switching to viewer`)
    } else if (activeCodexTabId === tabId) {
      setActiveCodexTabId(remaining[remaining.length - 1].id)
      console.log(`[TabLifecycle] Active codex tab closed → switching to ${remaining[remaining.length - 1].id}`)
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

  const handleDroidFixRequest = useCallback((selectedItems: string[], codexWorkerId: string, isAutoFix?: boolean, targetCycleCount?: number, scenarioKey?: string) => {
    // Task 4.2: Save review entry before sending fix (filename auto-generated from date + git hash)
    if (tree?.nativePath) {
      saveReviewEntry(tree.nativePath, selectedItems).catch(err => {
        console.warn('[ReviewPersistence] Failed to save review entry:', err)
      })
    }

    // Build fix message — use the matched scenario's button template when scenarioKey is provided
    const targetAction = isAutoFix ? 'auto_fix' : 'droid_fix'
    let template = '请按选择的评审意见，先思考原因，再解决，再调试通过：\n{selected_items}'

    // If scenarioKey is provided (from Auto Fix state machine), look up that specific scenario first
    const scenariosToSearch = scenarioKey && confirmationCardConfig.scenarios[scenarioKey]
      ? [confirmationCardConfig.scenarios[scenarioKey]]
      : Object.values(confirmationCardConfig.scenarios)

    for (const scenario of scenariosToSearch) {
      const exactBtn = scenario.buttons.find(b => b.action === targetAction && b.messageTemplate)
      const fallbackBtn = scenario.buttons.find(b => b.target === 'droid_worker' && b.messageTemplate)
      const btn = exactBtn || fallbackBtn
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

      // Defer Auto Fix activation — will be triggered by Droid after successful send
      if (isAutoFix) {
        pendingAutoFixActivationsRef.current.set(newDroidTabId, codexWorkerId)
        console.log(`[AutoFix] Pending activation for Codex ${codexWorkerId} — waiting for Droid ${newDroidTabId} to send`)
      }
      return
    }

    // Switch to the Droid Worker tab and send, then activate Auto Fix only after send succeeds
    setActiveChangeTabId(droidWorkerId)
    setActiveTab('change')
    
    // Calculate cycleCount BEFORE the deferred call to avoid ReferenceError
    const cycleCount = targetCycleCount ?? 1
    const boundDroidId = droidWorkerId

    // Use retry loop: the sendMessage ref may not be ready immediately after a
    // React state update (e.g. when the Droid tab was just created in a prior
    // cycle).  Retry up to 5 times with 100 ms intervals before giving up.
    let retries = 0
    const maxRetries = 5
    const trySend = () => {
      const fn = changeSendMessageRefs.current.get(boundDroidId)
      if (fn) {
        const success = fn(fixMessage)
        if (success && isAutoFix) {
          setAutoFixActiveMap(prev => {
            const m = new Map(prev)
            m.set(codexWorkerId, { active: true, cycleCount, stage: 'fixing' })
            return m
          })
          console.log(`[AutoFix] Started for Codex ${codexWorkerId} (cycle ${cycleCount})`)
        } else if (!success) {
          console.warn(`[DroidFixRequest] sendMessage failed for Droid ${boundDroidId} — Auto Fix not activated`)
          if (isAutoFix) {
            setAutoFixActiveMap(prev => { const m = new Map(prev); m.delete(codexWorkerId); return m })
            const pushHistory = codexPushHistoryRefs.current.get(codexWorkerId)
            if (pushHistory) pushHistory(`⚠ Auto Fix 停止：发送修复消息失败，请手动重试。`)
            alert('Auto Fix 停止：发送修复消息失败，请手动重试。')
          }
        }
      } else if (retries < maxRetries) {
        retries++
        setTimeout(trySend, 100)
      } else {
        console.warn(`[DroidFixRequest] sendMessage ref not available after ${maxRetries} retries for Droid ${boundDroidId}`)
        if (isAutoFix) {
          setAutoFixActiveMap(prev => { const m = new Map(prev); m.delete(codexWorkerId); return m })
          const pushHistory = codexPushHistoryRefs.current.get(codexWorkerId)
          if (pushHistory) pushHistory(`⚠ Auto Fix 停止：Droid Worker 尚未就绪。`)
        }
        alert('Droid Worker 尚未就绪，请稍后重试')
      }
    }
    // Defer to next tick so React can flush state updates first
    setTimeout(trySend, 50)
  }, [codexTabs, confirmationCardConfig, tree?.nativePath])

  // ─── Auto Fix Loop Callbacks ─────────────────────────────────────

  /** Droid Worker completed fix → trigger Codex re-review */
  const handleDroidFixComplete = useCallback((droidWorkerId: string) => {
    const codexWorkerId = droidToCodexRef.current.get(droidWorkerId)
    if (!codexWorkerId) return

    const autoFixState = autoFixActiveMap.get(codexWorkerId)
    // Only proceed if in Auto Fix mode AND in fixing stage
    if (!autoFixState?.active || autoFixState.stage !== 'fixing') return

    console.log(`[AutoFix] Droid ${droidWorkerId} fix complete → triggering Codex ${codexWorkerId} re-review (cycle ${autoFixState.cycleCount})`)

    // Update stage to reviewing
    setAutoFixActiveMap(prev => {
      const m = new Map(prev)
      const state = m.get(codexWorkerId)
      if (state) m.set(codexWorkerId, { ...state, stage: 'reviewing' })
      return m
    })

    // Trigger re-review on the bound Codex Worker
    const triggerReReview = codexTriggerReReviewRefs.current.get(codexWorkerId)
    if (triggerReReview) {
      triggerReReview()
    } else {
      console.warn(`[AutoFix] No triggerReReview ref for Codex ${codexWorkerId}`)
    }
  }, [autoFixActiveMap])

  /** Codex Worker completed re-review → analyze P0/P1 and decide next step */
  const handleAutoFixReviewComplete = useCallback((resultText: string, codexWorkerId: string) => {
    const autoFixState = autoFixActiveMap.get(codexWorkerId)
    // Only proceed if in Auto Fix mode AND in reviewing stage
    if (!autoFixState?.active || autoFixState.stage !== 'reviewing') return

    console.log(`[AutoFix] Codex ${codexWorkerId} review complete (cycle ${autoFixState.cycleCount})`)

    // Helper: push status message to Codex Worker history for traceability
    const pushHistory = (msg: string) => {
      const push = codexPushHistoryRefs.current.get(codexWorkerId)
      if (push) push(msg)
    }

    // Guard: need config to make a decision
    if (!confirmationCardConfig) {
      console.warn(`[AutoFix] ⚠ No confirmationCardConfig for Codex ${codexWorkerId} — stopping Auto Fix`)
      setAutoFixActiveMap(prev => { const m = new Map(prev); m.delete(codexWorkerId); return m })
      pushHistory(`⚠ Auto Fix 停止 (cycle ${autoFixState.cycleCount})：缺少配置，请检查。`)
      return
    }

    // Delegate decision to the pure state machine (same logic tested in autoFixStateMachine.test.ts)
    const decision = decideAutoFixNext(resultText, autoFixState, confirmationCardConfig, MAX_AUTOFIX_CYCLES)

    switch (decision.action) {
      case 'complete':
        console.log(`[AutoFix] ✅ Complete for Codex ${codexWorkerId} — no P0/P1 issues remaining (cycle ${decision.cycleCount})`)
        setAutoFixActiveMap(prev => { const m = new Map(prev); m.delete(codexWorkerId); return m })
        pushHistory(`🎉 Auto Fix 完成 (共 ${decision.cycleCount} 轮)：所有 P0/P1 问题已解决！`)
        triggerCelebration()
        break

      case 'stop':
        switch (decision.reason) {
          case 'no_scenario_match':
            console.warn(`[AutoFix] ⚠ Review result did not match any scenario for Codex ${codexWorkerId} — stopping Auto Fix`)
            setAutoFixActiveMap(prev => { const m = new Map(prev); m.delete(codexWorkerId); return m })
            pushHistory(`⚠ Auto Fix 停止 (cycle ${decision.cycleCount})：评审结果未命中预期场景，请检查输出或手动处理。`)
            alert('Auto Fix 停止：评审结果未命中预期场景，请检查 Codex 输出或手动处理。')
            break
          case 'zero_checkboxes':
            console.warn(`[AutoFix] ⚠ Scenario matched but 0 checkboxes parsed for Codex ${codexWorkerId} — stopping Auto Fix`)
            setAutoFixActiveMap(prev => { const m = new Map(prev); m.delete(codexWorkerId); return m })
            pushHistory(`⚠ Auto Fix 停止 (cycle ${decision.cycleCount})：命中场景但未解析到任何 checkbox，可能输出格式异常。`)
            alert('Auto Fix 停止：评审结果命中场景但未解析到任何 checkbox，可能输出格式异常，请手动检查。')
            break
          case 'max_cycles':
            console.warn(`[AutoFix] ⚠ Max cycles (${MAX_AUTOFIX_CYCLES}) reached for Codex ${codexWorkerId}`)
            setAutoFixActiveMap(prev => { const m = new Map(prev); m.delete(codexWorkerId); return m })
            pushHistory(`⚠ Auto Fix 达到最大循环次数 (${MAX_AUTOFIX_CYCLES})，仍有 ${decision.remainingCount} 个 P0/P1 问题未解决，请手动处理。`)
            alert(`Auto Fix 已达到最大循环次数 (${MAX_AUTOFIX_CYCLES})，仍有 ${decision.remainingCount} 个 P0/P1 问题未解决。请手动处理。`)
            break
        }
        break

      case 'continue':
        console.log(`[AutoFix] ${decision.items.length} P0/P1 issues remaining → sending to Droid (cycle ${decision.nextCycleCount})`)
        handleDroidFixRequest(decision.items, codexWorkerId, true, decision.nextCycleCount, decision.scenarioKey)
        break
    }
  }, [autoFixActiveMap, confirmationCardConfig, handleDroidFixRequest])

  /** User clicked "停止 Auto Fix" */
  const handleAutoFixStop = useCallback((codexWorkerId: string) => {
    console.log(`[AutoFix] ⏹ Stopped by user for Codex ${codexWorkerId}`)
    setAutoFixActiveMap(prev => { const m = new Map(prev); m.delete(codexWorkerId); return m })
    // Clean up any pending activations for this codex worker
    pendingAutoFixActivationsRef.current.forEach((cid, did) => {
      if (cid === codexWorkerId) pendingAutoFixActivationsRef.current.delete(did)
    })
  }, [])

  /** Droid Worker successfully sent its autoSendMessage → activate pending Auto Fix */
  const handleAutoSendComplete = useCallback((droidWorkerId: string) => {
    const codexWorkerId = pendingAutoFixActivationsRef.current.get(droidWorkerId)
    if (!codexWorkerId) return  // No pending activation for this Droid
    pendingAutoFixActivationsRef.current.delete(droidWorkerId)
    // Guard: verify the Codex tab still exists (may have been closed while Droid was initializing)
    const codexStillExists = codexTabs.some(t => t.id === codexWorkerId)
    if (!codexStillExists) {
      console.warn(`[AutoFix] Codex ${codexWorkerId} no longer exists — skipping activation`)
      return
    }
    console.log(`[AutoFix] Droid ${droidWorkerId} auto-send confirmed → activating Auto Fix for Codex ${codexWorkerId}`)
    setAutoFixActiveMap(prev => {
      const m = new Map(prev)
      // Initial activation always uses cycle 1
      m.set(codexWorkerId, { active: true, cycleCount: 1, stage: 'fixing' })
      return m
    })
  }, [codexTabs])

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

  const handleOpenAutoFix = () => {
    const bridge = window.__nativeBridge
    if (!bridge || !tree?.nativePath) return
    const activeCodex = codexTabs.find(t => t.id === activeCodexTabId)
    const changeId = activeCodex?.changeId || ''
    bridge.openAutoFixWindow(changeId, tree.nativePath)
  }

  const handleAutoFixChange = (changeId: string) => {
    const bridge = window.__nativeBridge
    if (!bridge || !tree?.nativePath) return
    bridge.openAutoFixWindow(changeId || '', tree.nativePath)
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
                  <button onClick={handleOpenAutoFix} className="btn-autofix"><RefreshIcon size={14} /> Self-Review Cycle</button>
                  <button onClick={triggerCelebration}>🎉 Celebrate</button>
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
                {changeSessionDisplays.get(tab.id) ? ` (${formatSessionDisplay(changeSessionDisplays.get(tab.id)!)})` : ''}
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
                {codexSessionDisplays.get(tab.id) ? ` (${formatSessionDisplay(codexSessionDisplays.get(tab.id)!)})` : ''}
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
        {activeTab === 'viewer' && (
          <div className="viewer-layout">
            <aside className="sidebar">
              {tree ? (
                <TreeView tree={tree} onSelectNode={handleTreeSelect} selectedSpec={selectedSpec} onContinueChange={handleContinueChange} onNewChange={handleNewChange} onReactivateChange={handleReactivateChange} onCodexChange={handleCodexChange} onAutoFix={handleAutoFixChange} />
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
        )}

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
                onFixComplete={handleDroidFixComplete}
                onAutoSendComplete={handleAutoSendComplete}
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
                onAutoFixStart={(selectedItems, codexWorkerId) => handleDroidFixRequest(selectedItems, codexWorkerId, true)}
                confirmationCardConfig={confirmationCardConfig}
                onTriggerReReviewRef={{
                  get current() { return codexTriggerReReviewRefs.current.get(tab.id) || null },
                  set current(value) { codexTriggerReReviewRefs.current.set(tab.id, value) }
                }}
                onPushHistoryRef={{
                  get current() { return codexPushHistoryRefs.current.get(tab.id) || null },
                  set current(value) { codexPushHistoryRefs.current.set(tab.id, value) }
                }}
                onDismissConfirmationRef={{
                  get current() { return codexDismissConfirmationRefs.current.get(tab.id) || null },
                  set current(value) { codexDismissConfirmationRefs.current.set(tab.id, value) }
                }}
                onSendMessageRef={{
                  get current() { return codexSendMessageRefs.current.get(tab.id) || null },
                  set current(value) { codexSendMessageRefs.current.set(tab.id, value) }
                }}
                onAutoFixReviewComplete={handleAutoFixReviewComplete}
                autoFixActive={autoFixActiveMap.get(tab.id)?.active || false}
                autoFixStage={autoFixActiveMap.get(tab.id)?.stage || null}
                onAutoFixStop={handleAutoFixStop}
                suppressAutoInitPrompt={tab.disableAutoInitPrompt}
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
