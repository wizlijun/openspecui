import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { CloseIcon } from './Icons'

interface ReviewTerminalProps {
  projectPath?: string
  onClose: () => void
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function ReviewTerminal({ projectPath, onClose }: ReviewTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!termRef.current) return

    const bridge = window.__nativeBridge
    if (!bridge) return

    // Create xterm.js instance
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 13,
      fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
      scrollback: 10000,
      theme: {
        background: '#1a1a2e',
        foreground: '#e5e5e5',
        cursor: '#ffffff',
        selectionBackground: 'rgba(255, 255, 255, 0.3)',
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(termRef.current)
    fitAddon.fit()

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    // Send keyboard input to review PTY
    term.onData((data) => {
      bridge.writeReviewInput(data)
    })

    // Receive output from review PTY
    window.__onReviewTerminalOutput = (data: string) => {
      term.write(data)
    }
    window.__onReviewTerminalOutputBytes = (base64Data: string) => {
      term.write(decodeBase64ToBytes(base64Data))
    }

    // Handle review terminal exit
    window.__onReviewTerminalExit = (code: number) => {
      term.write(`\r\n[Review process exited with code ${code}]\r\n`)
    }

    // Start review terminal
    bridge.startReviewTerminal(projectPath || '')

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
      } catch {
        // ignore fit errors during teardown
      }
    })
    resizeObserver.observe(termRef.current)

    // Cleanup
    return () => {
      resizeObserver.disconnect()
      window.__onReviewTerminalOutput = undefined
      window.__onReviewTerminalOutputBytes = undefined
      window.__onReviewTerminalExit = undefined
      bridge.stopReviewTerminal()
      term.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [projectPath])

  return (
    <div className="review-terminal-panel">
      <div className="review-terminal-header">
        <span className="review-terminal-title">Review (Codex)</span>
        <button className="btn-icon" onClick={onClose}><CloseIcon size={14} /></button>
      </div>
      <div className="review-terminal-body" ref={termRef} />
    </div>
  )
}
