// escHtml and debounce come from the DOM Kit (js/neorgon-dom.js). This
// site's showToast is left alone: it creates and removes its own element
// rather than toggling a class, which the kit's contract does not cover.
//
// Do not edit js/neorgon-dom.js. Edit packages/neorgon-ui/dom/ and run
// packages/neorgon-ui/sync-dom.sh.
import { escHtml, debounce } from './neorgon-dom.js';
export { escHtml, debounce };

// ════════════════════════════════════════════════════════════
//  utils.js: small shared helpers
// ════════════════════════════════════════════════════════════

// ── Constants ────────────────────────────────────────────────
/**
 * The type registry: one entry per block type, and the only place a type's
 * meaning is written down. Every palette, picker, legend, exporter heading
 * and criteria label reads it, so adding a type is one entry here plus its
 * CSS colour, instead of the seventeen hand-kept copies it used to take.
 *
 * Key order is the display order (palette, pickers, dropdowns iterate it), and
 * follows the Why, Who, Proof, What, How, Doubt flow in TYPE_STEPS. Ids never
 * change once shipped: a saved canvas stores the id, so renaming one would
 * orphan every block of that type. Labels may change.
 *
 * - color / light: the type colour in the dark and light themes, as the sRGB
 *   hex of the OKLCH value in css/style.css (--c-<id>; DESIGN.md has the
 *   table). Hex because JSON Canvas and Mermaid carry hex, and an import
 *   reads a type back from it (interop.js typeForHex).
 * - shape: the dot's shape, by the step's role: 'ring' for Why and Who (the
 *   ends the work serves), 'square' for What and Proof (what can be checked),
 *   'dot' for How and Other, 'diamond' for Doubt. Types that sit closer than
 *   10 OKLab dE (x100) in either theme never share a shape, so colour is never
 *   the only cue (tests/design-tokens.test.js holds the palette to that).
 * - legacyColors: the hexes this type drew before the 2026-10 palette, dark
 *   then light. A file exported then still imports typed (interop.js), and a
 *   block coloured with one of them keeps its light twin (cards.js).
 * - tier: 'core' shows by default, 'more' behind the expander
 * - step: which TYPE_STEPS question the type answers
 * - short: one line for rows and pickers; tip: the longer tooltip guidance
 * - example: comma-separated quoted examples
 * - legend: the line the AI prompt uses to explain the type
 * - section: the heading an exporter gives a list of these blocks
 * - plural: the short plural for tallies, slides and summaries ("3 Metrics")
 * - criteria: false, or the label of the done-list the type carries
 * - task: whether the Build checklist and tasks.md treat it as a task
 * - actions: the action toggles the inspector shows for the type
 */
export const TYPES = {
  goal: {
    label: 'Goal', color: '#9edaff', light: '#046eb6', shape: 'ring',
    legacyColors: ['#a78bfa', '#7c5fd4'], tier: 'core', step: 'why',
    short: 'What you want to achieve',
    tip: 'An outcome you want to achieve. Connect the Metric that measures it and the Requirements that must be met.',
    example: '"Customers check out without calling support", "Launch the MVP by Q3"',
    legend: 'Strategic objective to achieve',
    section: 'Project Goals', plural: 'Goals',
    criteria: 'Acceptance criteria', task: false, actions: [],
  },
  problem: {
    label: 'Problem', color: '#dd7573', light: '#9a2a20', shape: 'ring',
    legacyColors: ['#f87171', '#d94444'], tier: 'core', step: 'why',
    short: 'An issue happening now',
    tip: 'An issue happening now: a blocker or pain point. Mark "Resolve" once someone is acting on it. Something that only might happen is a Risk.',
    example: '"API latency exceeds SLA", "No CI/CD pipeline"',
    legend: 'Blocker or issue requiring resolution',
    section: 'Problems / Blockers', plural: 'Problems',
    criteria: false, task: false, actions: ['resolve'],
  },
  stakeholder: {
    label: 'Stakeholder', color: '#ffb1c8', light: '#c15681', shape: 'ring',
    legacyColors: ['#fda4af', '#be185d'], tier: 'more', step: 'who',
    short: 'Who receives, approves or is affected',
    tip: 'A person, role or team that receives, approves or is affected by the work. Connect the Outputs delivered to them and the Goals they own.',
    example: '"Executives", "Model owners", "Support team"',
    legend: 'Who receives, approves or is affected by the work',
    section: 'Stakeholders (who this is for)', plural: 'Stakeholders',
    criteria: false, task: false, actions: [],
  },
  metric: {
    label: 'Metric', color: '#57cbd8', light: '#11839f', shape: 'square',
    legacyColors: ['#67e8f9', '#0e7490'], tier: 'core', step: 'proof',
    short: 'A measurable signal with a target',
    tip: 'A measurable signal with a target: a key result, KPI or SLO. Put the target in Targets and connect it to the Goal it measures.',
    example: '"Sprint predictability at or above 80% by Q4", "p95 latency under 200ms"',
    legend: 'A measurable signal with a target; it defines success, do not redefine it',
    section: 'Success Metrics (how we will know)', plural: 'Metrics',
    criteria: 'Targets', task: false, actions: [],
  },
  requirement: {
    label: 'Requirement', color: '#5aae69', light: '#268536', shape: 'square',
    legacyColors: ['#fbbf24', '#c49008'], tier: 'core', step: 'what',
    short: 'Must be true when done',
    tip: 'Something that must be true when the work is done. Say how to check it in Acceptance criteria, and link it to the Goal it serves.',
    example: '"GDPR compliance", "Response under 200ms"',
    legend: 'Must be true when the work is done; its acceptance criteria say how to check',
    section: 'Requirements', plural: 'Requirements',
    criteria: 'Acceptance criteria', task: true, actions: [],
  },
  output: {
    label: 'Output', color: '#d1925a', light: '#935417', shape: 'square',
    legacyColors: ['#818cf8', '#5558cc'], tier: 'more', step: 'what',
    short: 'A deliverable someone can hold: report, doc, release',
    tip: 'A deliverable someone can hold: a report, doc or release. Connect it from the work that produces it and to the Stakeholder who receives it.',
    example: '"API documentation", "Staging environment", "User research report"',
    legend: 'Expected deliverable someone can hold: a report, doc or release',
    section: 'Expected Outputs', plural: 'Outputs',
    // Outputs were Build tasks before the registry existed; kept so the task
    // plan of an existing canvas does not change under it.
    criteria: 'Acceptance criteria', task: true, actions: [],
  },
  implementation: {
    label: 'Implementation', color: '#9ea044', light: '#7a8409', shape: 'dot',
    legacyColors: ['#a3e635', '#4d7c0f'], tier: 'core', step: 'how',
    short: 'Work done once to build or change something',
    tip: 'Work you do once to build or change something: an epic, initiative, integration or task. Connect it to the Requirement it satisfies and the Output it produces.',
    example: '"Build the report scheduler", "Integrate SSO with the identity provider"',
    legend: 'Work to build or change something; check it against the requirement it satisfies',
    section: 'Work Items (implementation)', plural: 'Work items',
    // Optional: an implementation inherits "done" from the requirement it
    // satisfies, so an empty list is not a gap.
    criteria: 'Acceptance criteria', task: true, actions: [],
  },
  process: {
    label: 'Process', color: '#6cb3fd', light: '#5181c7', shape: 'dot',
    legacyColors: ['#60a5fa', '#2563eb'], tier: 'more', step: 'how',
    short: 'A recurring step in a workflow',
    tip: 'A step or action in a workflow: something that gets done each time the flow runs. Chain these with arrows to show an end-to-end flow.',
    example: '"Update status to Ready for Review", "Generate the doc"',
    legend: 'A step or action in a workflow',
    section: 'Workflow Steps', plural: 'Process steps',
    criteria: false, task: false, actions: [],
  },
  terminator: {
    label: 'Trigger / End', color: '#cd7ab2', light: '#933a76', shape: 'dot',
    legacyColors: ['#f0abfc', '#c026a8'], tier: 'more', step: 'how',
    short: 'What starts or ends a flow: an event, a cadence, a finish',
    tip: 'What starts or ends a flow: an event, a cadence or a finish. Bookend a process flow so the beginning and outcome are explicit.',
    example: '"Submission received", "Every end of sprint", "PRD approved"',
    legend: 'What starts or ends a flow: an event, a cadence, or a finish',
    section: 'Workflow Triggers and Ends', plural: 'Triggers and ends',
    criteria: false, task: false, actions: [],
  },
  decision: {
    label: 'Decision', color: '#73dea4', light: '#20683c', shape: 'dot',
    legacyColors: ['#34d399', '#18a872'], tier: 'core', step: 'how',
    short: 'A choice made, or one to make',
    tip: 'A choice made, or one to make. Record why in Rationale, and connect what it rests on.',
    example: '"Use PostgreSQL over MongoDB", "Ship without feature X"',
    legend: 'A choice made, or one to make (rationale should be documented)',
    section: 'Decisions', plural: 'Decisions',
    criteria: false, task: false, actions: [],
  },
  resource: {
    label: 'Resource / System', color: '#1aa7a0', light: '#469177', shape: 'dot',
    legacyColors: ['#2dd4bf', '#14a894'], tier: 'more', step: 'how',
    short: 'An existing team, tool, system or data source',
    tip: 'An available asset: a team, tool, system, data source or budget. Connect it to what it enables.',
    example: '"Design team (3 people)", "AWS credits ($10K)", "Data warehouse"',
    legend: 'An existing team, tool, system or data source',
    section: 'Resources Available', plural: 'Resources and systems',
    criteria: false, task: false, actions: [],
  },
  assumption: {
    label: 'Assumption', color: '#d09aea', light: '#9b54ad', shape: 'diamond',
    legacyColors: ['#eab308', '#b07d06'], tier: 'core', step: 'doubt',
    short: 'A belief you are treating as true',
    tip: 'A belief you are treating as true without validating it. The AI pressure-tests each one. Link it to the Goal or Requirement it underpins.',
    example: '"Users will pay for this", "The API can handle our load"',
    legend: 'A belief being treated as true without validation: pressure-test it',
    section: 'Assumptions (validate before building)', plural: 'Assumptions',
    criteria: false, task: false, actions: ['validate'],
  },
  risk: {
    label: 'Risk', color: '#f89d79', light: '#c85030', shape: 'diamond',
    legacyColors: ['#fb923c', '#d46e14'], tier: 'core', step: 'doubt',
    short: 'Something that might go wrong',
    tip: 'Something that could go wrong and derail the plan. Connect it to a Decision that mitigates it.',
    example: '"Key engineer leaving", "Vendor contract expires"',
    legend: 'Potential failure point requiring mitigation',
    section: 'Risks', plural: 'Risks',
    criteria: false, task: false, actions: ['prepare'],
  },
  question: {
    label: 'Open Question', color: '#2fa5d8', light: '#0a5e89', shape: 'diamond',
    legacyColors: ['#38bdf8', '#1490c8'], tier: 'more', step: 'doubt',
    short: 'A genuine unknown',
    tip: 'A genuine unknown needing an answer. For a belief you are assuming true, use an Assumption instead.',
    example: '"Will users accept SSO-only?", "Is budget approved?"',
    legend: 'A genuine unknown needing an answer',
    section: 'Open Questions (Review Before Assuming)', plural: 'Open questions',
    criteria: false, task: false, actions: [],
  },
  context: {
    label: 'Context', color: '#b7bcc6', light: '#646975', shape: 'dot',
    legacyColors: ['#64748b', '#4b5563'], tier: 'more', step: 'other',
    short: 'Background that frames the work',
    tip: 'Background information that frames the project. Helps the AI understand constraints.',
    example: '"Migrating to cloud", "Competitor launched a similar feature"',
    legend: 'Background information for framing',
    section: 'Context / Background', plural: 'Context',
    criteria: false, task: false, actions: [],
  },
  custom: {
    label: 'Other', color: '#837a73', light: '#50453d', shape: 'dot',
    legacyColors: ['#d8b4fe', '#8b3fc4'], tier: 'more', step: 'other',
    short: 'Untyped: checks skip it',
    tip: 'Anything that fits no other type. Gap checks skip it, so use it sparingly: typed blocks produce better AI prompts.',
    example: '"Parking lot", "Idea for later"',
    legend: 'Untyped: infer its role from its title and connections, and state what you assumed',
    section: 'Custom / Other', plural: 'Other',
    criteria: false, task: false, actions: [],
  },
}

/**
 * The six questions a map answers, in the order worth asking them: Why, Who,
 * Proof, What, How, Doubt. Proof comes before How because every planning
 * method surveyed (OKR, GQM, Theory of Change) sets the measure with the
 * objective and picks the work after. Other holds what supports any step.
 */
export const TYPE_STEPS = [
  { id: 'why',   label: 'Why',   hint: 'what outcome, or what hurts' },
  { id: 'who',   label: 'Who',   hint: 'who wants it, receives it, or signs it off' },
  { id: 'proof', label: 'Proof', hint: 'how we will know it worked' },
  { id: 'what',  label: 'What',  hint: 'what must be true or delivered' },
  { id: 'how',   label: 'How',   hint: 'the work, steps and systems' },
  { id: 'doubt', label: 'Doubt', hint: 'imagine it failed: why?' },
  { id: 'other', label: 'Other', hint: 'background, or not typed yet' },
]

/** Lines the type picker shows under the list, for the pairs people confuse. */
export const TYPE_DISAMBIGUATION = [
  'Every time the flow runs is a Process; once, to build or change something, is an Implementation.',
  'A moment in time is a Trigger / End; a thing someone can hold is an Output.',
  'A number with a target is a Metric.',
]

/**
 * Types grouped by step, in TYPE_STEPS order, each group in registry order:
 * [{ step: 'why', label: 'Why', hint, types: ['goal', 'problem'] }, ...].
 * A type whose step is unknown lands in Other rather than disappearing.
 */
export function typesByStep() {
  const known = new Set(TYPE_STEPS.map(s => s.id))
  return TYPE_STEPS.map(s => ({
    step: s.id, label: s.label, hint: s.hint,
    types: Object.keys(TYPES).filter(t => (known.has(TYPES[t].step) ? TYPES[t].step : 'other') === s.id),
  }))
}

/**
 * The questions on a block that ask something. The inspector's + and the
 * context menu's Add question start with a blank one to type into; until it
 * has text, no export prints it (a bare bullet reads as a lost question).
 */
export const askedQuestions = b => (b?.questions || []).filter(q => typeof q?.text === 'string' && q.text.trim())

/**
 * A type's registry entry, or a neutral stand-in named after the id when this
 * build does not know it (a hand-written canvas, a patch from newer code).
 * Exporters read through this, so a heading can never print as "undefined".
 */
export function typeInfo(type) {
  if (Object.hasOwn(TYPES, type)) return TYPES[type]
  const name = String(type || TYPES.custom.label)
  return { ...TYPES.custom, label: name, plural: name, section: name }
}

// Labels a type used to carry. Ids never change, but hand-written and
// AI-written canvases often put the label a person saw in `type`, including
// labels this build has since renamed.
const RETIRED_TYPE_LABELS = {
  'start / end': 'terminator',
  'custom / other': 'custom',
}

const typeKey = s => String(s).trim().toLowerCase()
  .replace(/[_-]+/g, ' ').replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ')

let typeLookup = null

/**
 * The type id a written `type` value means, or '' when it names no type this
 * build knows. Accepts the id itself, the id or label in any case ("Goal",
 * "open-question", "Trigger / End"), and retired labels ("Start / End").
 * Anything else stays unknown, so normalize can keep it as Other with the
 * original in `typeHint` rather than guess.
 */
export function resolveTypeId(value) {
  if (typeof value !== 'string') return ''
  if (Object.hasOwn(TYPES, value)) return value
  if (!typeLookup) {
    typeLookup = new Map(Object.entries(RETIRED_TYPE_LABELS))
    Object.entries(TYPES).forEach(([id, t]) => {
      typeLookup.set(typeKey(id), id)
      typeLookup.set(typeKey(t.label), id)
    })
  }
  return typeLookup.get(typeKey(value)) || ''
}

// Card presets. `bar` is the original 3px left stripe, kept so canvases built
// in it can stay that way; `outline` is the default now.
export const CARD_STYLES = {
  outline: { label: 'Outline', hint: 'Accent border on all four sides' },
  bar:     { label: 'Accent bar', hint: 'Colour stripe down the left edge' },
  header:  { label: 'Header', hint: 'Colour fills the title strip' },
  tint:    { label: 'Tinted', hint: 'Accent wash across the card' },
  plain:   { label: 'Plain', hint: 'Neutral edge, colour in the badge only' },
}
export const DEFAULT_CARD_STYLE = 'outline'
export const BORDER_WIDTHS = [1, 1.5, 2, 3]

/**
 * Where the tool is standing when the canvas gets handed over.
 *
 * A canvas is a plan, and a plan read without its situation gets acted on
 * wrongly: an assistant with the repository open should go read it, one in a
 * chat window should not pretend it has. Each option owns the sentence it
 * contributes to the prompt, so the copy lives next to the choice rather than
 * being assembled somewhere else.
 */
/**
 * Presentation highlights.
 *
 * Not semantics: a highlight says "look here", nothing more. The block types
 * already carry meaning, and overloading colour with a second meaning is how a
 * diagram stops being readable. This is for the moment you share a canvas and
 * need five of its thirty boxes to be the ones people actually look at.
 */
export const HIGHLIGHTS = {
  // Motion is off by default (View > Animate highlights), so the hints say
  // what is drawn at rest and when it moves.
  // color and light are the --hl-* tokens (style.css) as sRGB hex, for the
  // image export, which carries no stylesheet. The page itself paints them
  // from the tokens, so the theme picks the twin.
  alert:   { label: 'Alert',   color: '#e58f97', light: '#a74c58', hint: 'Red ring. The thing you want looked at first (pulses on hover with Animate highlights on).' },
  focus:   { label: 'Focus',   color: '#64cbfe', light: '#0675c9', hint: 'Steady blue ring. "This is what we are discussing."' },
  go:      { label: 'Go',      color: '#89dd76', light: '#258101', hint: 'Green. Settled, agreed, or done.' },
  // Grey, not amber: amber on a card means a gap (--attention) and nothing else.
  hold:    { label: 'Hold',    color: '#819ba0', light: '#3f5d5c', hint: 'Grey. Blocked, or waiting on somebody.' },
  festive: { label: 'Festive', color: '#fb9ef1', light: '#a43897', hint: 'A candy-cane border, impossible to ignore (moves on hover with Animate highlights on).' },
}

export const SITUATION_FIELDS = {
  codebase: {
    label: 'Codebase',
    hint: 'what code exists, and whether you can see it',
    options: {
      none: { label: 'None yet',
        line: 'There is no codebase yet. Nothing in this canvas can be checked against source, so treat every technical claim in it as unverified.' },
      current: { label: 'This repo',
        line: 'The relevant repository is open to you. Read it before trusting this canvas: the canvas records what somebody believed, the repository is what is actually there. Where the two disagree, the repository wins and the disagreement is worth reporting.' },
      other: { label: 'Elsewhere',
        line: 'The code exists but you do not have it open. Ask for access rather than reasoning about contents you cannot see.' },
      greenfield: { label: 'Greenfield',
        line: 'This is greenfield work. There is no existing implementation to respect or work around.' },
    },
  },
  runtime: {
    label: 'Running in',
    hint: 'what the assistant can actually reach',
    options: {
      chat: { label: 'Chat',
        line: 'You are in a chat window with no file or shell access. Do not assert anything about code you have not been shown.' },
      code: { label: 'Claude Code',
        line: 'You are running in Claude Code with file and shell access. Prefer reading the repository over asking about it, and cite file paths for any claim you make about the code.' },
      ide: { label: 'IDE',
        line: 'You are an assistant inside an editor with the project open. Ground your answers in the files you can actually read.' },
    },
  },
  firstMove: {
    label: 'Start by',
    hint: 'the first thing to do, before anything else',
    options: {
      read: { label: 'Reading the code',
        line: 'Start by reading the code. Reconcile it against this canvas and report what does not match before proposing anything.' },
      ask: { label: 'Asking questions',
        line: 'Start by asking. Return your questions and stop; do not analyse or build until they are answered.' },
      plan: { label: 'Proposing a plan',
        line: 'Start by proposing a plan and waiting for a yes before acting on it.' },
      act: { label: 'Getting to work',
        line: 'Start work directly. Ask only where this canvas is genuinely ambiguous.' },
    },
  },
}

export const SITUATION_DEFAULT = {
  codebase: 'none',
  runtime: 'chat',
  firstMove: 'plan',
  repoHint: '',
  constraints: '',
}

export const STORAGE_KEY    = 'pathfinder-v1'

// Prompt options: the mode plus the dev options. Part of the canvas
// (meta.prompt) since 2026-08-24, so a share, an import or a Maps switch
// carries how the plan is meant to be read, not just what it says.
export const PROMPT_MODES   = ['plan', 'investigate', 'explore', 'build', 'clarify']
export const PROMPT_TONES   = ['auto', 'formal', 'casual', 'technical']
export const PROMPT_DETAILS = ['standard', 'brief', 'detailed']
export const PRE_PROMPTS    = ['tasks', 'edge', 'errors', 'docs', 'security', 'typescript']
export const PROMPT_OPTS_DEFAULT = { mode: 'plan', tone: 'auto', detail: 'standard', pre: [] }
export const DEFAULT_WIDTH  = 220
// A new connection's stroke. Saved ones without a weight keep drawing at 2
// (arrow-geometry.js arrowWeight), so an old map does not change.
export const DEFAULT_ARROW_WEIGHT = 1.5
export const MIN_ZOOM       = 0.18
export const MAX_ZOOM       = 2.6

export const ACTION_DEFS = {
  resolve:   'Take action to fix or close this item',
  prepare:   'Gather resources or context before proceeding',
  recollect: 'Review past decisions or context relevant here',
  reinforce: 'Strengthen or validate the current approach',
  validate:  'Test or confirm this before relying on it',
}

// The word each action shows on a card chip and an inspector toggle: plain
// verbs, one name everywhere. The ids stay as they are (saved maps and the
// prompt's tags carry them); only the words a person reads changed.
export const ACTION_LABELS = {
  resolve: 'Resolve', prepare: 'Prepare', validate: 'Validate',
  recollect: 'Look back', reinforce: 'Strengthen',
}

export const STATUS_DEFS = {
  'not-started': { label: 'Not started', icon: '\u25CB' },
  'in-progress': { label: 'In progress', icon: '\u25D4' },
  'done':        { label: 'Done',        icon: '\u25CF' },
  'blocked':     { label: 'Blocked',     icon: '\u25A0' },
}

// Priority is a level, drawn as signal bars (cards.js chipIcon), never as a
// colour: red and amber already mean a type and a gap.
export const PRIORITY_DEFS = {
  high:   { label: 'High',   bars: 3 },
  medium: { label: 'Medium', bars: 2 },
  low:    { label: 'Low',    bars: 1 },
}

export const ARROW_LABEL_PRESETS = [
  'depends on', 'blocks', 'enables', 'mitigates',
  'validates', 'conflicts with', 'informs', 'requires',
]

// A block's or a connection's own colour, chosen by a person. None of these is
// a type colour (current or legacy), so a recoloured card never reads back as
// another type from a JSON Canvas (interop.js), and none sits on the accent
// violet or the attention amber. Mid lightness (OKLCH L 0.62), so each holds
// 4.5:1 on the dark canvas and 3:1 as a line on the light one; on a light
// card the dot and edge take the darker twin in cards.js SWATCH_LIGHT.
export const SWATCH_COLORS = [
  '#da534f', '#cc6526', '#699630', '#269e5f',
  '#0e9a94', '#1794b5', '#3986e4', '#ad63c4',
  '#cd509f', '#d36085', '#78889b', '#9d846d',
]
export const SWATCH_NAMES = {
  '#da534f': 'Red', '#cc6526': 'Orange', '#699630': 'Lime', '#269e5f': 'Green',
  '#0e9a94': 'Teal', '#1794b5': 'Cyan', '#3986e4': 'Blue', '#ad63c4': 'Purple',
  '#cd509f': 'Magenta', '#d36085': 'Pink', '#78889b': 'Slate', '#9d846d': 'Sand',
  // The swatches before 2026-10, so a colour picked then keeps its name.
  '#a78bfa': 'Violet', '#f87171': 'Red', '#fbbf24': 'Amber', '#fb923c': 'Orange',
  '#38bdf8': 'Sky', '#34d399': 'Emerald', '#2dd4bf': 'Teal', '#818cf8': 'Indigo',
  '#f472b6': 'Pink', '#c084fc': 'Purple', '#94a3b8': 'Slate', '#ffffff': 'White',
}

// ── ID generator ─────────────────────────────────────────────
let _sid = 0
export function genId() { return (Date.now().toString(36) + (++_sid).toString(36)) }

// ── Pure helpers ─────────────────────────────────────────────
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }


// Escape for HTML, then turn newlines into <br> so multi-line descriptions
// keep their structure on the block card. Pair with `white-space: pre-wrap`
// in CSS so runs of spaces survive too.
export function escHtmlMultiline(s) {
  return escHtml(s).replace(/\r\n|\r|\n/g, '<br>')
}


// ── Clipboard helper ─────────────────────────────────────────
// navigator.clipboard.writeText rejects silently when the page isn't focused
// or over insecure origins. Fall back to a hidden textarea + execCommand so the
// copy still lands. Resolves to true/false so callers can surface the outcome.
export function copyText(text) {
  const fallback = () => {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
      document.body.appendChild(ta)
      ta.focus(); ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch (_) { return false }
  }
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true, () => fallback())
  }
  return Promise.resolve(fallback())
}

// ── DOM element cache ────────────────────────────────────────
export const $ = {
  canvasViewport:   () => document.getElementById('canvasViewport'),
  canvasRoot:       () => document.getElementById('canvasRoot'),
  arrowsGroup:      () => document.getElementById('arrowsGroup'),
  arrowsLayer:      () => document.getElementById('arrowsLayer'),
  arrowPreview:     () => document.getElementById('arrowPreview'),
  canvasHint:       () => document.getElementById('canvasHint'),
  inspectorEmpty:   () => document.getElementById('inspectorEmpty'),
  inspectorContent: () => document.getElementById('inspectorContent'),
  inspTitle:        () => document.getElementById('inspTitle'),
  inspDesc:         () => document.getElementById('inspDesc'),
  inspNotes:        () => document.getElementById('inspNotes'),
  inspCriteria:     () => document.getElementById('inspCriteria'),
  inspRationale:    () => document.getElementById('inspRationale'),
  questionsList:    () => document.getElementById('questionsList'),
  promptOutput:     () => document.getElementById('promptOutput'),
  promptSummary:    () => document.getElementById('promptSummary'),
  inspectorMulti:   () => document.getElementById('inspectorMulti'),
  inspectorArrow:   () => document.getElementById('inspectorArrow'),
  selectBox:        () => document.getElementById('selectBox'),
  searchOverlay:    () => document.getElementById('searchOverlay'),
  searchInput:      () => document.getElementById('searchInput'),
  searchResults:    () => document.getElementById('searchResults'),
  zoomIndicator:    () => document.getElementById('zoomIndicator'),
  canvasTitle:      () => document.getElementById('canvasTitle'),
  shortcutOverlay:  () => document.getElementById('shortcutOverlay'),
  shortcutGrid:     () => document.getElementById('shortcutGrid'),
  framesLayer:      () => document.getElementById('framesLayer'),
  frameLabelInput:  () => document.getElementById('frameLabelInput'),
  templatesList:    () => document.getElementById('templatesList'),
}

// ── Block element helpers ────────────────────────────────────
export function getBlockEl(id)   { return document.getElementById('b-' + id) }
export function getBlockDims(id) {
  const el = getBlockEl(id)
  return el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: DEFAULT_WIDTH, h: 100 }
}

// ── Voting system (client-side, URL-hash based) ────────────
const VOTE_HASH_KEY = 'votes'
const MY_VOTES_KEY = 'my-votes'
const MAX_DOTS_PER_USER = 5

// ── SVG Icons ────────────────────────────────────────────────
export const SVG_ICONS = {
  vote: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 2v2h2.41l3.3 8.36-1.23 2.25c-.16.33-.25.71-.25 1.11 0 1.21.98 2.19 2.19 2.19h7.5v-2h-7.5c-.41 0-.75-.34-.75-.75 0-.13.03-.25.09-.36l1.23-2.25L16.5 6.5h5.25v12h2V4.5c0-.83-.67-1.5-1.5-1.5H7zm9 18c0 .55-.45 1-1 1h-2v-2h2c.55 0 1 .45 1 1zm-7-4c0 .55-.45 1-1 1H6v-2h2c.55 0 1 .45 1 1z"/></svg>`,
  timer: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 1H9v2h6V1zm-4 12h2V7h-2v6zm8-5h1v12c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V7h1V5c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2v2z"/></svg>`,
  decision: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>`,
  action: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>`,
  question: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm3.9 13.5-4.6-2.7c-.2-.2-.3-.5-.3-.8V7h2v3.9l4 2.4-1.1 2.2z"/></svg>`,
  users: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45v2h6v-2c0-2.66-5.33-4-8-4z"/></svg>`,
  priority: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L5.49 17.5 3.5 15.5z"/></svg>`,
  warning: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/></svg>`,
  flag: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"/></svg>`,
  link: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>`,
  people: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`,
  bullet: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg>`,
  number: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 17H7v-2h7v2zm0-4H7v-2h7v2zm0-4H7V7h7v2zm4 8h-2V7h-2V5h4v12z"/></svg>`,
  archive: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z"/></svg>`,
  paperclip: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 4.5H8.49c-1.65 0-3.18.82-4.1 2.18C3.48 8.13 3 9.61 3 11.14c0 2.6 1.4 4.85 3.51 6.29 1.66 1.16 3.67 1.85 5.82 1.85h8.95c2.94 0 5.33-2.39 5.33-5.33 0-2.94-2.39-5.33-5.33-5.33h-7.5c-1.17 0-2.12-.95-2.12-2.12s.95-2.12 2.12-2.12h7.5c5.25 0 9.5 4.25 9.5 9.5s-4.25 9.5-9.5 9.5H12.02c-3.52 0-6.77-1.52-9.02-3.95C1.8 18.85.5 16.5.5 14.04c0-3.4 1.2-6.5 3.18-8.52C5.66 3.01 8.75 1.5 12.02 1.5h7.5c1.38 0 2.5 1.12 2.5 2.5s-1.12 2.5-2.5 2.5h-7.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5h7.5c2.75 0 5 2.25 5 5s-2.25 5-5 5H11.52c-1.47 0-2.88-.55-3.92-1.49-1.03-.94-1.6-2.22-1.6-3.61 0-2.76 2.24-5 5-5h8Z"/></svg>`,
  list: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 17.27-5.76 3.34 1.56-6.63L3.5 10.49l6.88-.59L12 4.2l1.62 5.7 6.88.59-3.3 3.49 1.56 6.63L12 17.27z"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3.75-1.45-1.32C8.23 1.68 5.5 2.94 5.5 6.06c0 1.94.99 3.12 2.22 4.23 1.02.93 5.54 4.79 4.28 6.39C12.06 17.4 15 15.55 15 12c0-1.76-.86-2.95-1.82-4.03C12.09 6.68 13 5.38 13 4.5c0-1.21-.8-1.72-1.55-1.5-.47.13-.94.6-1.01.95H10.5c-.07-.35-.54-.82-1.01-.95-.75-.22-1.55.29-1.55 1.5 0 .88.91 2.18 1.82 3.47C9.86 9.05 9 10.24 9 12c0 3.55 2.94 5.4 4.5 4.51-1.26-1.6 3.26-5.46 4.28-6.39C17.01 9.18 18 8 18 6.06c0-3.12-2.73-4.38-5.05-1.63L12 3.75z"/></svg>`,
  fire: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 5.5S14 7 14 8.5 13.5 11 12.5 12s-2 1-2 3 1 3 3 3 3-1 3-3c0-1.63-1.13-2.66-2.04-3.91C14.44 7.72 13.5 5.5 13.5 5.5zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.84 0 3.56-.5 5.03-1.36C14.54 23.5 11.82 23 12 23c5.52 0 10-4.48 10-10S17.52 2 12 2z"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="m11 21-1-7H4l6-9h1l1 7h6l-6 9z"/></svg>`,
  target: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"/></svg>`,
  robot: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 2H9c-1.1 0-2 .9-2 2v2H3c-.55 0-1 .45-1 1s.45 1 1 1h4v6H3c-.55 0-1 .45-1 1s.45 1 1 1h4v4c0 1.1.9 2 2 2h2v1c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-1h2c1.1 0 2-.9 2-2v-4h4c.55 0 1-.45 1-1s-.45-1-1-1h-4V8h4c.55 0 1-.45 1-1s-.45-1-1-1h-4V4c0-1.1-.9-2-2-2h-2V1h-2v1h-2zM9 20v-4h6v4H9zm8-18h2v2h-2V2zM9 6h2v2H9V6z"/></svg>`,
  alien: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.94-.49-7-3.85-7-7.93 0-.84.13-1.65.35-2.42L6.3 9.3l3.18 1.94.58-3.22 3.23.58 1.95-3.17 1.42 1.42c.55.86.91 1.86.91 2.93 0 2.08-1.03 3.92-2.61 5.05L11 19.93z"/></svg>`,
  cake: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 6c1.11 0 2-.89 2-2 0-.8-.47-1.48-1.15-1.81C12.2 1.85 12.38 1.5 12.38 1.5s.16-.35.53-.69C13.59.48 14.31 0 15.11 0c1.11 0 2 .89 2 2 0 .26-.05.51-.14.75.25.16.39.39.39.64 0 1.11-.89 2-2 2C15.67 5 15 5.67 15 6.5c0 .26.05.51.14.75-.25.16-.39.39-.39.64 0 1.11.89 2 2 2 .8 0 1.48-.47 1.81-1.15C19.15 8.8 19.5 8.98 19.5 8.98s.35.16.69.53c.35.35.53.69.53.69s.18-.35.53-.69c.34-.37.69-.53.69-.53s.35.18.69.53c.35.35.53.69.53.69s.18-.35.53-.69c.34-.37.69-.53.69-.53s.35.18.69.53c.35.35.53.69.53.69s.18-.35.53-.69c.34-.37.69-.53.69-.53M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 10c-3.87 0-9.72-.94-11-4.5C2.28 9.94 8.13 9 12 9s9.72.94 11 4.5c-1.28 3.56-7.13 4.5-11 4.5z"/></svg>`,
  pizza: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>`,
  resource: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>`,
  coffee: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 3H4v12c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-1h1c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 6h-1V8c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v7c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-1h1v3z"/></svg>`,
  beer: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6h-2V4c0-1.1-.9-2-2-2H7c-1.1 0-2 .9-2 2v2H3c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-7 0H8V4h4v2zM3 8h16v2l-1.5 9.5L15 14H3V8zm4 4h6v2H7v-2z"/></svg>`,
}

// Get SVG icon by key
export function getSvgIcon(key, className = '', size = 16) {
  const svg = SVG_ICONS[key]
  if (!svg) return `<span style="display:none"></span>`
  return `<span class="svg-icon ${className}" style="width:${size}px;height:${size}px;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;">${svg}</span>`
}

// Small inline SVG for decoration
export function getSmallIcon(key) {
  return getSvgIcon(key, '', 14)
}

// Medium inline SVG for headers
export function getMediumIcon(key) {
  return getSvgIcon(key, '', 18)
}

// Large SVG for prominent display
export function getLargeIcon(key) {
  return getSvgIcon(key, '', 24)
}

// The URL hash is '&'-separated segments ('s=...', 'votes=...'). Split it
// without its leading '#': left on, the first segment read '#votes=...',
// matched no 'votes=' test, and every save appended a second votes segment
// while every read kept parsing the stale first one.
function hashSegments() {
  return location.hash.replace(/^#/, '').split('&').filter(Boolean)
}

// Get current URL hash and parse votes
export function getBlockVotes(blockId) {
  return getAllVotes()[blockId] || []
}

// Get all votes for all blocks
export function getAllVotes() {
  const seg = hashSegments().find(part => part.startsWith(VOTE_HASH_KEY + '='))
  if (!seg) return {}
  try {
    const all = JSON.parse(decodeURIComponent(seg.slice(VOTE_HASH_KEY.length + 1)))
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {}
  } catch (e) {
    return {}
  }
}

function writeHash(segments) {
  const baseUrl = location.pathname + location.search
  history.replaceState(null, '', baseUrl + (segments.length ? '#' + segments.join('&') : ''))
}

// Set votes for a block (updates URL hash)
export function setBlockVotes(blockId, votes) {
  const allVotes = getAllVotes()
  if (votes.length === 0) {
    delete allVotes[blockId]
  } else {
    allVotes[blockId] = votes
  }

  const voteStr = encodeURIComponent(JSON.stringify(allVotes))
  // Every other segment stays as it was; exactly one votes segment, last.
  const rest = hashSegments().filter(part => !part.startsWith(VOTE_HASH_KEY + '='))
  writeHash(Object.keys(allVotes).length > 0 ? [...rest, VOTE_HASH_KEY + '=' + voteStr] : rest)
}

// Add votes from current user to a block
export function addVotesToBlock(blockId, dots = 1) {
  const myUserId = getOrCreateUserId()
  const existing = getBlockVotes(blockId)
  const myExisting = existing.find(v => v.userId === myUserId)

  // Check if user has dots remaining
  const myTotalUsed = Object.values(getAllVotes()).reduce((sum, votes) => {
    const mine = votes.find(v => v.userId === myUserId)
    return sum + (mine ? mine.dots : 0)
  }, 0)

  if (myTotalUsed + dots > MAX_DOTS_PER_USER) {
    const remaining = MAX_DOTS_PER_USER - myTotalUsed
    showToast(`You only have ${remaining} dots remaining`, 'warning')
    return false
  }

  if (myExisting) {
    myExisting.dots += dots
  } else {
    existing.push({ userId: myUserId, dots, timestamp: Date.now() })
  }

  setBlockVotes(blockId, existing)
  return true
}

// Remove votes from current user for a block
export function removeVotesFromBlock(blockId, dots = 1) {
  const myUserId = getOrCreateUserId()
  const existing = getBlockVotes(blockId)
  const myVote = existing.find(v => v.userId === myUserId)

  if (!myVote) return false

  myVote.dots = Math.max(0, myVote.dots - dots)

  // Remove if zero dots
  const updated = existing.filter(v => v.dots > 0)
  setBlockVotes(blockId, updated)
  return true
}

// Clear all votes (useful for voting phase reset)
export function clearAllVotes() {
  writeHash(hashSegments().filter(part => !part.startsWith(VOTE_HASH_KEY + '=')))
  return true
}

// Get or create user ID for voting (stored in localStorage)
function getOrCreateUserId() {
  try {
    let user = JSON.parse(localStorage.getItem('pathfinder-user') || '{}')
    if (!user.userId) {
      user = { userId: 'user-' + Math.random().toString(36).slice(2, 11), createdAt: Date.now() }
      localStorage.setItem('pathfinder-user', JSON.stringify(user))
    }
    return user.userId
  } catch (e) {
    return 'anonymous-' + Math.random().toString(36).slice(2, 11)
  }
}

// Toasts land over the canvas, centred just above its status bar. In the
// page corner they covered the inspector's tabs and Type row, and an open
// header menu hid them. Without a canvas on screen (the other pages, or a
// window too narrow to have one) the stylesheet places them as before.
export function placeToast(toast) {
  const bar = document.querySelector('.canvas-statusbar')
  const vp = document.querySelector('.canvas-viewport')
  const ref = bar && bar.getClientRects().length ? bar : vp
  if (!ref || !ref.getClientRects().length) return false
  const r = ref.getBoundingClientRect()
  if (r.width < 240 || r.height <= 0) return false
  const floor = ref === bar ? r.top : r.bottom
  toast.classList.add('toast-in-canvas')
  Object.assign(toast.style, { position: 'fixed', top: 'auto', right: 'auto',
    maxWidth: Math.min(420, r.width - 32) + 'px' })
  const w = toast.getBoundingClientRect().width
  toast.style.left = Math.round(r.left + (r.width - w) / 2) + 'px'
  toast.style.bottom = Math.round(window.innerHeight - floor + 12) + 'px'
  return true
}

// Toast notification + screen-reader announcement.
//
// A toast is a neutral surface with the message in the primary ink; the
// status speaks through a stroked 16px icon in its status colour (DESIGN.md
// Toasts). Coloured text made a long message hard to read and gave the
// status colours a second job. The icon is decorative: the words say it.
const TOAST_ICONS = {
  success: '<path d="M3.75 8.5l2.75 2.75 5.75-6.5"/>',
  info:    '<circle cx="8" cy="8" r="5.75"/><path d="M8 7.25v3.5"/><path d="M8 5.25v.01"/>',
  warning: '<path d="M8 2.75l5.75 10H2.25z"/><path d="M8 6.75v2.75"/><path d="M8 11.5v.01"/>',
  error:   '<circle cx="8" cy="8" r="5.75"/><path d="M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2"/>',
}
export function toastIcon(type) {
  return '<svg class="toast-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (TOAST_ICONS[type] || TOAST_ICONS.info) + '</svg>'
}

let toastTimeout
export function showToast(message, type = 'info', duration = 3000) {
  const existing = document.querySelector('.toast-notification')
  if (existing) existing.remove()

  const kind = Object.hasOwn(TOAST_ICONS, type) ? type : 'info'
  const toast = document.createElement('div')
  toast.className = `toast-notification toast-${kind}`
  // Announced by screen readers. Without these the toast is
  // invisible to anyone not looking at that corner of the screen.
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = toastIcon(kind) + '<span class="toast-msg"></span>'
  toast.lastElementChild.textContent = message
  document.body.appendChild(toast)
  placeToast(toast)

  const live = document.getElementById('toastLive')
  if (live) live.textContent = message

  if (toastTimeout) clearTimeout(toastTimeout)
  toastTimeout = setTimeout(() => {
    toast.classList.add('toast-exiting')
    setTimeout(() => toast.remove(), 300)
  }, duration)
}

