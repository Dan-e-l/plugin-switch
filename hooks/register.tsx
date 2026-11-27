import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Inventory } from '../types'

const PANE = 'plugin-switch'
const TITLE = 'Plugins'
const ME = 'plugin-switch'
// Plugins that are never switched off: this mod and the mod tooling.
const PROTECTED = new Set([ME, 'plugin-authoring'])

const disabled = atom({ plugin: 'plugin-switch', key: 'disabled' } as const, [], { shape: 'disabled-1' })
const disabledSkills = atom({ plugin: 'plugin-switch', key: 'disabledSkills' } as const, [], { shape: 'dskills-1' })
const expanded = atom({ plugin: 'plugin-switch', key: 'expanded' } as const, [], { shape: 'expanded-1' })
const search = atom({ plugin: 'plugin-switch', key: 'search' } as const, '', { shape: 'search-1' })
const inventory = atom({ plugin: 'plugin-switch', key: 'inventory' } as const, {}, { shape: 'inventory-1' })
const suggestion = atom({ plugin: 'plugin-switch', key: 'suggestion' } as const, null, { shape: 'suggestion-1' })
const profile = atom({ plugin: 'plugin-switch', key: 'profile' } as const, 'alle', { shape: 'profile-1' })

// Profiles name the plugins that stay ON; every other plugin is switched off.
const PROFILES: Record<string, string[] | null> = {
  alle: null,
  coding: ['engineering', 'claude-security', 'frontend-design', 'anthropic-skills'],
  legal: ['legal', 'anthropic-skills'],
  marketing: ['marketing', 'anthropic-skills'],
  produkt: ['product-management', 'anthropic-skills'],
  research: ['equity-research', 'anthropic-skills'],
}

// Keyword heuristic for suggestions (German + English, lowercase substrings).
const KEYWORDS: Record<string, string[]> = {
  engineering: ['code', 'bug', 'fehler', 'deploy', 'test', 'refactor', 'pull request', ' pr ', 'api', 'debug',
    'architektur', 'architecture', 'incident', 'standup', 'repo', 'commit', 'funktion', 'function', 'skript', 'script'],
  'claude-security': ['security', 'sicherheit', 'vulnerab', 'schwachstelle', 'cve', 'sarif', 'pentest', 'angriff'],
  'frontend-design': ['frontend', 'ui ', 'ux', 'css', 'layout', 'webseite', 'website', 'landing'],
  legal: ['vertrag', 'contract', 'nda', 'dsgvo', 'gdpr', 'compliance', 'recht', 'legal', 'klausel', 'clause', 'signatur'],
  marketing: ['kampagne', 'campaign', 'seo', 'newsletter', 'blog', 'social media', 'brand', 'marke', 'werbung', 'e-mail-sequenz'],
  'product-management': ['roadmap', 'spec', 'prd', 'sprint', 'stakeholder', 'feature', 'user research', 'interview', 'backlog'],
  'equity-research': ['aktie', 'stock', 'earnings', 'valuation', 'bewertung', 'sektor', 'sector', 'investment', 'quartal', 'ticker'],
}

// Readable names and one-line descriptions for the list.
const LABELS: Record<string, [string, string]> = {
  engineering: ['Engineering', 'Code, Debugging, Deploys, Incidents'],
  'claude-security': ['Security', 'Scans, Schwachstellen, Patches'],
  'frontend-design': ['Frontend-Design', 'UI und visuelles Design'],
  legal: ['Legal', 'Verträge, NDAs, Compliance'],
  marketing: ['Marketing', 'Kampagnen, SEO, Content'],
  'product-management': ['Produkt', 'Specs, Roadmap, Sprints'],
  'equity-research': ['Equity Research', 'Aktien, Earnings, Sektoren'],
  'anthropic-skills': ['Dokumente', 'Docs, PDF, Word, Excel, PowerPoint'],
  'plugin-authoring': ['Mod-Werkzeuge', 'Wird für diese Mod gebraucht'],
  'plugin-switch': ['Plugin-Switch', 'Diese Mod'],
  user: ['Eigene Skills', 'Deine persönlichen Skills'],
}

const PROFILE_LABELS: Record<string, string> = {
  alle: 'Alle', coding: 'Coding', legal: 'Legal', marketing: 'Marketing',
  produkt: 'Produkt', research: 'Research', eigene: 'Eigene Auswahl', vorschlag: 'Vorschlag',
}

const MCP_PLUGIN_TOOL = /^mcp__plugin_([a-z0-9-]+)_/

function pluginOfTool(name: string, registeredBy?: string): string | undefined {
  const m = MCP_PLUGIN_TOOL.exec(name)
  if (m) return norm(m[1] ?? "")
  if (registeredBy && registeredBy !== 'engine') return norm(registeredBy)
  return undefined
}

// "engineering@synced" and "engineering" are the same plugin.
function norm(p: string): string {
  return p.split('@')[0] ?? p
}

// "engineering@synced:debug" -> "engineering:debug"
function skillKey(name: string): string {
  const i = name.indexOf(':')
  return i > 0 ? `${norm(name.slice(0, i))}${name.slice(i)}` : name
}

function shortSkill(name: string): string {
  const i = name.indexOf(':')
  return i > 0 ? name.slice(i + 1) : name
}

// Merge inventory entries whose names differ only by an "@source" suffix.
function merged(inv: Inventory): Inventory {
  const out: Inventory = {}
  for (const [k, v] of Object.entries(inv)) {
    const n = norm(k)
    const cur = out[n] ?? { tools: [], commands: [] }
    out[n] = {
      tools: [...new Set([...cur.tools, ...v.tools])],
      commands: [...new Set([...cur.commands, ...v.commands])],
    }
  }
  return out
}

function pluginOfCommand(name: string, plugin?: string): string | undefined {
  if (plugin) return norm(plugin)
  const i = name.indexOf(':')
  return i > 0 ? norm(name.slice(0, i)) : undefined
}

function suggest(text: string): string[] {
  const t = ` ${text.toLowerCase()} `
  return Object.keys(KEYWORDS).filter(p => (KEYWORDS[p] ?? []).some(k => t.includes(k)))
}

// Commands seen through command.describe, so hidden ones stay in the inventory.
const seenCommands = new Map<string, string>()

function refresh($: EngineInterface) {
  $.ui.invalidate('tool.list')
  $.ui.invalidate('command.describe')
  $.ui.invalidate('prompt.attachment')
  $.ui.invalidate('ui.render')
}

async function setDisabled($: EngineInterface, fn: (d: string[]) => string[]) {
  await update($, disabled, d => [...new Set(fn(d.map(norm)).map(norm).filter(p => !PROTECTED.has(p)))].sort())
  refresh($)
}

async function applyOnly($: EngineInterface, keep: string[] | null) {
  const inv = merged(await read($, inventory))
  const all = Object.keys(inv)
  await setDisabled($, () => (keep === null ? [] : all.filter(p => !keep.includes(p))))
}

async function addCommands($: EngineInterface, list: { name: string; plugin?: string }[]) {
  await update($, inventory, inv => {
    const out: Inventory = {}
    for (const [k, v] of Object.entries(inv)) out[k] = { tools: v.tools, commands: [...v.commands] }
    for (const c of list) {
      const p = pluginOfCommand(c.name, c.plugin)
      if (!p) continue
      out[p] ??= { tools: [], commands: [] }
      if (!out[p].commands.includes(c.name)) out[p].commands.push(c.name)
    }
    return out
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pswitch',
      description: 'Plugins anzeigen/umschalten: /pswitch [profil|on <p>|off <p>|vorschlag]',
    })
    try {
      const cmds = await $.command.list()
      await addCommands($, cmds.filter(c => c.source === 'plugin' || c.name.includes(':')))
    } catch {}
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  // Inventory + filtering of tools.
  on('tool.list', async ($, e, next) => {
    const listed = await next(e)
    if (listed.value === undefined) return listed
    const byPlugin: Record<string, string[]> = {}
    for (const t of listed.value) {
      const p = pluginOfTool(t.name, t.registeredBy?.plugin)
      if (p) (byPlugin[p] ??= []).push(t.name)
    }
    await update($, inventory, inv => {
      const out: Inventory = {}
      for (const [k, v] of Object.entries(inv)) out[k] = { tools: [], commands: v.commands }
      for (const [p, tools] of Object.entries(byPlugin)) {
        out[p] = { tools: tools.sort(), commands: out[p]?.commands ?? [] }
      }
      return out
    })
    const off = new Set(await read($, disabled))
    if (off.size === 0) return listed
    return {
      value: listed.value.filter(t => {
        const p = pluginOfTool(t.name, t.registeredBy?.plugin)
        return !p || !off.has(p)
      }),
    }
  })

  // Hide slash commands / skills of disabled plugins from the menu.
  on('command.describe', async ($, e, next) => {
    const p = pluginOfCommand(e.command, e.provider.tier === 'core' ? undefined : e.provider.plugin)
    if (p && !seenCommands.has(e.command)) {
      seenCommands.set(e.command, p)
      void addCommands($, [{ name: e.command, plugin: p }])
    }
    const answer = await next(e)
    if (p && (await read($, disabled)).includes(p)) return { ...answer, isHidden: true }
    if ((await read($, disabledSkills)).includes(skillKey(e.command))) return { ...answer, isHidden: true }
    return answer
  })

  // Drop disabled plugins' skills from the model's skill listing.
  on('prompt.attachment', { type: 'skill_listing' }, async ($, e, next) => {
    const off = await read($, disabled)
    const offSkills = await read($, disabledSkills)
    if ((off.length === 0 && offSkills.length === 0) || typeof (e as any).text !== 'string') return next(e)
    const lines = ((e as any).text as string).split('\n')
    const kept: string[] = []
    let skipping = false
    for (const line of lines) {
      const m = /^- ([a-z0-9@-]+):([^:\s]+):/.exec(line)
      if (line.startsWith('- ')) {
        skipping = !!m && (off.includes(norm(m[1] ?? '')) || offSkills.includes(skillKey(`${m[1]}:${m[2]}`)))
      }
      if (!skipping) kept.push(line)
    }
    return next({ ...e, text: kept.join('\n') } as any)
  })

  // Refuse Skill calls into disabled plugins.
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const skill = String((e as any).skill ?? '')
    const p = pluginOfCommand(skill)
    if (p && (await read($, disabled)).includes(p)) {
      return { deny: `${ME}: Das Plugin "${p}" ist in dieser Session ausgeschaltet (/pswitch on ${p}).` }
    }
    if ((await read($, disabledSkills)).includes(skillKey(skill))) {
      return { deny: `${ME}: Der Skill "${skill}" ist in dieser Session ausgeschaltet.` }
    }
    return next(e)
  })

  // Suggestions from the prompt text.
  on('prompt.submit', async ($, e, next) => {
    if (!e.command && !e.isMeta && e.text.trim().length > 0) {
      const hits = suggest(e.text)
      if (hits.length > 0) {
        const inv = merged(await read($, inventory))
        const off = await read($, disabled)
        const all = Object.keys(inv).filter(p => !PROTECTED.has(p))
        const keep = new Set([...hits, 'anthropic-skills'])
        const wouldOff = all.filter(p => !keep.has(p))
        const changes = wouldOff.some(p => !off.includes(p)) || hits.some(p => off.includes(p))
        await update($, suggestion, () => (changes ? hits : null))
        if (changes) $.ui.toast(`Plugin-Vorschlag: nur ${hits.join(', ')} – /pswitch vorschlag`)
      }
    }
    return next(e)
  })

  on('command.run', { command: 'pswitch' }, async ($, e) => {
    const [verb, ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    const arg = rest.join(' ')
    if (!verb) {
      await $.ui.open({ id: PANE, title: TITLE })
      const off = await read($, disabled)
      return { text: `Panel geöffnet. Aus: ${off.length ? off.join(', ') : 'keine'}. Profile: ${Object.keys(PROFILES).join(', ')}` }
    }
    if (verb === 'on' || verb === 'off') {
      if (!arg) return { text: `Bitte ein Plugin angeben: /pswitch ${verb} <name>` }
      await setDisabled($, d => (verb === 'off' ? [...d, arg] : d.filter(p => p !== arg)))
      await update($, profile, () => 'eigene')
      return { text: `${arg} ist jetzt ${verb === 'on' ? 'an' : 'aus'} (wirkt ab dem nächsten Turn).` }
    }
    if (verb === 'vorschlag' || verb === 'suggest') {
      const s = await read($, suggestion)
      if (!s) return { text: 'Kein offener Vorschlag.' }
      await applyOnly($, [...s, 'anthropic-skills'])
      await update($, suggestion, () => null)
      await update($, profile, () => 'vorschlag')
      return { text: `Vorschlag übernommen: an sind ${s.join(', ')} (+ anthropic-skills).` }
    }
    if (verb in PROFILES) {
      await applyOnly($, PROFILES[verb] ?? null)
      await update($, profile, () => verb)
      return { text: `Profil "${verb}" aktiv.` }
    }
    return { text: `Unbekannt: ${verb}. Nutze: ${Object.keys(PROFILES).join(', ')}, on <p>, off <p>, vorschlag` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const inv = merged(await read($, inventory))
    const off = new Set((await read($, disabled)).map(norm))
    const sug = await read($, suggestion)
    const prof = await read($, profile)
    const offSkills = new Set(await read($, disabledSkills))
    const open = new Set(await read($, expanded))
    const query = (await read($, search)).trim().toLowerCase()
    const names = Object.keys(inv).sort()
    const isApp = e.surface !== 'terminal'

    // A pill-shaped switch: the colored pill itself is the button.
    const sw = (key: string, isOn: boolean, onPress: () => Promise<unknown>) => (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text bold color="inverseText" backgroundColor={isOn ? 'success' : 'error'}>
          {isOn ? '  AN ●' : '● AUS '}
        </Text>
        <Button key={key} label={isOn ? 'Ausschalten' : 'Einschalten'} variant="secondary" onPress={onPress} />
      </Box>
    )

    const switchable = names.filter(p => !PROTECTED.has(p))
    const onCount = switchable.filter(p => !off.has(p)).length
    const skillsOf = (p: string) => [...new Set((inv[p]?.commands ?? []).map(skillKey))].sort()
    const matches = (p: string) => {
      if (!query) return { plugin: true, skills: skillsOf(p) }
      const [title, desc] = LABELS[p] ?? [p, '']
      const hitPlugin = `${p} ${title} ${desc}`.toLowerCase().includes(query)
      const hitSkills = skillsOf(p).filter(k => k.toLowerCase().includes(query))
      return { plugin: hitPlugin, skills: hitPlugin ? skillsOf(p) : hitSkills }
    }
    const visible = switchable.filter(p => {
      const m = matches(p)
      return m.plugin || m.skills.length > 0
    })

    const row = (p: string) => {
      const isOff = off.has(p)
      const [title, desc] = LABELS[p] ?? [p, '']
      const all = skillsOf(p)
      const shown = matches(p).skills
      const skillsOn = isOff ? 0 : all.filter(k => !offSkills.has(k)).length
      const isOpen = open.has(p) || (query.length > 0 && shown.length > 0)
      const toggle = async () => {
        await setDisabled($, d => (isOff ? d.filter(x => norm(x) !== p) : [...d, p]))
        await update($, profile, () => 'eigene')
      }
      return (
        <Box key={`plugin-${p}`} flexDirection="column">
          <Box
            flexDirection="row"
            justifyContent="space-between"
            alignItems="center"
            paddingX={1}
            borderStyle={isApp ? 'round' : undefined}
            borderColor={isOff ? 'error' : 'subtle'}
            backgroundColor={isOff ? 'diffRemovedDimmed' : undefined}
          >
            <Box flexDirection="row" gap={1} flexShrink={1} alignItems="center">
              {all.length > 0 ? (
                <Button
                  key={`expand-${p}`}
                  label={isOpen ? '▾' : '▸'}
                  plain
                  onPress={() => update($, expanded, x => (open.has(p) ? x.filter(y => y !== p) : [...x, p]))}
                />
              ) : (
                <Text> </Text>
              )}
              <Text bold weight="semibold" color={isOff ? 'inactive' : 'text'}>{title}</Text>
              <Text size="caption" color="inactive" wrap="truncate">{desc} · {skillsOn}/{all.length} Skills</Text>
            </Box>
            <Box flexDirection="row" gap={1} alignItems="center">
              
              {sw(`toggle-${p}`, !isOff, toggle)}
            </Box>
          </Box>
          {isOpen && (
            <Box flexDirection="column" marginLeft={3} marginBottom={1}>
              {!query && (
                <Box flexDirection="row" gap={2}>
                  <Button
                    key={`all-on-${p}`}
                    label="Alle an"
                    plain
                    onPress={async () => {
                      await update($, disabledSkills, d => d.filter(k => !all.includes(k)))
                      refresh($)
                    }}
                  >
                    <Text color="success">✓ Alle an</Text>
                  </Button>
                  <Button
                    key={`all-off-${p}`}
                    label="Alle aus"
                    plain
                    onPress={async () => {
                      await update($, disabledSkills, d => [...new Set([...d, ...all])].sort())
                      refresh($)
                    }}
                  >
                    <Text color="error">✕ Alle aus</Text>
                  </Button>
                </Box>
              )}
              {shown.map(k => {
                const own = offSkills.has(k)
                const sOff = isOff || own
                return (
                  <Box key={`skill-${k}`} flexDirection="row" justifyContent="space-between" alignItems="center" paddingX={1}
                    backgroundColor={sOff ? 'diffRemovedDimmed' : undefined}>
                    <Text color={sOff ? 'inactive' : 'text'} wrap="truncate">{shortSkill(k) || k}</Text>
                    {sw(`skill-toggle-${k}`, !own, async () => {
                      await update($, disabledSkills, d => (d.includes(k) ? d.filter(x => x !== k) : [...d, k].sort()))
                      await update($, profile, () => 'eigene')
                      refresh($)
                    })}
                  </Box>
                )
              })}
              {isOff && <Text size="caption" color="error">Plugin ist aus – alle Skills sind inaktiv.</Text>}
            </Box>
          )}
        </Box>
      )
    }

    const tabs = [...Object.keys(PROFILES), ...(prof in PROFILES ? [] : [prof])]

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text size="heading" weight="semibold" bold>Plugins</Text>
          <Text size="caption" color="inactive">
            {onCount} von {switchable.length} aktiv · gilt ab der nächsten Nachricht
          </Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {tabs.map(t => {
            const isActive = t === prof
            return (
              <Button
                key={`tab-${t}`}
                label={PROFILE_LABELS[t] ?? t}
                plain
                onPress={async () => {
                  if (!(t in PROFILES)) return
                  await applyOnly($, PROFILES[t] ?? null)
                  await update($, profile, () => t)
                }}
              >
                <Text bold={isActive} underline={isActive} color={isActive ? 'claude' : 'inactive'}>
                  {PROFILE_LABELS[t] ?? t}
                </Text>
              </Button>
            )
          })}
        </Box>
        <Input
          key="search"
          placeholder="Skills oder Plugins suchen…"
          value={await read($, search)}
          onInput={v => void update($, search, () => v)}
          onSubmit={v => void update($, search, () => v)}
        />
        {sug && (
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" paddingX={1} borderStyle={isApp ? 'round' : undefined} borderColor="warning">
            <Text color="warning" wrap="truncate">
              Vorschlag: nur {sug.map(x => (LABELS[x] ?? [x])[0]).join(', ')}
            </Text>
            <Box flexDirection="row" gap={2}>
              <Button
                key="sug-apply"
                label="Übernehmen"
                plain
                onPress={async () => {
                  await applyOnly($, [...sug, 'anthropic-skills'])
                  await update($, suggestion, () => null)
                  await update($, profile, () => 'vorschlag')
                }}
              >
                <Text bold color="success">✓ Übernehmen</Text>
              </Button>
              <Button key="sug-dismiss" label="Ignorieren" plain onPress={() => update($, suggestion, () => null)}>
                <Text color="inactive">✕</Text>
              </Button>
            </Box>
          </Box>
        )}
        {visible.length === 0 && (
          <Text color="inactive">{query ? 'Keine Treffer.' : 'Noch keine Plugins erkannt.'}</Text>
        )}
        <Box flexDirection="column" gap={0}>
          {visible.map(row)}
        </Box>
      </Box>
    )
  })
}
