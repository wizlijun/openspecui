import { useState, useEffect } from 'react'
import { loadHistory, deleteHistoryEntry, clearHistory } from './inputHistoryService'
import type { HistoryEntry } from './inputHistoryService'
import { formatRelativeTime } from './timeUtils'
import { CloseIcon } from './Icons'

interface InputHistoryPanelProps {
  projectPath: string
  onLoadContent: (content: string) => void
  onClose: () => void
}

export function InputHistoryPanel({ projectPath, onLoadContent, onClose }: InputHistoryPanelProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadHistory(projectPath).then(history => {
      if (!cancelled) {
        setEntries(history)
        setLoading(false)
      }
    }).catch(() => {
      if (!cancelled) {
        setEntries([])
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [projectPath])

  const handleDelete = async (id: string) => {
    await deleteHistoryEntry(projectPath, id)
    setEntries(prev => prev.filter(e => e.id !== id))
    if (expandedId === id) setExpandedId(null)
  }

  const handleClearAll = async () => {
    await clearHistory(projectPath)
    setEntries([])
    setConfirmClear(false)
    setExpandedId(null)
  }

  const handleLoad = (entry: HistoryEntry) => {
    if (confirm('当前编辑器内容将被替换，确定要加载此历史记录吗？')) {
      onLoadContent(entry.content)
      onClose()
    }
  }

  const getFileName = (filePath: string) => {
    const parts = filePath.split('/')
    return parts[parts.length - 1] || filePath
  }

  if (loading) {
    return (
      <div className="history-panel">
        <div className="history-panel-header">
          <span>历史记录</span>
          <button className="btn-icon" onClick={onClose}><CloseIcon size={14} /></button>
        </div>
        <div className="history-panel-loading">加载中...</div>
      </div>
    )
  }

  return (
    <div className="history-panel">
      <div className="history-panel-header">
        <span>历史记录 ({entries.length})</span>
        <div className="history-panel-actions">
          {entries.length > 0 && !confirmClear && (
            <button className="btn-text-danger" onClick={() => setConfirmClear(true)}>清空</button>
          )}
          {confirmClear && (
            <>
              <span className="history-confirm-text">确定清空？</span>
              <button className="btn-text-danger" onClick={handleClearAll}>确定</button>
              <button className="btn-text" onClick={() => setConfirmClear(false)}>取消</button>
            </>
          )}
          <button className="btn-icon" onClick={onClose}><CloseIcon size={14} /></button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="history-panel-empty">暂无历史记录</div>
      ) : (
        <div className="history-panel-list">
          {entries.map(entry => (
            <div key={entry.id} className={`history-item ${expandedId === entry.id ? 'history-item-expanded' : ''}`}>
              <div className="history-item-header" onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}>
                <div className="history-item-meta">
                  <span className="history-item-time">{formatRelativeTime(entry.timestamp)}</span>
                  {entry.source && <span className="history-item-source">{entry.source}</span>}
                  <span className="history-item-file">{getFileName(entry.filePath)}</span>
                </div>
                {expandedId !== entry.id && (
                  <div className="history-item-preview">{entry.preview}</div>
                )}
              </div>

              {expandedId === entry.id && (
                <div className="history-item-detail">
                  <pre className="history-item-content">{entry.content}</pre>
                  <div className="history-item-actions">
                    <button className="btn-primary btn-sm" onClick={() => handleLoad(entry)}>加载到编辑器</button>
                    <button className="btn-text-danger btn-sm" onClick={() => handleDelete(entry.id)}>删除</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
