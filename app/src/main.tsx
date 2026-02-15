import { createRoot, type Root } from 'react-dom/client'
import { Component, type ReactNode, type ErrorInfo } from 'react'
import App from './App.tsx'

// ─── Global Error Boundary ─────────────────────────────────────────
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] ❌ React component crashed:', error)
    console.error('[ErrorBoundary] Component stack:', info.componentStack)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, color: '#e94560', fontFamily: 'monospace' }}>
          <h2>⚠ Component Error</h2>
          <pre>{this.state.error?.message}</pre>
          <pre>{this.state.error?.stack}</pre>
          <button onClick={() => this.setState({ hasError: false, error: null })}>
            Try Again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ─── Global uncaught error/rejection handlers ──────────────────────
const handleGlobalError = (event: ErrorEvent) => {
  console.error('[GlobalError] ❌ Uncaught error:', event.error || event.message)
  console.error('[GlobalError] Source:', event.filename, 'line:', event.lineno, 'col:', event.colno)
}

const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
  console.error('[GlobalError] ❌ Unhandled promise rejection:', event.reason)
}

window.addEventListener('error', handleGlobalError)
window.addEventListener('unhandledrejection', handleUnhandledRejection)

// Clean up on HMR to avoid duplicate listeners
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener('error', handleGlobalError)
    window.removeEventListener('unhandledrejection', handleUnhandledRejection)
  })
}

// ─── React Root (HMR-safe) ─────────────────────────────────────────
// Cache the root instance on the DOM element to avoid calling createRoot()
// multiple times during Vite HMR, which would destroy the entire React tree
// and kill all running worker terminals.
// Helper to send logs directly to native Log Panel
function logToNative(level: string, msg: string) {
  console.log(msg)
  try {
    const handler = (window as any).webkit?.messageHandlers?.nativeBridge
    if (handler) {
      handler.postMessage(JSON.stringify({ type: 'jsConsole', level, message: msg }))
    }
  } catch (e) { /* ignore */ }
}

const container = document.getElementById('root')!
const existingRoot = (container as any).__reactRoot as Root | undefined

const tree = (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)

if (existingRoot) {
  logToNative('warn', '[main] ⚠ HMR: reusing existing React root (render only, state preserved)')
  existingRoot.render(tree)
} else {
  logToNative('log', '[main] Creating new React root (first load or full reload)')
  const root = createRoot(container)
  ;(container as any).__reactRoot = root
  root.render(tree)
}
