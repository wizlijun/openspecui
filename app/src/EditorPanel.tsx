import { useState, useEffect, useCallback, useRef } from 'react'
import type { FileTreeNode } from './useDirectoryPicker'
import { isArtifactNode, isSpecNode, nativeReadFile, nativeWriteFile } from './useDirectoryPicker'
import { SpecIcon, SaveIcon, CloseIcon, FileTextIcon, HistoryIcon } from './Icons'
import { saveHistoryEntry } from './inputHistoryService'
import { InputHistoryPanel } from './InputHistoryPanel'

interface EditorPanelProps {
  spec: FileTreeNode
  onClose: () => void
  projectPath?: string
}

function getEditorTitle(node: FileTreeNode) {
  if (isArtifactNode(node)) return node.name
  if (isSpecNode(node)) return `${node.name}/spec.md`
  return node.name
}

function getEditorIcon(node: FileTreeNode) {
  if (isArtifactNode(node)) return <FileTextIcon size={14} color="#e8a838" />
  if (isSpecNode(node)) return <SpecIcon size={14} />
  return <FileTextIcon size={14} />
}

export function EditorPanel({ spec, onClose, projectPath }: EditorPanelProps) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const fileHandle = spec.specHandle ?? spec.handle
  const nativePath = spec.nativePath
  const isNative = !!window.__isNativeApp

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setMessage(null)

    async function load() {
      try {
        let text: string

        if (window.__isNativeApp && nativePath) {
          // Native mode: read via bridge
          text = await nativeReadFile(nativePath)
        } else if (fileHandle) {
          // Browser mode: read via File System Access API
          const file = await fileHandle.getFile()
          text = await file.text()
        } else {
          text = ''
          if (!cancelled) setMessage('No file handle available')
        }

        if (!cancelled) {
          setContent(text)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setContent('')
          setLoading(false)
          setMessage('Failed to read file')
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [spec, fileHandle, nativePath])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setMessage(null)
    try {
      if (window.__isNativeApp && nativePath) {
        // Native mode: write via bridge
        await nativeWriteFile(nativePath, content)
      } else if (fileHandle) {
        // Browser mode: write via File System Access API
        const writable = await (fileHandle as any).createWritable()
        await writable.write(content)
        await writable.close()
      } else {
        throw new Error('No file handle')
      }
      setMessage('Saved ✓')
      setTimeout(() => setMessage(null), 2000)
    } catch {
      setMessage('Failed to save')
    }
    setSaving(false)
  }, [fileHandle, nativePath, content])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave])

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value
    setContent(newContent)

    // Debounced auto-save to history (native app only)
    if (isNative && projectPath && nativePath) {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const fileName = nativePath.split('/').pop() || nativePath
        saveHistoryEntry(projectPath, nativePath, newContent, `Viewer > ${fileName} > 编辑器`).catch(() => {
          // Silently ignore save errors
        })
      }, 2000)
    }
  }

  const handleLoadFromHistory = (historyContent: string) => {
    setContent(historyContent)
    setShowHistory(false)
  }

  return (
    <div className="editor-panel">
      <div className="editor-header">
        <span className="editor-title">{getEditorIcon(spec)} {getEditorTitle(spec)}</span>
        <div className="editor-actions">
          {message && <span className="editor-message">{message}</span>}
          {isNative && projectPath && (
            <button onClick={() => setShowHistory(!showHistory)} className="history-btn">
              <HistoryIcon size={13} /> 历史
            </button>
          )}
          <button onClick={handleSave} disabled={saving || loading}>
            <SaveIcon size={13} /> {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={onClose} className="btn-icon"><CloseIcon size={14} /></button>
        </div>
      </div>
      {loading ? (
        <div className="editor-loading">Loading...</div>
      ) : showHistory && projectPath ? (
        <InputHistoryPanel
          projectPath={projectPath}
          onLoadContent={handleLoadFromHistory}
          onClose={() => setShowHistory(false)}
        />
      ) : (
        <textarea
          className="editor-textarea"
          value={content}
          onChange={handleContentChange}
          spellCheck={false}
        />
      )}
    </div>
  )
}
