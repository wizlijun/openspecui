export interface WorkerProxyConfig {
  useProxy?: boolean
  httpProxy?: string | null
  httpsProxy?: string | null
  allProxy?: string | null
  noProxy?: string | null
}

export interface YamlProxyConfig {
  use_proxy?: boolean
  http_proxy?: string | null
  https_proxy?: string | null
  all_proxy?: string | null
  no_proxy?: string | null
}

const REQUIRED_NO_PROXY = ['127.0.0.1', 'localhost']

function compactProxyConfig(config: WorkerProxyConfig): WorkerProxyConfig | undefined {
  const next: WorkerProxyConfig = {}

  if (typeof config.useProxy === 'boolean') next.useProxy = config.useProxy
  if (config.httpProxy !== undefined) next.httpProxy = config.httpProxy
  if (config.httpsProxy !== undefined) next.httpsProxy = config.httpsProxy
  if (config.allProxy !== undefined) next.allProxy = config.allProxy
  if (config.noProxy !== undefined) next.noProxy = config.noProxy

  return Object.keys(next).length > 0 ? next : undefined
}

export function parseProxyConfig(config?: YamlProxyConfig | null): WorkerProxyConfig | undefined {
  if (!config) return undefined
  return compactProxyConfig({
    useProxy: config.use_proxy,
    httpProxy: config.http_proxy,
    httpsProxy: config.https_proxy,
    allProxy: config.all_proxy,
    noProxy: config.no_proxy,
  })
}

export function mergeProxyConfigs(
  base?: WorkerProxyConfig,
  override?: WorkerProxyConfig,
): WorkerProxyConfig | undefined {
  if (!base && !override) return undefined
  return compactProxyConfig({
    ...(base || {}),
    ...(override || {}),
  })
}

function normalizeNoProxy(value?: string | null): string {
  const seen = new Set<string>()
  const parts: string[] = []

  const add = (raw: string) => {
    const token = raw.trim()
    if (!token || seen.has(token)) return
    seen.add(token)
    parts.push(token)
  }

  if (typeof value === 'string' && value.trim()) {
    value.split(/[,\s]+/).forEach(add)
  }

  REQUIRED_NO_PROXY.forEach(add)
  return parts.join(',')
}

export function buildProxyCommandPrefix(
  proxy: WorkerProxyConfig | undefined,
  shellSingleQuote: (value: string) => string,
): string {
  if (proxy?.useProxy === undefined) return ''

  const commands: string[] = []
  const setOrUnset = (lower: string, upper: string, value?: string | null) => {
    if (typeof value === 'string' && value.trim()) {
      const trimmed = value.trim()
      commands.push(`export ${lower}=${shellSingleQuote(trimmed)}`)
      commands.push(`export ${upper}=${shellSingleQuote(trimmed)}`)
      return
    }
    commands.push(`unset ${lower} ${upper}`)
  }

  if (proxy.useProxy) {
    setOrUnset('http_proxy', 'HTTP_PROXY', proxy.httpProxy)
    setOrUnset('https_proxy', 'HTTPS_PROXY', proxy.httpsProxy)
    setOrUnset('all_proxy', 'ALL_PROXY', proxy.allProxy)
    const noProxy = normalizeNoProxy(proxy.noProxy)
    commands.push(`export no_proxy=${shellSingleQuote(noProxy)}`)
    commands.push(`export NO_PROXY=${shellSingleQuote(noProxy)}`)
  } else {
    commands.push('unset http_proxy HTTP_PROXY https_proxy HTTPS_PROXY all_proxy ALL_PROXY')
  }

  return commands.join('; ')
}

export function prefixCommandWithProxy(
  command: string,
  proxy: WorkerProxyConfig | undefined,
  shellSingleQuote: (value: string) => string,
): string {
  const prefix = buildProxyCommandPrefix(proxy, shellSingleQuote)
  return prefix ? `${prefix}; ${command}` : command
}
