import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import 'xterm/css/xterm.css'

type TerminalChannel = 'main' | 'review' | 'droid' | 'codex'

interface EmbeddedTerminalProps {
  channel?: TerminalChannel
  tabId?: string  // Required for 'droid' and 'codex' channels
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function EmbeddedTerminal({ channel = 'main', tabId }: EmbeddedTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const resizeTimerRef = useRef<number | null>(null)
  const lastSizeRef = useRef({ cols: 0, rows: 0 })

  useEffect(() => {
    if (!termRef.current) return

    // ─── Terminal Configuration (from terminal.html) ───
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 13,
      fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
      fontWeight: 400,
      fontWeightBold: 700,
      lineHeight: 1.0,
      letterSpacing: 0,
      allowProposedApi: true,
      scrollback: 3000,
      tabStopWidth: 8,
      convertEol: false,
      windowsMode: false,
      macOptionIsMeta: true,
      altClickMovesCursor: true,
      theme: {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#ffffff',
        cursorAccent: '#000000',
        selectionBackground: 'rgba(255, 255, 255, 0.3)',
        selectionForeground: undefined,
        selectionInactiveBackground: 'rgba(255, 255, 255, 0.15)',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(termRef.current)

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    // Intercept Cmd+C/V/A so xterm doesn't send them to PTY
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        // Cmd+C: only intercept if there's a selection (copy), otherwise let SIGINT through
        if (e.key === 'c' && term.hasSelection()) return false
        // Cmd+V and Cmd+A: always intercept
        if (e.key === 'v' || e.key === 'a') return false
      }
      return true
    })

    // ─── Channel-specific Input/Output ───
    if (channel === 'main') {
      // Keyboard Input → Native PTY (main)
      term.onData((data) => {
        if (window.webkit?.messageHandlers?.terminalInput) {
          window.webkit.messageHandlers.terminalInput.postMessage(data)
        }
      })
      term.onBinary((data) => {
        if (window.webkit?.messageHandlers?.terminalInput) {
          window.webkit.messageHandlers.terminalInput.postMessage(data)
        }
      })
      // Receive Output from Native PTY (main)
      window.__onTerminalOutput = (text: string) => {
        term.write(text)
      }
      window.__onTerminalOutputBytes = (base64: string) => {
        term.write(decodeBase64ToBytes(base64))
      }
    } else if ((channel === 'droid' || channel === 'codex') && tabId) {
      // Keyboard Input → Native PTY (per-tab worker terminal)
      term.onData((data) => {
        if (window.__nativeBridge) {
          window.__nativeBridge.writeChangeInput(tabId, data)
        }
      })
      term.onBinary((data) => {
        if (window.__nativeBridge) {
          window.__nativeBridge.writeChangeInput(tabId, data)
        }
      })
      // Receive Output from Native PTY (per-tab)
      if (!window.__onChangeTerminalOutput) window.__onChangeTerminalOutput = {}
      if (!window.__onChangeTerminalOutputBytes) window.__onChangeTerminalOutputBytes = {}
      window.__onChangeTerminalOutput[tabId] = (text: string) => {
        term.write(text)
      }
      window.__onChangeTerminalOutputBytes[tabId] = (base64: string) => {
        term.write(decodeBase64ToBytes(base64))
      }
    } else {
      // Keyboard Input → Native PTY (review)
      term.onData((data) => {
        if (window.__nativeBridge) {
          window.__nativeBridge.writeReviewInput(data)
        }
      })
      term.onBinary((data) => {
        if (window.__nativeBridge) {
          window.__nativeBridge.writeReviewInput(data)
        }
      })
      // Receive Output from Native PTY (review)
      window.__onReviewTerminalOutput = (text: string) => {
        term.write(text)
      }
      window.__onReviewTerminalOutputBytes = (base64: string) => {
        term.write(decodeBase64ToBytes(base64))
      }
    }

    // ─── Resize Handling with Debounce ───
    const notifyResize = () => {
      const cols = term.cols
      const rows = term.rows

      if (cols === lastSizeRef.current.cols && rows === lastSizeRef.current.rows) {
        return
      }

      lastSizeRef.current = { cols, rows }

      if (channel === 'main' && window.webkit?.messageHandlers?.terminalResize) {
        window.webkit.messageHandlers.terminalResize.postMessage({ cols, rows })
        console.log(`Terminal [${channel}] resized: ${cols}x${rows}`)
      } else if ((channel === 'droid' || channel === 'codex') && tabId && window.webkit?.messageHandlers?.nativeBridge) {
        window.webkit.messageHandlers.nativeBridge.postMessage(
          JSON.stringify({ type: 'changeTerminalResize', tabId, cols, rows })
        )
        console.log(`Terminal [${channel}:${tabId}] resized: ${cols}x${rows}`)
      } else if (channel === 'review' && window.webkit?.messageHandlers?.nativeBridge) {
        window.webkit.messageHandlers.nativeBridge.postMessage(
          JSON.stringify({ type: 'reviewTerminalResize', cols, rows })
        )
        console.log(`Terminal [${channel}] resized: ${cols}x${rows}`)
      }
    }

    const handleResize = () => {
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current)
      }

      try {
        fitAddon.fit()
      } catch (e) {
        console.error('fit error:', e)
      }

      resizeTimerRef.current = window.setTimeout(() => {
        notifyResize()
        resizeTimerRef.current = null
      }, 100)
    }

    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(termRef.current)

    // Initial fit and notify (don't auto-focus)
    setTimeout(() => {
      try {
        fitAddon.fit()
        notifyResize()
      } catch (e) {
        console.error('Initial setup error:', e)
      }
    }, 100)

    // Focus only when clicking inside the terminal container
    const container = termRef.current
    const handleClick = () => term.focus()
    container.addEventListener('click', handleClick)

    // Handle Cmd+C (copy) and Cmd+V (paste)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'c' && term.hasSelection()) {
          // Copy selected text to clipboard
          e.preventDefault()
          const selection = term.getSelection()
          navigator.clipboard.writeText(selection).catch(err => {
            console.error('Failed to copy:', err)
          })
        } else if (e.key === 'v') {
          // Paste from clipboard — wrap in bracketed paste mode so the
          // shell/application treats the text as a single block instead of
          // processing each character individually (which is very slow).
          e.preventDefault()
          navigator.clipboard.readText().then(text => {
            const wrapped = `\x1b[200~${text}\x1b[201~`
            if (channel === 'main') {
              if (window.webkit?.messageHandlers?.terminalInput) {
                window.webkit.messageHandlers.terminalInput.postMessage(wrapped)
              }
            } else if ((channel === 'droid' || channel === 'codex') && tabId) {
              if (window.__nativeBridge) {
                window.__nativeBridge.writeChangeInput(tabId, wrapped)
              }
            } else {
              if (window.__nativeBridge) {
                window.__nativeBridge.writeReviewInput(wrapped)
              }
            }
          }).catch(err => {
            console.error('Failed to paste:', err)
          })
        }
      }
    }
    container.addEventListener('keydown', handleKeyDown)

    // Cleanup
    return () => {
      resizeObserver.disconnect()
      container.removeEventListener('click', handleClick)
      container.removeEventListener('keydown', handleKeyDown)
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current)
      }
      if (channel === 'main') {
        window.__onTerminalOutput = undefined
        window.__onTerminalOutputBytes = undefined
      } else if ((channel === 'droid' || channel === 'codex') && tabId) {
        if (window.__onChangeTerminalOutput) {
          delete window.__onChangeTerminalOutput[tabId]
        }
        if (window.__onChangeTerminalOutputBytes) {
          delete window.__onChangeTerminalOutputBytes[tabId]
        }
      } else {
        window.__onReviewTerminalOutput = undefined
        window.__onReviewTerminalOutputBytes = undefined
      }
      term.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [channel, tabId])

  return <div ref={termRef} className="embedded-terminal" />
}
