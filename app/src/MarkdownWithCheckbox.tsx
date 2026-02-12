import { useState, useMemo } from 'react'

interface MarkdownWithCheckboxProps {
  text: string
  className?: string
}

interface CheckboxItem {
  index: number
  checked: boolean
  lineStart: number
  lineEnd: number
}

export function MarkdownWithCheckbox({ text, className = '' }: MarkdownWithCheckboxProps) {
  const [checkboxStates, setCheckboxStates] = useState<Map<number, boolean>>(new Map())

  const { lines, checkboxes } = useMemo(() => {
    const lines = text.split('\n')
    const checkboxes: CheckboxItem[] = []
    
    lines.forEach((line, index) => {
      const uncheckedMatch = line.match(/^(\s*)(?:-|\d+\.?)?\s*\[\s\]\s+(.*)$/)
      const checkedMatch = line.match(/^(\s*)(?:-|\d+\.?)?\s*\[x\]\s+(.*)$/i)
      
      if (uncheckedMatch || checkedMatch) {
        checkboxes.push({
          index,
          checked: !!checkedMatch,
          lineStart: 0,
          lineEnd: line.length
        })
      }
    })
    
    return { lines, checkboxes }
  }, [text])

  const handleCheckboxToggle = (checkboxIndex: number) => {
    const checkbox = checkboxes[checkboxIndex]
    if (!checkbox) return

    setCheckboxStates(prev => {
      const newStates = new Map(prev)
      const currentState = newStates.get(checkboxIndex) ?? checkbox.checked
      newStates.set(checkboxIndex, !currentState)
      return newStates
    })
  }

  const renderLine = (line: string, lineIndex: number) => {
    const checkboxIndex = checkboxes.findIndex(cb => cb.index === lineIndex)
    
    if (checkboxIndex === -1) {
      return line
    }

    const checkbox = checkboxes[checkboxIndex]
    const currentChecked = checkboxStates.get(checkboxIndex) ?? checkbox.checked
    
    const uncheckedMatch = line.match(/^(\s*)(?:-|\d+\.?)?\s*\[\s\]\s+(.*)$/)
    const checkedMatch = line.match(/^(\s*)(?:-|\d+\.?)?\s*\[x\]\s+(.*)$/i)
    const match = uncheckedMatch || checkedMatch
    
    if (!match) return line

    const content = match[2]

    return (
      <span style={{ display: 'block' }}>
        {'    '}[
        <input
          type="checkbox"
          checked={currentChecked}
          onChange={() => handleCheckboxToggle(checkboxIndex)}
          style={{
            margin: '0 2px',
            cursor: 'pointer',
            verticalAlign: 'middle'
          }}
        />
        ] {content}
      </span>
    )
  }

  return (
    <pre className={className}>
      {lines.map((line, index) => (
        <span key={index}>
          {renderLine(line, index)}
          {index < lines.length - 1 && '\n'}
        </span>
      ))}
    </pre>
  )
}
