import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { parseCheckboxItems } from './checkboxUtils'
import type { CheckboxItem } from './checkboxUtils'
import type { ConfirmationScenario, ConfirmationButton, ButtonAction } from './loadConfirmationCardConfig'
import { DEFAULT_SCENARIO } from './loadConfirmationCardConfig'

interface HumanConfirmationCardProps {
  text: string
  scenario?: ConfirmationScenario
  onAction: (action: ButtonAction, selectedItems: string[], button: ConfirmationButton) => void
}

export function HumanConfirmationCard({ text, scenario, onAction }: HumanConfirmationCardProps) {
  const activeScenario = scenario || DEFAULT_SCENARIO
  const { items: initialItems, contextLines } = useMemo(
    () => parseCheckboxItems(text, activeScenario.trigger),
    [text, activeScenario.trigger]
  )
  const [items, setItems] = useState<CheckboxItem[]>(initialItems)
  const overlayRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Default: select all items when card opens
    setItems(initialItems.map(item => ({ ...item, checked: true })))
  }, [initialItems])

  // Auto-expand all textareas after items are set
  useEffect(() => {
    // Use requestAnimationFrame to ensure DOM is updated
    requestAnimationFrame(() => {
      const textareas = document.querySelectorAll<HTMLTextAreaElement>('.confirmation-item-text')
      textareas.forEach(el => {
        el.style.height = 'auto'
        el.style.height = el.scrollHeight + 'px'
      })
    })
  }, [items])

  const handleCancel = useCallback(() => {
    onAction('cancel', [], { label: '', action: 'cancel', style: 'secondary' })
  }, [onAction])

  // Focus trap: keep focus inside the card
  useEffect(() => {
    const card = cardRef.current
    if (!card) return

    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    
    const firstFocusable = card.querySelector<HTMLElement>(focusableSelector)
    firstFocusable?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        handleCancel()
        return
      }

      if (e.key === 'Tab') {
        const focusables = Array.from(card.querySelectorAll<HTMLElement>(focusableSelector))
        if (focusables.length === 0) return

        const first = focusables[0]
        const last = focusables[focusables.length - 1]

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }

    const handleKeyDownCapture = (e: KeyboardEvent) => {
      if (!card.contains(e.target as Node)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    document.addEventListener('keydown', handleKeyDownCapture, true)
    card.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDownCapture, true)
      card.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleCancel])

  const handleToggle = (index: number) => {
    setItems(prev => prev.map((item, i) => 
      i === index ? { ...item, checked: !item.checked } : item
    ))
  }

  const handleTextChange = (index: number, newText: string, el?: HTMLTextAreaElement) => {
    setItems(prev => prev.map((item, i) =>
      i === index ? { ...item, text: newText } : item
    ))
    if (el) {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }
  }

  const handleButtonClick = useCallback((button: ConfirmationButton) => {
    const selectedItems = items.filter(item => item.checked).map(item => item.text)
    onAction(button.action, selectedItems, button)
  }, [items, onAction])

  const hasSelection = items.some(item => item.checked)

  // Quick selection helpers
  const selectAll = () => setItems(prev => prev.map(item => ({ ...item, checked: true })))
  const selectNone = () => setItems(prev => prev.map(item => ({ ...item, checked: false })))
  const selectByPriority = (...priorities: string[]) => {
    const prefixes = priorities.map(p => p.toUpperCase())
    setItems(prev => prev.map(item => ({
      ...item,
      checked: prefixes.some(p => item.text.toUpperCase().startsWith(p))
    })))
  }

  // Detect which priority levels exist in items
  const availablePriorities = useMemo(() => {
    const found: string[] = []
    for (const p of ['P0', 'P1', 'P2', 'P3']) {
      if (items.some(item => item.text.toUpperCase().startsWith(p))) {
        found.push(p)
      }
    }
    return found
  }, [items])

  return (
    <div
      className="confirmation-overlay"
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={activeScenario.title}
    >
      <div className="confirmation-card" ref={cardRef}>
        <div className="confirmation-header">
          <h3 className="confirmation-title">{activeScenario.title}</h3>
          {items.length > 0 && (
            <div className="confirmation-quick-select">
              <button className="btn-quick" onClick={selectAll}>All</button>
              <button className="btn-quick" onClick={selectNone}>None</button>
              {availablePriorities.length > 1 && availablePriorities.map((_, i) => {
                const selected = availablePriorities.slice(0, i + 1)
                const label = selected.join('+')
                return (
                  <button key={label} className="btn-quick" onClick={() => selectByPriority(...selected)}>
                    {label}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="confirmation-body">
          {contextLines.length > 0 && (
            <div className="confirmation-context">
              {contextLines.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}

          <div className="confirmation-items">
            {items.map((item, index) => (
              <div key={index} className="confirmation-item">
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={() => handleToggle(index)}
                />
                <textarea
                  className="confirmation-item-text"
                  value={item.text}
                  onChange={(e) => handleTextChange(index, e.target.value, e.target)}
                  rows={1}
                  ref={(el) => {
                    if (el) {
                      el.style.height = 'auto'
                      el.style.height = el.scrollHeight + 'px'
                    }
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="confirmation-actions">
          {activeScenario.buttons.map((btn, index) => (
            <button
              key={index}
              className={btn.style === 'secondary' ? 'btn-secondary' : 'btn-primary'}
              onClick={() => handleButtonClick(btn)}
              disabled={btn.requiresSelection && !hasSelection}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
