import yaml from 'js-yaml'

export type ButtonAction = 'cancel' | 'submit' | 'droid_fix' | 'auto_fix' | string
export type ButtonTarget = 'droid_worker' | 'current'
export type ButtonStyle = 'primary' | 'secondary'

export interface ConfirmationButton {
  label: string
  action: ButtonAction
  style: ButtonStyle
  messageTemplate?: string
  target?: ButtonTarget
  requiresSelection?: boolean
}

export interface ConfirmationScenario {
  trigger?: string  // Trigger pattern (e.g., "[fix_confirmation]")
  title: string
  description?: string
  buttons: ConfirmationButton[]
}

export interface ConfirmationCardConfig {
  scenarios: Record<string, ConfirmationScenario>
}

// Default hardcoded scenario (not in config file)
export const DEFAULT_SCENARIO: ConfirmationScenario = {
  title: '请确认',
  buttons: [
    {
      label: 'Cancel',
      action: 'cancel',
      style: 'secondary',
    },
    {
      label: 'Submit',
      action: 'submit',
      style: 'primary',
      requiresSelection: true,
    },
  ],
}

// Default fallback config
export const DEFAULT_CONFIRMATION_CARD_CONFIG: ConfirmationCardConfig = {
  scenarios: {
    default: DEFAULT_SCENARIO,
  },
}

interface YamlButtonConfig {
  label: string
  action: string
  style?: string
  message_template?: string
  target?: string
  requires_selection?: boolean
}

interface YamlScenarioConfig {
  trigger?: string
  title?: string
  description?: string
  buttons?: YamlButtonConfig[]
}

interface YamlConfig {
  scenarios?: Record<string, YamlScenarioConfig>
}

function parseButton(btn: YamlButtonConfig): ConfirmationButton {
  return {
    label: btn.label,
    action: btn.action,
    style: (btn.style === 'secondary' ? 'secondary' : 'primary') as ButtonStyle,
    messageTemplate: btn.message_template,
    target: (btn.target === 'droid_worker' || btn.target === 'current' ? btn.target : undefined) as ButtonTarget | undefined,
    requiresSelection: btn.requires_selection ?? false,
  }
}

function parseScenario(scenario: YamlScenarioConfig): ConfirmationScenario {
  return {
    trigger: scenario.trigger,
    title: scenario.title || '请确认',
    description: scenario.description,
    buttons: (scenario.buttons || []).map(parseButton),
  }
}

/**
 * Load confirmation card config from YAML file via native bridge.
 * Falls back to DEFAULT_CONFIRMATION_CARD_CONFIG if file not found or parse error.
 */
export async function loadConfirmationCardConfig(projectPath: string): Promise<ConfirmationCardConfig> {
  const bridge = window.__nativeBridge
  if (!bridge) {
    console.warn('[loadConfirmationCardConfig] Native bridge not available, using defaults')
    return DEFAULT_CONFIRMATION_CARD_CONFIG
  }

  const configPath = `${projectPath}/.openspec/confirmation_card.yml`

  try {
    const result = await bridge.readFile(configPath)
    if (!result.success || !result.content) {
      console.warn(`[loadConfirmationCardConfig] Failed to read ${configPath}, using defaults`)
      return DEFAULT_CONFIRMATION_CARD_CONFIG
    }

    const parsed = yaml.load(result.content) as YamlConfig
    if (!parsed || !parsed.scenarios) {
      console.warn('[loadConfirmationCardConfig] Invalid config structure, using defaults')
      return DEFAULT_CONFIRMATION_CARD_CONFIG
    }

    const scenarios: Record<string, ConfirmationScenario> = {}
    
    // Always include default scenario (hardcoded)
    scenarios.default = DEFAULT_SCENARIO

    // Parse configured scenarios
    for (const [key, scenarioConfig] of Object.entries(parsed.scenarios)) {
      scenarios[key] = parseScenario(scenarioConfig)
    }

    const config: ConfirmationCardConfig = { scenarios }

    console.log('[loadConfirmationCardConfig] Loaded config from', configPath, config)
    return config
  } catch (e) {
    console.error('[loadConfirmationCardConfig] Error loading config:', e)
    return DEFAULT_CONFIRMATION_CARD_CONFIG
  }
}

/**
 * Detect which scenario to use based on the message text.
 * Returns the scenario key (e.g., 'review_confirm', 'default').
 */
export function detectScenario(text: string, config: ConfirmationCardConfig): string {
  // Check each scenario's trigger pattern
  for (const [key, scenario] of Object.entries(config.scenarios)) {
    if (key === 'default') continue  // Skip default, it's the fallback
    
    if (scenario.trigger) {
      // Simple case-insensitive prefix match
      if (text.trim().toLowerCase().startsWith(scenario.trigger.toLowerCase())) {
        return key
      }
    }
  }
  
  // Fallback to default
  return 'default'
}
