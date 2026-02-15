/**
 * Forward JavaScript logs to native Log Panel via webkit message handler.
 * Falls back to console only if native bridge is not available.
 */
export function nativeLog(level: 'log' | 'warn' | 'error', ...args: any[]) {
  // Also log to browser console
  console[level]('[nativeLog]', ...args)
  
  // Forward to native Log Panel via webkit message handler
  try {
    const handler = (window as any).webkit?.messageHandlers?.nativeBridge
    if (handler) {
      const message = args.map(arg => {
        if (typeof arg === 'string') return arg
        if (arg instanceof Error) return `${arg.message}\n${arg.stack}`
        try {
          return JSON.stringify(arg)
        } catch {
          return String(arg)
        }
      }).join(' ')
      
      handler.postMessage(JSON.stringify({
        type: 'jsConsole',
        level,
        message: message.substring(0, 2000),
      }))
    }
  } catch (e) {
    // Silently ignore if native bridge is not available
  }
}
