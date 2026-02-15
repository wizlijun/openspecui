export interface CheckboxItem {
  text: string
  checked: boolean
}

/**
 * Parse markdown text to extract checkbox items and context text.
 * Skips lines inside fenced code blocks to avoid false positives.
 * Used to build dialog data for the native confirmation window.
 * 
 * @param text - The markdown text to parse
 * @param triggerToSkip - Optional trigger pattern to skip (e.g., "[fix_confirmation]")
 */
export function parseCheckboxItems(text: string, triggerToSkip?: string): { items: CheckboxItem[]; contextLines: string[] } {
  const lines = text.split('\n')
  const items: CheckboxItem[] = []
  const contextLines: string[] = []
  let inCodeBlock = false

  for (const line of lines) {
    // Track fenced code block boundaries
    if (/^```/.test(line)) {
      inCodeBlock = !inCodeBlock
      continue
    }

    // Skip lines inside code blocks
    if (inCodeBlock) continue

    // Skip trigger marker line if provided
    if (triggerToSkip && line.trim().toLowerCase().startsWith(triggerToSkip.toLowerCase())) {
      continue
    }

    const uncheckedMatch = line.match(/^(\s*)-\s\[\s\]\s(.+)$/)
    const checkedMatch = line.match(/^(\s*)-\s\[x\]\s(.+)$/i)

    if (uncheckedMatch) {
      items.push({ text: uncheckedMatch[2].trim(), checked: false })
    } else if (checkedMatch) {
      items.push({ text: checkedMatch[2].trim(), checked: true })
    } else if (line.trim()) {
      contextLines.push(line)
    }
  }

  return { items, contextLines }
}

/**
 * Filter checkbox items to only include P0 and P1 priority items.
 * Strips common Markdown wrappers (bold, italic, brackets) before matching
 * so that formats like **P0**, [P1], *P0* are correctly identified.
 */
export function filterP0P1Items(items: CheckboxItem[]): CheckboxItem[] {
  return items.filter(item => {
    // Strip common Markdown formatting: **bold**, *italic*, __underline__, [brackets]
    const stripped = item.text.trim().replace(/^[\s*_[\]]+/, '').toUpperCase()
    return /\bP[01]\b/.test(stripped)
  })
}

/**
 * Check if a list of checkbox items contains any unchecked P0 or P1 items.
 */
export function hasP0P1Items(items: CheckboxItem[]): boolean {
  return filterP0P1Items(items.filter(item => !item.checked)).length > 0
}
