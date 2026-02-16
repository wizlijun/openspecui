// ─── File System Access API Type Declarations ──────────────────────

interface FileSystemDirectoryEntry extends FileSystemDirectoryHandle {
  kind: 'directory'
}

interface FileSystemFileEntry extends FileSystemFileHandle {
  kind: 'file'
}

declare global {
  interface Window {
    showDirectoryPicker(): Promise<FileSystemDirectoryHandle>
  }

  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemDirectoryEntry | FileSystemFileEntry>
  }
}

// ─── File Tree Types ───────────────────────────────────────────────

export interface FileTreeNode {
  name: string
  kind: 'directory' | 'file'
  nodeType: 'directory' | 'spec' | 'change' | 'artifact' | 'section'
  children?: FileTreeNode[]
  handle?: FileSystemFileHandle
  /** If this directory contains a spec.md, store its handle here */
  specHandle?: FileSystemFileHandle
  /** For artifact nodes, the type of artifact (proposal, design, tasks, spec) */
  artifactType?: 'proposal' | 'design' | 'tasks' | 'spec'
  /** For archived changes */
  archived?: boolean
  /** Native file path (used in native app mode) */
  nativePath?: string
}

// ─── Native Bridge Types ───────────────────────────────────────────

declare global {
  interface Window {
    __isNativeApp?: boolean
    __lastDirectory?: string
    __savedSessions?: {
      changeTabs: Array<{ sessionId: string; changeId: string | null }>
      codexTabs: Array<{ sessionId: string; changeId: string | null }>
    }
    __onTerminalOutput?: (data: string) => void
    __onTerminalOutputBytes?: (base64Data: string) => void
    __onHookNotify?: (data: any) => void
    __onCreateAutoFixWorkers?: (data: any) => void
    __onDismissConfirmationCard?: (data: any) => void
    __onAutoFixSendToWorker?: (data: any) => void
    __onAutoFixTriggerReReview?: (data: any) => void
    __onAutoFixDroidFix?: (data: any) => void
    __onAutoFixComplete?: (data: any) => void
    __onCommandCallback?: (callbackId: string, output: string) => void
    __commandCallbackMap?: Record<string, (callbackId: string, output: string) => void>
    __onReviewCommandCallback?: (callbackId: string, output: string) => void
    __nativeBridge?: {
      pickDirectory: () => Promise<{ success: boolean; path?: string; error?: string }>
      readDirectory: (path: string) => Promise<{ success: boolean; data?: NativeDirEntry; error?: string }>
      readFile: (path: string) => Promise<{ success: boolean; content?: string; error?: string }>
      writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>
      runCommand: (cmd: string) => void
      runCommandWithCallback: (cmd: string, callbackId: string, promptPattern?: 'shell' | 'droid') => void
      writeInput: (data: string) => void
      startAgent: (cmd: string) => void
      startReviewTerminal: (projectPath?: string) => void
      writeReviewInput: (data: string) => void
      runReviewCommandWithCallback: (cmd: string, callbackId: string, promptPattern?: 'shell' | 'droid') => void
      stopReviewTerminal: () => void
      // Change terminal commands (multi-session)
      startChangeTerminal: (tabId: string, cols?: number, rows?: number) => void
      writeChangeInput: (tabId: string, data: string) => void
      runChangeCommandWithCallback: (tabId: string, cmd: string, callbackId: string, promptPattern?: 'shell' | 'droid') => void
      stopChangeTerminal: (tabId: string) => void
      // Session tracking for persistence
      trackChangeSession: (tabId: string, sessionId: string, changeId?: string | null) => void
      untrackChangeSession: (tabId: string) => void
      trackCodexSession: (tabId: string, sessionId: string, changeId?: string | null) => void
      untrackCodexSession: (tabId: string) => void
      // Auto Fix window
      openAutoFixWindow: (changeId: string, projectPath: string) => void
    }
    __onReviewTerminalOutput?: (data: string) => void
    __onReviewTerminalOutputBytes?: (base64Data: string) => void
    __onReviewTerminalExit?: (code: number) => void
    __onChangeTerminalOutput?: Record<string, (data: string) => void>
    __onChangeTerminalOutputBytes?: Record<string, (base64Data: string) => void>
    __onChangeCommandCallback?: Record<string, (callbackId: string, output: string) => void>
    __onChangeTerminalExit?: Record<string, (code: number) => void>
    __closingTabs?: Set<string>
    __workerStates?: Record<string, any>
    webkit?: {
      messageHandlers?: {
        terminalInput?: { postMessage: (data: string) => void }
        terminalResize?: { postMessage: (data: { cols: number; rows: number }) => void }
        nativeBridge?: { postMessage: (data: string) => void }
      }
    }
  }
}

interface NativeDirEntry {
  name: string
  kind: 'directory' | 'file'
  path: string
  entries?: NativeDirEntry[]
}

// ─── Command Callback Management ───────────────────────────────────

// Initialize callback map and dispatcher on window
if (typeof window !== 'undefined' && !window.__commandCallbackMap) {
  window.__commandCallbackMap = {}
  window.__onCommandCallback = (callbackId: string, output: string) => {
    const cbMap = window.__commandCallbackMap
    const handler = cbMap?.[callbackId]
    if (handler && cbMap) {
      delete cbMap[callbackId]
      handler(callbackId, output)
    }
  }
}

export function registerCommandCallback(callbackId: string, handler: (callbackId: string, output: string) => void): void {
  const callbackMap = window.__commandCallbackMap
  if (callbackMap) {
    callbackMap[callbackId] = handler
  }
}

export function unregisterCommandCallback(callbackId: string): void {
  if (window.__commandCallbackMap) {
    delete window.__commandCallbackMap[callbackId]
  }
}

// ─── Native App Implementation ─────────────────────────────────────

async function nativePickDirectory(existingPath?: string): Promise<FileTreeNode> {
  const bridge = window.__nativeBridge!
  
  let rootPath: string
  if (existingPath) {
    // Refresh existing path without showing picker
    rootPath = existingPath
  } else {
    // Show picker for new directory
    const result = await bridge.pickDirectory()
    if (!result.success || !result.path) {
      const err = new Error(result.error || 'User cancelled')
      err.name = 'AbortError'
      throw err
    }
    rootPath = result.path
  }

  const dirResult = await bridge.readDirectory(rootPath)
  if (!dirResult.success || !dirResult.data) {
    throw new Error(dirResult.error || 'Failed to read directory')
  }

  // Look for openspec/ subdirectory first, fall back to root
  let openspecEntries = dirResult.data.entries || []
  const openspecDir = openspecEntries.find(e => e.kind === 'directory' && e.name === 'openspec')
  if (openspecDir) {
    const openspecResult = await bridge.readDirectory(openspecDir.path)
    if (openspecResult.success && openspecResult.data) {
      openspecEntries = openspecResult.data.entries || []
    }
  }

  const specsEntry = openspecEntries.find(e => e.kind === 'directory' && e.name === 'specs')
  const changesEntry = openspecEntries.find(e => e.kind === 'directory' && e.name === 'changes')

  if (!specsEntry && !changesEntry) {
    throw new Error('Selected directory does not contain "openspec/specs" or "openspec/changes" subdirectory.')
  }

  const sections: FileTreeNode[] = []

  if (specsEntry) {
    const specChildren = await nativeTraverseSpecs(specsEntry.path)
    sections.push({
      name: 'Specs',
      kind: 'directory',
      nodeType: 'section',
      children: specChildren,
    })
  }

  if (changesEntry) {
    const { active, archived } = await nativeParseChanges(changesEntry.path)
    const changesChildren: FileTreeNode[] = [...active]
    if (archived.length > 0) {
      changesChildren.push({
        name: 'Archive',
        kind: 'directory',
        nodeType: 'section',
        children: archived,
      })
    }
    sections.push({
      name: 'Changes',
      kind: 'directory',
      nodeType: 'section',
      children: changesChildren,
    })
  }

  return {
    name: dirResult.data.name,
    kind: 'directory',
    nodeType: 'directory',
    children: sections,
    nativePath: rootPath,  // Keep project root for cd command
  }
}

async function nativeTraverseSpecs(dirPath: string): Promise<FileTreeNode[]> {
  const bridge = window.__nativeBridge!
  const result = await bridge.readDirectory(dirPath)
  if (!result.success || !result.data) return []

  const children: FileTreeNode[] = []
  for (const entry of result.data.entries || []) {
    if (entry.kind === 'directory') {
      const subChildren = await nativeTraverseSpecs(entry.path)
      // Check if spec.md exists
      const subDir = await bridge.readDirectory(entry.path)
      const hasSpecMd = (subDir.data?.entries || []).some(e => e.kind === 'file' && e.name === 'spec.md')
      const specPath = hasSpecMd ? entry.path + '/spec.md' : undefined

      children.push({
        name: entry.name,
        kind: 'directory',
        nodeType: hasSpecMd ? 'spec' : 'directory',
        children: subChildren.filter(c => c.kind === 'directory'),
        nativePath: specPath || entry.path,
      })
    }
  }
  children.sort((a, b) => a.name.localeCompare(b.name))
  return children
}

const ARTIFACT_FILES_NATIVE = ['proposal.md', 'design.md', 'tasks.md'] as const
const ARTIFACT_TYPE_MAP_NATIVE: Record<string, 'proposal' | 'design' | 'tasks'> = {
  'proposal.md': 'proposal',
  'design.md': 'design',
  'tasks.md': 'tasks',
}

async function nativeParseChange(dirPath: string, name: string, archived = false): Promise<FileTreeNode> {
  const bridge = window.__nativeBridge!
  const result = await bridge.readDirectory(dirPath)
  const entries = result.data?.entries || []
  const children: FileTreeNode[] = []

  // Detect artifact .md files
  for (const fileName of ARTIFACT_FILES_NATIVE) {
    const fileEntry = entries.find(e => e.kind === 'file' && e.name === fileName)
    if (fileEntry) {
      children.push({
        name: fileName,
        kind: 'file',
        nodeType: 'artifact',
        artifactType: ARTIFACT_TYPE_MAP_NATIVE[fileName],
        nativePath: fileEntry.path,
      })
    }
  }

  // Detect specs/ subdirectory
  const specsEntry = entries.find(e => e.kind === 'directory' && e.name === 'specs')
  if (specsEntry) {
    const specChildren = await nativeTraverseSpecs(specsEntry.path)
    if (specChildren.length > 0) {
      children.push({
        name: 'specs',
        kind: 'directory',
        nodeType: 'directory',
        children: specChildren,
      })
    }
  }

  return {
    name,
    kind: 'directory',
    nodeType: 'change',
    children,
    archived,
    nativePath: dirPath,
  }
}

async function nativeParseChanges(changesPath: string): Promise<{ active: FileTreeNode[]; archived: FileTreeNode[] }> {
  const bridge = window.__nativeBridge!
  const result = await bridge.readDirectory(changesPath)
  const entries = result.data?.entries || []

  const active: FileTreeNode[] = []
  const archived: FileTreeNode[] = []

  for (const entry of entries) {
    if (entry.kind !== 'directory') continue
    if (entry.name === 'archive') {
      const archiveResult = await bridge.readDirectory(entry.path)
      for (const archiveEntry of archiveResult.data?.entries || []) {
        if (archiveEntry.kind === 'directory') {
          archived.push(await nativeParseChange(archiveEntry.path, archiveEntry.name, true))
        }
      }
    } else {
      active.push(await nativeParseChange(entry.path, entry.name))
    }
  }

  active.sort((a, b) => a.name.localeCompare(b.name))
  archived.sort((a, b) => a.name.localeCompare(b.name))
  return { active, archived }
}

// ─── Browser File System Access API Implementation ─────────────────

async function traverseSpecsDirectory(
  dirHandle: FileSystemDirectoryHandle
): Promise<FileTreeNode[]> {
  const children: FileTreeNode[] = []
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'directory') {
      const subChildren = await traverseSpecsDirectory(entry)
      let specHandle: FileSystemFileHandle | undefined
      try {
        specHandle = await entry.getFileHandle('spec.md')
      } catch {
        // no spec.md
      }
      children.push({
        name: entry.name,
        kind: 'directory',
        nodeType: specHandle ? 'spec' : 'directory',
        children: subChildren.filter(c => c.kind === 'directory'),
        specHandle,
      })
    }
  }
  children.sort((a, b) => a.name.localeCompare(b.name))
  return children
}

const ARTIFACT_FILES = ['proposal.md', 'design.md', 'tasks.md'] as const
const ARTIFACT_TYPE_MAP: Record<string, 'proposal' | 'design' | 'tasks'> = {
  'proposal.md': 'proposal',
  'design.md': 'design',
  'tasks.md': 'tasks',
}

async function parseChangeDirectory(
  dirHandle: FileSystemDirectoryHandle,
  archived = false
): Promise<FileTreeNode> {
  const children: FileTreeNode[] = []

  for (const fileName of ARTIFACT_FILES) {
    try {
      const fileHandle = await dirHandle.getFileHandle(fileName)
      children.push({
        name: fileName,
        kind: 'file',
        nodeType: 'artifact',
        handle: fileHandle,
        artifactType: ARTIFACT_TYPE_MAP[fileName],
      })
    } catch {
      // file doesn't exist
    }
  }

  try {
    const specsDir = await dirHandle.getDirectoryHandle('specs')
    const specChildren = await traverseSpecsDirectory(specsDir)
    if (specChildren.length > 0) {
      children.push({
        name: 'specs',
        kind: 'directory',
        nodeType: 'directory',
        children: specChildren,
      })
    }
  } catch {
    // no specs dir
  }

  return {
    name: dirHandle.name,
    kind: 'directory',
    nodeType: 'change',
    children,
    archived,
  }
}

async function parseChangesDirectory(
  changesHandle: FileSystemDirectoryHandle
): Promise<{ active: FileTreeNode[]; archived: FileTreeNode[] }> {
  const active: FileTreeNode[] = []
  const archived: FileTreeNode[] = []

  for await (const entry of changesHandle.values()) {
    if (entry.kind !== 'directory') continue
    if (entry.name === 'archive') {
      for await (const archiveEntry of entry.values()) {
        if (archiveEntry.kind === 'directory') {
          archived.push(await parseChangeDirectory(archiveEntry, true))
        }
      }
    } else {
      active.push(await parseChangeDirectory(entry))
    }
  }

  active.sort((a, b) => a.name.localeCompare(b.name))
  archived.sort((a, b) => a.name.localeCompare(b.name))
  return { active, archived }
}

async function browserPickDirectory(): Promise<FileTreeNode> {
  const rootHandle = await window.showDirectoryPicker()

  let specsHandle: FileSystemDirectoryHandle | null = null
  let changesHandle: FileSystemDirectoryHandle | null = null

  for await (const entry of rootHandle.values()) {
    if (entry.kind === 'directory') {
      if (entry.name === 'specs') specsHandle = entry
      if (entry.name === 'changes') changesHandle = entry
    }
  }

  if (!specsHandle && !changesHandle) {
    throw new Error('Selected directory does not contain "specs" or "changes" subdirectory.')
  }

  const sections: FileTreeNode[] = []

  if (specsHandle) {
    const specChildren = await traverseSpecsDirectory(specsHandle)
    sections.push({
      name: 'Specs',
      kind: 'directory',
      nodeType: 'section',
      children: specChildren,
    })
  }

  if (changesHandle) {
    const { active, archived } = await parseChangesDirectory(changesHandle)
    const changesChildren: FileTreeNode[] = [...active]
    if (archived.length > 0) {
      changesChildren.push({
        name: 'Archive',
        kind: 'directory',
        nodeType: 'section',
        children: archived,
      })
    }
    sections.push({
      name: 'Changes',
      kind: 'directory',
      nodeType: 'section',
      children: changesChildren,
    })
  }

  return {
    name: rootHandle.name,
    kind: 'directory',
    nodeType: 'directory',
    children: sections,
  }
}

// ─── Public API ────────────────────────────────────────────────────

export function isSpecNode(node: FileTreeNode): boolean {
  return node.nodeType === 'spec'
}

export function isChangeNode(node: FileTreeNode): boolean {
  return node.nodeType === 'change'
}

export function isArtifactNode(node: FileTreeNode): boolean {
  return node.nodeType === 'artifact'
}

export function isSectionNode(node: FileTreeNode): boolean {
  return node.nodeType === 'section'
}

export function isFileSystemAccessSupported(): boolean {
  // In native app, we have our own file system bridge
  if (window.__isNativeApp) return true
  return 'showDirectoryPicker' in window
}

export async function pickDirectory(existingPath?: string): Promise<FileTreeNode> {
  if (window.__isNativeApp && window.__nativeBridge) {
    return nativePickDirectory(existingPath)
  }
  return browserPickDirectory()
}

// ─── Native File Read/Write Helpers ────────────────────────────────

export async function nativeReadFile(path: string): Promise<string> {
  if (!window.__nativeBridge) throw new Error('Native bridge not available')
  const result = await window.__nativeBridge.readFile(path)
  if (!result.success) throw new Error(result.error || 'Failed to read file')
  return result.content || ''
}

export async function nativeWriteFile(path: string, content: string): Promise<void> {
  if (!window.__nativeBridge) throw new Error('Native bridge not available')
  
  // Ensure parent directory exists
  const lastSlash = path.lastIndexOf('/')
  if (lastSlash > 0) {
    const dir = path.substring(0, lastSlash)
    await new Promise<void>((resolve, reject) => {
      const callbackId = `mkdir-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const timer = setTimeout(() => {
        unregisterCommandCallback(callbackId)
        reject(new Error('mkdir timeout'))
      }, 3000)
      registerCommandCallback(callbackId, () => {
        clearTimeout(timer)
        resolve()
      })
      window.__nativeBridge!.runCommandWithCallback(
        `mkdir -p '${dir.replace(/'/g, "'\\''")}'`,
        callbackId,
        'shell'
      )
    })
  }
  
  const result = await window.__nativeBridge.writeFile(path, content)
  if (!result.success) throw new Error(result.error || 'Failed to write file')
}
