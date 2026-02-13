import { useState, useRef, useEffect } from 'react'
import type { FileTreeNode } from './useDirectoryPicker'
import { isSpecNode, isChangeNode, isArtifactNode, isSectionNode } from './useDirectoryPicker'
import {
  FolderIcon, FolderOpenIcon, SpecIcon,
  ChevronRightIcon, ChevronDownIcon,
  GitBranchIcon, FileTextIcon, ArchiveIcon,
} from './Icons'

interface TreeNodeProps {
  node: FileTreeNode
  depth: number
  onSelectNode: (node: FileTreeNode) => void
  selectedSpec: FileTreeNode | null
  onContinueChange?: (changeId: string) => void
  onNewChange?: () => void
  onReactivateChange?: (archivedName: string, originalName: string) => void
  onCodexChange?: (changeId: string) => void
}

function getNodeIcon(node: FileTreeNode, expanded: boolean) {
  if (isSectionNode(node)) {
    if (node.name === 'Archive') return <ArchiveIcon size={16} />
    return expanded ? <FolderOpenIcon size={16} color="#999" /> : <FolderIcon size={16} color="#999" />
  }
  if (isChangeNode(node)) return <GitBranchIcon size={16} />
  if (isArtifactNode(node)) return <FileTextIcon size={16} color="#e8a838" />
  if (isSpecNode(node)) return <SpecIcon size={16} />
  return expanded ? <FolderOpenIcon size={16} /> : <FolderIcon size={16} />
}

function TreeNode({ node, depth, onSelectNode, selectedSpec, onContinueChange, onNewChange, onReactivateChange, onCodexChange }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(isSectionNode(node))
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const isDir = node.kind === 'directory'
  const isSpec = isSpecNode(node)
  const isChange = isChangeNode(node)
  const isArtifact = isArtifactNode(node)
  const isSection = isSectionNode(node)
  const isSelected = selectedSpec === node
  const hasChildren = isDir && node.children && node.children.length > 0
  const isArchived = node.archived

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [contextMenu])

  const handleClick = () => {
    if (isArtifact || isSpec) {
      onSelectNode(node)
    } else if (isDir) {
      setExpanded(!expanded)
      if (!isSection) {
        onSelectNode(node)
      }
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    // Show context menu for non-archived changes
    if (isChange && !isArchived && onContinueChange) {
      e.preventDefault()
      setContextMenu({ x: e.clientX, y: e.clientY })
    }
    // Show context menu for archived changes
    else if (isChange && isArchived && onReactivateChange) {
      e.preventDefault()
      setContextMenu({ x: e.clientX, y: e.clientY })
    }
    // Show context menu for "Changes" section
    else if (isSection && node.name === 'Changes' && onNewChange) {
      e.preventDefault()
      setContextMenu({ x: e.clientX, y: e.clientY })
    }
  }

  const handleContinueChange = () => {
    setContextMenu(null)
    onContinueChange?.(node.name)
  }

  const handleCodexChange = () => {
    setContextMenu(null)
    onCodexChange?.(node.name)
  }

  const handleReactivateChange = () => {
    setContextMenu(null)
    // Strip date prefix (YYYY-MM-DD-) from archived name to get original name
    const originalName = node.name.replace(/^\d{4}-\d{2}-\d{2}-/, '')
    onReactivateChange?.(node.name, originalName)
  }

  const showChevron = isDir && !isSpec && !isArtifact
  const nodeClasses = [
    'tree-node',
    isSelected ? 'tree-node-selected' : '',
    isSpec ? 'tree-node-spec' : '',
    isSection ? 'tree-node-section' : '',
    isChange ? 'tree-node-change' : '',
    isArchived ? 'tree-node-archived' : '',
  ].filter(Boolean).join(' ')

  return (
    <div>
      <div
        className={nodeClasses}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {showChevron && (
          <span className="tree-chevron">
            {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </span>
        )}
        {!showChevron && <span className="tree-chevron" style={{ width: 14 }} />}
        <span className="tree-icon">
          {getNodeIcon(node, expanded)}
        </span>
        <span className="tree-label">{node.name}</span>
      </div>
      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="tree-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {isChange && !isArchived && (
            <>
              <div className="tree-context-menu-item" onClick={handleContinueChange}>
                Continue Change
              </div>
              <div className="tree-context-menu-item" onClick={handleCodexChange}>
                Code Review
              </div>
            </>
          )}
          {isChange && isArchived && (
            <div className="tree-context-menu-item" onClick={handleReactivateChange}>
              Reactivate Change
            </div>
          )}
          {isSection && node.name === 'Changes' && (
            <div className="tree-context-menu-item" onClick={() => { setContextMenu(null); onNewChange?.() }}>
              New Change
            </div>
          )}
        </div>
      )}
      {isDir && expanded && hasChildren && node.children!.map((child) => (
        <TreeNode
          key={child.name}
          node={child}
          depth={depth + 1}
          onSelectNode={onSelectNode}
          selectedSpec={selectedSpec}
          onContinueChange={onContinueChange}
          onNewChange={onNewChange}
          onReactivateChange={onReactivateChange}
          onCodexChange={onCodexChange}
        />
      ))}
    </div>
  )
}

interface TreeViewProps {
  tree: FileTreeNode
  onSelectNode: (node: FileTreeNode) => void
  selectedSpec: FileTreeNode | null
  onContinueChange?: (changeId: string) => void
  onNewChange?: () => void
  onReactivateChange?: (archivedName: string, originalName: string) => void
  onCodexChange?: (changeId: string) => void
}

export function TreeView({ tree, onSelectNode, selectedSpec, onContinueChange, onNewChange, onReactivateChange, onCodexChange }: TreeViewProps) {
  return (
    <div className="tree-view">
      {tree.children?.map((child) => (
        <TreeNode
          key={child.name}
          node={child}
          depth={0}
          onSelectNode={onSelectNode}
          selectedSpec={selectedSpec}
          onContinueChange={onContinueChange}
          onNewChange={onNewChange}
          onReactivateChange={onReactivateChange}
          onCodexChange={onCodexChange}
        />
      ))}
    </div>
  )
}
