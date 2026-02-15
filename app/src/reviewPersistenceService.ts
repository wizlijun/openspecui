import { nativeReadFile, nativeWriteFile, registerCommandCallback, unregisterCommandCallback } from './useDirectoryPicker'

// ─── State ─────────────────────────────────────────────────────────

let currentReviewFile: string | null = null
let pollingIntervalId: ReturnType<typeof setInterval> | null = null
let lastCommitHash: string | null = null

// Serial queue: chains each saveReviewEntry call so concurrent invocations
// never interleave their read-modify-write cycles.
let saveQueue: Promise<void> = Promise.resolve()

// ─── Task 1.2: Get Git Short Hash ────────────────────────────────

async function getGitShortHash(projectPath: string): Promise<string | null> {
  const bridge = window.__nativeBridge
  if (!bridge) return null
  
  return new Promise((resolve) => {
    const callbackId = `git-hash-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    
    const timer = setTimeout(() => {
      unregisterCommandCallback(callbackId)
      resolve(null)
    }, 5000)
    
    registerCommandCallback(callbackId, (_id: string, output: string) => {
      clearTimeout(timer)
      // Terminal buffer may contain command echo / prompt chars — extract only the short hash
      const match = output.match(/\b([0-9a-f]{7,12})\b/)
      resolve(match ? match[1] : null)
    })
    
    bridge.runCommandWithCallback(
      `cd '${projectPath.replace(/'/g, "'\\''")}' && git log -1 --format=%h 2>/dev/null || echo ""`,
      callbackId,
      'shell'
    )
  })
}

// ─── Task 1.3: Generate Fallback Name ─────────────────────────────

export function generateFallbackName(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const HH = String(now.getHours()).padStart(2, '0')
  const MM = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}-review-${HH}${MM}${ss}`
}

// ─── Task 1.4: Parse Last Review Number ───────────────────────────

export function parseLastReviewNumber(content: string): number {
  const matches = content.match(/## 第 (\d+) 次评审/g)
  if (!matches || matches.length === 0) return 0
  
  const lastMatch = matches[matches.length - 1]
  const numberMatch = lastMatch.match(/\d+/)
  return numberMatch ? parseInt(numberMatch[0], 10) : 0
}

// ─── Task 2.1, 2.2: Generate Review File Name (date + git hash) ───

async function generateReviewFileName(projectPath: string): Promise<string> {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')

  const hash = await getGitShortHash(projectPath)
  if (hash) {
    return `${yyyy}-${mm}-${dd}-review-${hash}.md`
  }
  // Fallback: use timestamp when git hash unavailable
  return `${generateFallbackName()}.md`
}

// ─── Task 1.1 & 1.5: Save Review Entry ────────────────────────────

/** Internal: actual read-modify-write logic. Must only be called inside the serial queue. */
async function saveReviewEntryInternal(
  projectPath: string,
  reviewItems: string[]
): Promise<void> {
  const reviewsDir = `${projectPath}/openspec/reviews`
  
  // Determine filename
  let filename: string
  if (currentReviewFile) {
    filename = currentReviewFile
  } else {
    // First review — generate new filename based on date + git hash
    filename = await generateReviewFileName(projectPath)
    currentReviewFile = filename
  }

  const filePath = `${reviewsDir}/${filename}`

  // Read existing content or create new
  let existingContent = ''
  let reviewNumber = 1
  try {
    existingContent = await nativeReadFile(filePath)
    reviewNumber = parseLastReviewNumber(existingContent) + 1
  } catch (err: unknown) {
    // Only treat confirmed "file not found" errors as new-file scenario.
    // Other errors (permission denied, disk I/O, etc.) should abort to avoid
    // silently overwriting existing review history.
    const errMsg = err instanceof Error ? err.message : String(err ?? '')
    const isNotFound = /ENOENT|not found|no such file|does not exist/i.test(errMsg)
    if (!isNotFound) {
      throw new Error(`[ReviewPersistence] Failed to read ${filePath}: ${errMsg}`)
    }
    // File genuinely doesn't exist — create new
    const titleName = filename.replace(/\.md$/, '')
    existingContent = `# Review: ${titleName}\n\n`
  }

  // Format new review entry
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const HH = String(now.getHours()).padStart(2, '0')
  const MM = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const timestamp = `${yyyy}-${mm}-${dd} ${HH}:${MM}:${ss}`

  const reviewEntry = `## 第 ${reviewNumber} 次评审 (${timestamp})\n${reviewItems.map(item => `- ${item}`).join('\n')}\n\n`

  // Append and write
  const newContent = existingContent + reviewEntry
  await nativeWriteFile(filePath, newContent)
}

/**
 * Public API: enqueues the save onto a serial queue so concurrent calls
 * never interleave their read-modify-write cycles.
 */
export async function saveReviewEntry(
  projectPath: string,
  reviewItems: string[]
): Promise<void> {
  if (!window.__isNativeApp) {
    return
  }

  // Chain onto the serial queue — each call waits for the previous to finish
  // before starting its own read-modify-write cycle.
  // On failure: log the error, keep the queue healthy (so subsequent saves still
  // run), but re-throw so the caller can detect the failure.
  let savedErr: unknown = undefined
  const task = saveQueue.then(() =>
    saveReviewEntryInternal(projectPath, reviewItems)
  ).catch(err => {
    console.error('[ReviewPersistence] saveReviewEntry failed:', err)
    savedErr = err
  })
  saveQueue = task
  return task.then(() => {
    if (savedErr !== undefined) throw savedErr
  })
}

// ─── Task 1.1: Reset Review File ──────────────────────────────────

export function resetReviewFile(): void {
  currentReviewFile = null
}

// ─── Task 3.1, 3.2, 3.3, 3.4: Git Commit Polling ──────────────────

async function getLatestCommitHash(projectPath: string): Promise<string | null> {
  const bridge = window.__nativeBridge
  if (!bridge) return null
  
  return new Promise((resolve) => {
    const callbackId = `git-log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    
    const timer = setTimeout(() => {
      unregisterCommandCallback(callbackId)
      resolve(null)
    }, 5000)
    
    registerCommandCallback(callbackId, (_id: string, output: string) => {
      clearTimeout(timer)
      // Terminal buffer may contain command echo / prompt chars — extract only the full hash
      const match = output.match(/\b([0-9a-f]{40})\b/)
      resolve(match ? match[1] : null)
    })
    
    bridge.runCommandWithCallback(
      `cd '${projectPath.replace(/'/g, "'\\''")}' && git log -1 --format=%H 2>/dev/null || echo ""`,
      callbackId,
      'shell'
    )
  })
}

export function startCommitPolling(projectPath: string): void {
  if (pollingIntervalId) {
    stopCommitPolling()
  }

  const poll = async () => {
    try {
      const currentHash = await getLatestCommitHash(projectPath)
      
      if (lastCommitHash === null) {
        lastCommitHash = currentHash
      } else if (currentHash && currentHash !== lastCommitHash) {
        console.log('[ReviewPersistence] New commit detected, resetting review file')
        resetReviewFile()
        lastCommitHash = currentHash
      }
    } catch (err) {
      // Silent ignore
    }
  }

  poll()
  pollingIntervalId = setInterval(poll, 30000)
}

export function stopCommitPolling(): void {
  if (pollingIntervalId) {
    clearInterval(pollingIntervalId)
    pollingIntervalId = null
  }
  lastCommitHash = null
  currentReviewFile = null
}
