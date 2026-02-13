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
      { label: 'Review', action: 'open_codex_review' },
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

interface YamlModeConfig {
  name: string
  description?: string
  auto_init_prompt?: string | null
  buttons: {
    left?: YamlButtonConfig[]
    right?: YamlButtonConfig[]
  }
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

  const configPath = `${projectPath}/openspec/droid_worker_define.yml`

  try {
    const result = await bridge.readFile(configPath)
    if (!result.success || !result.content) {
      console.warn(`[loadWorkerConfigs] Failed to read ${configPath}, using defaults`)
      return DEFAULT_WORKER_CONFIGS
    }

    const parsed = yaml.load(result.content) as YamlConfig
    if (!parsed?.modes) {
      console.warn('[loadWorkerConfigs] Invalid config structure, using defaults')
      return DEFAULT_WORKER_CONFIGS
    }

    const configs: Record<WorkerMode, DroidWorkerConfig> = { ...DEFAULT_WORKER_CONFIGS }
    const modeKeys: WorkerMode[] = ['new_change', 'continue_change']

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
