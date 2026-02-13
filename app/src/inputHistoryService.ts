import { nativeReadFile, nativeWriteFile } from './useDirectoryPicker'

export interface HistoryEntry {
  id: string
  timestamp: string
  filePath: string
  content: string
  preview: string
  source?: string  // e.g. "New Change > Intent", "Continue Change (id) > 输入框", "Viewer > spec.md > 编辑器"
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function generatePreview(content: string): string {
  return content.slice(0, 100)
}

function getHistoryFilePaths(projectPath: string): { primary: string; legacy: string } {
  return {
    primary: `${projectPath}/.openspec/desktop_chat_history.json`,
    legacy: `${projectPath}/openspec/desktop_chat_history.json`,
  }
}

function sortByTimestampDesc(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

async function readHistoryFile(path: string): Promise<HistoryEntry[] | null> {
  try {
    const content = await nativeReadFile(path)
    const entries = JSON.parse(content) as HistoryEntry[]
    return sortByTimestampDesc(entries)
  } catch {
    return null
  }
}

async function writeHistoryFile(projectPath: string, entries: HistoryEntry[]): Promise<void> {
  const { primary, legacy } = getHistoryFilePaths(projectPath)
  const payload = JSON.stringify(entries, null, 2)

  try {
    await nativeWriteFile(primary, payload)
  } catch (primaryErr) {
    console.warn(`[inputHistoryService] Failed to write to primary path ${primary}:`, primaryErr)
    try {
      await nativeWriteFile(legacy, payload)
    } catch (legacyErr) {
      console.error(`[inputHistoryService] Failed to write history to both paths. Primary: ${primary}, Legacy: ${legacy}`, legacyErr)
    }
  }
}

export async function loadHistory(projectPath: string): Promise<HistoryEntry[]> {
  if (!window.__isNativeApp) return []

  const { primary, legacy } = getHistoryFilePaths(projectPath)
  const primaryEntries = await readHistoryFile(primary)
  if (primaryEntries) return primaryEntries

  const legacyEntries = await readHistoryFile(legacy)
  return legacyEntries || []
}

export async function saveHistoryEntry(
  projectPath: string,
  filePath: string,
  content: string,
  source?: string
): Promise<void> {
  if (!window.__isNativeApp) return

  // Load existing history
  const existingHistory = await loadHistory(projectPath)

  // Create new entry
  const newEntry: HistoryEntry = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    filePath,
    content,
    preview: generatePreview(content),
    source,
  }

  // Prepend new entry (newest first)
  const updatedHistory = [newEntry, ...existingHistory]

  // Write back to file
  await writeHistoryFile(projectPath, updatedHistory)
}

export async function deleteHistoryEntry(projectPath: string, id: string): Promise<void> {
  if (!window.__isNativeApp) return

  const existingHistory = await loadHistory(projectPath)

  // Filter out the entry with matching id
  const updatedHistory = existingHistory.filter(entry => entry.id !== id)

  // Write back to file
  await writeHistoryFile(projectPath, updatedHistory)
}

export async function clearHistory(projectPath: string): Promise<void> {
  if (!window.__isNativeApp) return

  // Write empty array
  await writeHistoryFile(projectPath, [])
}
