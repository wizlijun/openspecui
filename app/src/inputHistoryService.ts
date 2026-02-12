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

function getHistoryFilePath(projectPath: string): string {
  return `${projectPath}/openspec/desktop_chat_history.json`
}

export async function loadHistory(projectPath: string): Promise<HistoryEntry[]> {
  if (!window.__isNativeApp) return []
  
  const historyPath = getHistoryFilePath(projectPath)
  
  try {
    const content = await nativeReadFile(historyPath)
    const entries = JSON.parse(content) as HistoryEntry[]
    // Sort by timestamp descending (newest first)
    return entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  } catch (error) {
    // File doesn't exist or parse error, return empty array
    return []
  }
}

export async function saveHistoryEntry(
  projectPath: string,
  filePath: string,
  content: string,
  source?: string
): Promise<void> {
  if (!window.__isNativeApp) return
  
  const historyPath = getHistoryFilePath(projectPath)
  
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
  await nativeWriteFile(historyPath, JSON.stringify(updatedHistory, null, 2))
}

export async function deleteHistoryEntry(projectPath: string, id: string): Promise<void> {
  if (!window.__isNativeApp) return
  
  const historyPath = getHistoryFilePath(projectPath)
  const existingHistory = await loadHistory(projectPath)
  
  // Filter out the entry with matching id
  const updatedHistory = existingHistory.filter(entry => entry.id !== id)
  
  // Write back to file
  await nativeWriteFile(historyPath, JSON.stringify(updatedHistory, null, 2))
}

export async function clearHistory(projectPath: string): Promise<void> {
  if (!window.__isNativeApp) return
  
  const historyPath = getHistoryFilePath(projectPath)
  
  // Write empty array
  await nativeWriteFile(historyPath, JSON.stringify([], null, 2))
}
