export type PluginEntry = { tools: string[]; commands: string[] }
export type Inventory = Record<string, PluginEntry>

declare module 'claude-code' {
  interface PluginState {
    'plugin-switch': {
      disabled: Shaped<string[]>
      disabledSkills: Shaped<string[]>
      expanded: Shaped<string[]>
      search: Shaped<string>
      inventory: Shaped<Inventory>
      suggestion: Shaped<string[] | null>
      profile: Shaped<string>
    }
  }
}
