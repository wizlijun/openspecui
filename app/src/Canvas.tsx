import { useState, useRef, useCallback, useEffect } from 'react'
import type { FileTreeNode } from './useDirectoryPicker'
import { isSpecNode, isChangeNode, isArtifactNode, isSectionNode } from './useDirectoryPicker'
import { FolderIcon, SpecIcon, GitBranchIcon, FileTextIcon } from './Icons'

interface CardState {
  node: FileTreeNode
  x: number
  y: number
}

interface CanvasProps {
  node: FileTreeNode
  onSelectSpec: (node: FileTreeNode) => void
  onOpenDir: (node: FileTreeNode) => void
}

function autoLayout(nodes: FileTreeNode[]): CardState[] {
  // Filter out section nodes — they're not cards
  const filtered = nodes.filter(n => !isSectionNode(n))
  const cols = 4
  const gapX = 200
  const gapY = 140
  return filtered.map((n, i) => ({
    node: n,
    x: (i % cols) * gapX + 20,
    y: Math.floor(i / cols) * gapY + 20,
  }))
}

function getCardClass(node: FileTreeNode): string {
  if (isSpecNode(node)) return 'card-spec'
  if (isChangeNode(node)) return 'card-change'
  if (isArtifactNode(node)) return 'card-artifact'
  return 'card-dir'
}

function getCardIcon(node: FileTreeNode) {
  if (isSpecNode(node)) return <SpecIcon size={28} />
  if (isChangeNode(node)) return <GitBranchIcon size={28} />
  if (isArtifactNode(node)) return <FileTextIcon size={28} color="#e8a838" />
  return <FolderIcon size={28} />
}

export function Canvas({ node, onSelectSpec, onOpenDir }: CanvasProps) {
  const [cards, setCards] = useState<CardState[]>([])
  const dragRef = useRef<{ idx: number; startX: number; startY: number; cardX: number; cardY: number } | null>(null)
  const movedRef = useRef(false)

  useEffect(() => {
    setCards(autoLayout(node.children ?? []))
  }, [node])

  const handlePointerDown = useCallback((e: React.PointerEvent, idx: number) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    movedRef.current = false
    dragRef.current = {
      idx,
      startX: e.clientX,
      startY: e.clientY,
      cardX: cards[idx].x,
      cardY: cards[idx].y,
    }
  }, [cards])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return
    movedRef.current = true
    const { idx, startX, startY, cardX, cardY } = dragRef.current
    setCards(prev => {
      const next = [...prev]
      next[idx] = {
        ...next[idx],
        x: cardX + (e.clientX - startX),
        y: cardY + (e.clientY - startY),
      }
      return next
    })
  }, [])

  const handlePointerUp = useCallback(() => {
    dragRef.current = null
  }, [])

  const handleCardClick = useCallback((card: CardState) => {
    if (movedRef.current) return
    if (isSpecNode(card.node) || isArtifactNode(card.node)) {
      onSelectSpec(card.node)
    } else if (isChangeNode(card.node) || card.node.kind === 'directory') {
      onOpenDir(card.node)
    }
  }, [onSelectSpec, onOpenDir])

  if (!cards.length) {
    return <div className="canvas-empty">Empty directory</div>
  }

  return (
    <div
      className="canvas-inner"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {cards.map((card, idx) => (
        <div
          key={`${card.node.name}-${idx}`}
          className={`card ${getCardClass(card.node)} ${card.node.archived ? 'card-archived' : ''}`}
          style={{ left: card.x, top: card.y }}
          onPointerDown={(e) => handlePointerDown(e, idx)}
          onClick={() => handleCardClick(card)}
        >
          <div className="card-icon">{getCardIcon(card.node)}</div>
          <div className="card-name">{card.node.name}</div>
          {(card.node.kind === 'directory' && !isArtifactNode(card.node)) && (
            <div className="card-count">{card.node.children?.length ?? 0} items</div>
          )}
        </div>
      ))}
    </div>
  )
}
