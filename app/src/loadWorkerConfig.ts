import yaml from 'js-yaml'
import type { WorkerMode, DroidWorkerConfig, QuickButton } from './DroidWorkerBase'

// Default fallback configs
export const DEFAULT_WORKER_CONFIGS: Record<WorkerMode, DroidWorkerConfig> = {
  new_change: {
    mode: 'new_change',
    name: 'New Change',
    autoInitPrompt: null,
    leftButtons: [],
    rightButtons: [
      { label: 'New Change', promptTemplate: '/opsx-new {input}', requiresInput: true },
    ],
  },
  continue_change: {
    mode: 'continue_change',
    name: 'Continue Change',
    autoInitPrompt: '请重新加载openspec的change上下文，changeId为{changeId}',
    leftButtons: [
      { label: 'Continue', prompt: '/opsx-continue' },
      { label: 'Apply', prompt: '/opsx-apply' },
      { label: 'Code Review', action: 'open_codex_code_review' },
    ],
    rightButtons: [],
  },
  fix_review: {
    mode: 'fix_review',
    name: 'Fix Review',
    autoInitPrompt: null,
    leftButtons: [
      { label: 'Fix', promptTemplate: '请按选择的评审意见，先思考原因，再解决，再调试通过：{input}', requiresInput: true },
      { label: 'Review', action: 'open_codex_code_review' },
    ],
    rightButtons: [],
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

function parseButton(btn: YamlButtonConfig): QuickButton {
  return {
    label: btn.label,
    prompt: btn.prompt,
    promptTemplate: btn.prompt_template,
    action: btn.action,
    requiresInput: btn.requires_input || false,
  }
}

function parseModeConfig(mode: WorkerMode, yamlMode: YamlModeConfig): DroidWorkerConfig {
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
 * Load worker configs from YAML file via native bridge.
 * Falls back to DEFAULT_WORKER_CONFIGS if file not found or parse error.
 */
export async function loadWorkerConfigs(projectPath: string): Promise<Record<WorkerMode, DroidWorkerConfig>> {
  const bridge = window.__nativeBridge
  if (!bridge) {
    console.warn('[loadWorkerConfigs] Native bridge not available, using defaults')
    return DEFAULT_WORKER_CONFIGS
  }

  const primaryConfigPath = `${projectPath}/.openspec/droid_worker_define.yml`
  const legacyConfigPath = `${projectPath}/openspec/droid_worker_define.yml`

  try {
    let configPath = primaryConfigPath
    let result = await bridge.readFile(primaryConfigPath)
    if (!result.success || !result.content) {
      const legacyResult = await bridge.readFile(legacyConfigPath)
      if (!legacyResult.success || !legacyResult.content) {
        console.warn(`[loadWorkerConfigs] Failed to read ${primaryConfigPath} or ${legacyConfigPath}, using defaults`)
        return DEFAULT_WORKER_CONFIGS
      }
      result = legacyResult
      configPath = legacyConfigPath
    }

    const parsed = yaml.load(result.content!) as YamlConfig
    if (!parsed?.modes) {
      console.warn('[loadWorkerConfigs] Invalid config structure, using defaults')
      return DEFAULT_WORKER_CONFIGS
    }

    const configs: Record<WorkerMode, DroidWorkerConfig> = { ...DEFAULT_WORKER_CONFIGS }
    const modeKeys: WorkerMode[] = ['new_change', 'continue_change', 'fix_review']

    for (const key of modeKeys) {
      if (parsed.modes[key]) {
        configs[key] = parseModeConfig(key, parsed.modes[key])
      }
    }

    console.log('[loadWorkerConfigs] Loaded configs from', configPath, configs)
    return configs
  } catch (e) {
    console.error('[loadWorkerConfigs] Error loading config:', e)
    return DEFAULT_WORKER_CONFIGS
  }
}
