import yaml from 'js-yaml'
import type { CodexWorkerMode, CodexWorkerConfig, CodexQuickButton } from './CodexWorkerBase'

// Default fallback configs — mirrors codex_worker_define.yml so core actions
// remain available during async config loading or on read failure.
export const DEFAULT_CODEX_CONFIGS: Record<CodexWorkerMode, CodexWorkerConfig> = {
  standalone: {
    mode: 'standalone',
    name: 'Codex Worker',
    autoInitPrompt: null,
    leftButtons: [
      { label: 'Review', prompt: '严格评审上次git提交之后修改代码和构建，只给评审建议，要求文法简洁、清晰、认知负荷低。结果按优先级P0、P1、P2排序，以todo的列表形式返回， 每一项的文本前面加上 P0/P1，例如 - [ ] P0 描述。请在返回结果最开始加上[fix_confirmation]', requiresInput: false },
    ],
    rightButtons: [],
  },
  code_review: {
    mode: 'code_review',
    name: 'Code Review',
    autoInitPrompt: '严格评审上次git提交之后修改的代码,无需修改代码和构建，只给评审建议，要求文法简洁、清晰、认知负荷低。结果按优先级P0、P1、P2排序，以todo的列表形式返回， 每一项的文本前面加上 P0/P1，例如 - [ ] P0 描述。changeId为{changeId}。请在返回结果最开始加上[fix_confirmation]',
    leftButtons: [
      { label: 'Review Again', prompt: '请再次严格评审修改的代码,无需修改代码和构建，只给评审建议，要求文法简洁、清晰、认知负荷低。结果按优先级P0、P1、P2排序，以todo的列表形式返回， 每一项的文本前面加上 P0/P1，例如 - [ ] P0 描述。请在返回结果最开始加上[fix_confirmation]', requiresInput: false },
      { label: 'Fix', promptTemplate: '请按选择的评审意见，先思考原因，再解决，再调试通过：{input}', requiresInput: true },
      { label: 'Droid Fix', action: 'droid_fix', requiresInput: false },
      { label: 'Auto Fix', action: 'auto_fix', requiresInput: false },
    ],
    rightButtons: [],
    confirmation: { enabled: true, responseTemplate: '已确认以下评审项目：\n{selected_items}' },
  },
}

interface YamlButtonConfig {
  label: string
  prompt?: string
  prompt_template?: string
  action?: string
  requires_input?: boolean
}

interface YamlConfirmationConfig {
  enabled?: boolean
  response_template?: string
}

interface YamlModeConfig {
  name: string
  description?: string
  auto_init_prompt?: string | null
  buttons: {
    left?: YamlButtonConfig[]
    right?: YamlButtonConfig[]
  }
  confirmation?: YamlConfirmationConfig
}

interface YamlConfig {
  modes: Record<string, YamlModeConfig>
}

function parseButton(btn: YamlButtonConfig): CodexQuickButton {
  return {
    label: btn.label,
    prompt: btn.prompt,
    promptTemplate: btn.prompt_template,
    action: btn.action,
    requiresInput: btn.requires_input || false,
  }
}

function parseModeConfig(mode: CodexWorkerMode, yamlMode: YamlModeConfig): CodexWorkerConfig {
  return {
    mode,
    name: yamlMode.name,
    autoInitPrompt: yamlMode.auto_init_prompt === undefined ? null : yamlMode.auto_init_prompt,
    leftButtons: (yamlMode.buttons?.left || []).map(parseButton),
    rightButtons: (yamlMode.buttons?.right || []).map(parseButton),
    confirmation: yamlMode.confirmation ? {
      enabled: yamlMode.confirmation.enabled !== false,
      responseTemplate: yamlMode.confirmation.response_template,
    } : { enabled: true },
  }
}

/**
 * Load codex worker configs from YAML file via native bridge.
 * Falls back to DEFAULT_CODEX_CONFIGS if file not found or parse error.
 */
export async function loadCodexWorkerConfigs(projectPath: string): Promise<Record<CodexWorkerMode, CodexWorkerConfig>> {
  const bridge = window.__nativeBridge
  if (!bridge) {
    console.warn('[loadCodexWorkerConfigs] Native bridge not available, using defaults')
    return DEFAULT_CODEX_CONFIGS
  }

  const primaryConfigPath = `${projectPath}/.openspec/codex_worker_define.yml`
  const legacyConfigPath = `${projectPath}/openspec/codex_worker_define.yml`

  try {
    let configPath = primaryConfigPath
    let result = await bridge.readFile(primaryConfigPath)
    if (!result.success || !result.content) {
      const legacyResult = await bridge.readFile(legacyConfigPath)
      if (!legacyResult.success || !legacyResult.content) {
        console.warn(`[loadCodexWorkerConfigs] Failed to read ${primaryConfigPath} or ${legacyConfigPath}, using defaults`)
        return DEFAULT_CODEX_CONFIGS
      }
      result = legacyResult
      configPath = legacyConfigPath
    }

    const parsed = yaml.load(result.content!) as YamlConfig
    if (!parsed?.modes) {
      console.warn('[loadCodexWorkerConfigs] Invalid config structure, using defaults')
      return DEFAULT_CODEX_CONFIGS
    }

    const configs: Record<CodexWorkerMode, CodexWorkerConfig> = { ...DEFAULT_CODEX_CONFIGS }
    const modeKeys: CodexWorkerMode[] = ['standalone', 'code_review']

    for (const key of modeKeys) {
      if (parsed.modes[key]) {
        configs[key] = parseModeConfig(key, parsed.modes[key])
      }
    }

    console.log('[loadCodexWorkerConfigs] Loaded configs from', configPath, configs)
    return configs
  } catch (e) {
    console.error('[loadCodexWorkerConfigs] Error loading config:', e)
    return DEFAULT_CODEX_CONFIGS
  }
}
