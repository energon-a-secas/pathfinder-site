// ════════════════════════════════════════════════════════════
//  classify.js: text to typed blocks. The brain dump's syntax
//  (PREFIXES, headings, "- " criteria), the line classifier, the
//  outline parser, the dump itself (step columns, a free space,
//  a readable arrival), the paste handler and the type check that
//  follows a guess (a button on the card's type label); the start
//  panel's notes field is wired in start-panel.js. Only a prefix, a
//  heading or a trailing "?" is certain.
// ════════════════════════════════════════════════════════════

import { state, ui, selection, snapshot, debouncedSave, toWorld } from './state.js'
import { $, genId, getBlockEl, showToast, TYPES, DEFAULT_WIDTH } from './utils.js'
import { renderArrows, updateHint } from './canvas.js'
import { renderAllBlocks, mutateBlocks, renderInspector } from './render.js'
import { runGapDetection } from './gaps.js'
import { openDropdown, isMenuOpen } from './menu.js'
import { modalDialogOpen } from './navigation.js'
import { typeMenuItems, retypeBlocks } from './type-menu.js'
import { layoutByStep, STEP_LAYOUT } from './layout.js'
import { blockSize, nearestFreeSpot, occupiedRects } from './create.js'
import { arriveAt, fitKeyName, ARRIVAL_ZOOM, ARRIVAL_PAD } from './zoom-controls.js'

// ── Prefixes: the brain dump's own syntax ────────────────────
//
// A line that starts with one of the `sure` words and a colon ("goal:",
// "risk:") gets that type outright, and so does a line that ends with "?"
// (an Open Question). A line made of nothing but a type word ("Risks:",
// "## Open questions") is a heading: every line in its list gets that type.
// Nothing else is certain. The other `keys` are words notes use for many
// things ("Done:", "Task:", "Target:", "Should:"), so a line led by one of
// them takes that type as a guess, keeps the word in its title, and asks
// for a check; a trailing "?" wins over one of them. A line with no prefix
// at all is typed by the scoring below and asks for a check too, because a
// confident wrong type is the one nobody questions.
//
// `show` is what the start panel teaches, short form first; `sure` is
// `show` plus the type's own full spelling; `keys` are every spelling
// read, sure ones included; `example` is a line the panel can show. In
// step order (Why, Who, Proof, What, How, Doubt, Other), so a list rendered
// from this reads the way the map is built. Every type but Other has one.
export const PREFIXES = [
  { type: 'goal',           show: ['goal'],               sure: ['goal'],
    keys: ['goal', 'objective', 'aim', 'vision'],
    example: 'Cut onboarding drop-off before the Q3 review' },
  { type: 'problem',        show: ['problem'],            sure: ['problem'],
    keys: ['problem', 'issue', 'blocker', 'bug', 'pain', 'challenge'],
    example: 'New users stall at workspace setup' },
  { type: 'stakeholder',    show: ['who', 'stakeholder'], sure: ['who', 'stakeholder'],
    keys: ['who', 'stakeholder', 'audience', 'sponsor'],
    example: 'Workspace admins' },
  // "Target:" heads a number more often than an aim: a number with a target
  // is a Metric (TYPE_DISAMBIGUATION).
  { type: 'metric',         show: ['metric'],             sure: ['metric'],
    keys: ['metric', 'kpi', 'okr', 'kr', 'key result', 'measure', 'target'],
    example: 'Activation within 7 days' },
  { type: 'requirement',    show: ['req', 'requirement'], sure: ['req', 'requirement'],
    keys: ['req', 'requirement', 'need', 'must', 'should', 'shall'],
    example: 'Setup can be finished in one sitting' },
  { type: 'output',         show: ['output'],             sure: ['output'],
    keys: ['output', 'deliverable', 'result', 'outcome'],
    example: 'A setup checklist in the product' },
  // A task is done once, to build or change something: an Implementation,
  // not a step every run of a flow repeats.
  { type: 'implementation', show: ['build', 'impl'],      sure: ['build', 'impl', 'implementation'],
    keys: ['build', 'impl', 'implementation', 'implement', 'work item', 'work', 'epic', 'initiative', 'task', 'do'],
    example: 'Add a guided setup checklist' },
  // "Action:" stays a step: a workflow written out names each step that way.
  { type: 'process',        show: ['step'],               sure: ['step', 'process'],
    keys: ['step', 'process', 'action'],
    example: 'Send the invite reminder' },
  { type: 'terminator',     show: ['trigger'],            sure: ['trigger'],
    keys: ['trigger', 'start', 'begin', 'end', 'finish', 'done'],
    example: 'A new workspace is created' },
  { type: 'decision',       show: ['decision'],           sure: ['decision'],
    keys: ['decision', 'decided', 'chose', 'choice'],
    example: 'Show the checklist to new workspaces only' },
  { type: 'resource',       show: ['resource'],           sure: ['resource'],
    keys: ['resource', 'system', 'team', 'tool', 'asset', 'budget'],
    example: 'The onboarding email service' },
  { type: 'assumption',     show: ['assume'],             sure: ['assume', 'assumption'],
    keys: ['assume', 'assumption', 'belief', 'hypothesis'],
    example: 'Admins skip the invite step' },
  { type: 'risk',           show: ['risk'],               sure: ['risk'],
    keys: ['risk', 'concern', 'danger', 'threat'],
    example: 'A setup checklist slows experienced admins' },
  { type: 'question',       show: ['question'],           sure: ['question', 'open question', 'q'],
    keys: ['question', 'open question', 'q'],
    example: 'What counts as activated?' },
  { type: 'context',        show: ['context'],            sure: ['context'],
    keys: ['context', 'background', 'note', 'info', 'status'],
    example: 'Activation dipped after the pricing change' },
]

/** The criteria a dumped line's "- " children become, by type (Targets on a metric). */
export const CRITERIA_FROM_BULLETS = new Set(['requirement', 'metric'])

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
const longestFirst = words => [...words].sort((a, b) => b.length - a.length).map(escRe).join('|')

// A sure word reads with a colon or the older full stop ("goal: x", "Goal :
// x", "goal. x"); any other key only with a colon, since "Done. Moving on"
// is a sentence. The longest spelling is tried first, so "work item:" is
// not read as "work"; with the colon required, no two keys match one line. A word that asks ("who") with a "?" at the end of the
// line is a question however it is led: "Who: owns the rollout?".
const ASKING = new Set(['who'])
const PREFIX_PATTERNS = PREFIXES.flatMap(({ type, sure, keys }) => {
  const loose = keys.filter(k => !sure.includes(k))
  return [
    { type, sure: true, re: new RegExp(`^(${longestFirst(sure)})(?:\\s*:|\\.)\\s*`, 'i') },
    ...(loose.length ? [{ type, sure: false, re: new RegExp(`^(${longestFirst(loose)})\\s*:\\s*`, 'i') }] : []),
  ]
})

// Words that make a heading. Every key and its plural, plus each type's own
// label and plural ("Open questions", "Work items"). Not the words a list
// heading uses for something else: "Done:" lists finished work, "Tasks:" and
// "Notes:" anything at all, so their lines are typed one by one instead.
const NOT_A_HEADING = new Set(['do', 'done', 'start', 'begin', 'end', 'finish', 'task', 'action', 'note', 'info',
  'status', 'result', 'target', 'team', 'budget', 'work'])
const pluralOf = w => /(s|x|ch|sh)$/.test(w) ? w + 'es' : w + 's'
const HEADINGS = new Map()
PREFIXES.forEach(({ type, keys }) => {
  const add = w => { w = w.toLowerCase().replace(/\s+/g, ' ').trim(); if (w && !HEADINGS.has(w)) HEADINGS.set(w, type) }
  keys.filter(k => !NOT_A_HEADING.has(k)).forEach(k => { add(k); add(pluralOf(k)) })
  const t = TYPES[type]
  if (t) { add(t.label); add(t.plural || ''); add(pluralOf(t.label)) }
})
HEADINGS.set('hypotheses', 'assumption')

// Markup a pasted note carries that is not part of the line: a bullet (the
// ones a document editor pastes too, an en dash among them), a number, a
// task box, a Markdown heading, bold around the first words.
const BULLETS = '-*•◦▪‣\\u2013'
function cleanLine(raw) {
  return String(raw || '')
    .replace(new RegExp(`^\\s*[${BULLETS}+]\\s+`), '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^(\*\*|__)([^*_]+?)\1\s*/, '$2 ')
    .trim()
}

/**
 * The type a heading line stands for ("Risks:", "## Open questions",
 * "**Requirements:**"), or null when the line is not one. A heading is only
 * the word: "Goal: ship it" is a goal, "Goal:" alone heads a list of goals.
 */
export function headingType(text) {
  const raw = String(text || '').trim()
  const markdown = /^#{1,6}\s+/.test(raw)
  const s = raw.replace(/^#{1,6}\s+/, '').replace(/^(\*\*|__)([^*_]+?)\1/, '$2').replace(/(\*\*|__)$/, '').trim()
  const colon = /\s*:$/.test(s)
  if (!markdown && !colon) return null
  const word = s.replace(/\s*:$/, '').trim().toLowerCase().replace(/\s+/g, ' ')
  return HEADINGS.get(word) || null
}

/**
 * The prefix a cleaned line starts with, or null: { type, sure, word, rest },
 * where `word` is the prefix as written and `rest` the line after it.
 */
function matchPrefix(line) {
  for (const { re, type, sure } of PREFIX_PATTERNS) {
    const m = line.match(re)
    if (m) return { type, sure, word: m[1], rest: line.slice(m[0].length).trim() }
  }
  return null
}

/**
 * A title starts with a capital, as every template and card does: "goal:
 * cut drop-off" is the card "Cut drop-off". Only a first word written all
 * in lower case changes, so "iOS app" and "OIDC client" stay as typed.
 */
export function capitalFirst(text) {
  const s = String(text || '')
  return /^\p{Ll}[\p{Ll}'’-]*(?=[\s,;!?]|$)/u.test(s) ? s[0].toUpperCase() + s.slice(1) : s
}

// ── Text → blocks classification ─────────────────────────────
//
// Explicit "goal:"-style prefixes still win outright. Otherwise we strip a
// leading first-person/article ("we need…", "the API…") and SCORE the whole
// line against weighted keyword sets so natural prose lands on a real type
// instead of dumping into the gray 'custom' bucket.

const UNITS = '(day|week|month|quarter|year|sprint|release|morning|evening|monday|tuesday|wednesday|thursday|friday)'
// Whitespace or a hyphen: "end of day" and "end-of-day" are the same phrase.
const SEP = '[\\s-]+'
// The end of a period, however it is written: "end of sprint", "end-of-day",
// "quarter's end", "month end", "sprint-end".
const periodEnd = units => `(end${SEP}of${SEP}(the${SEP})?${units}|${units}(['’]?s)?${SEP}end)`
const PERIOD_END = periodEnd(UNITS)
const CADENCE_ANYWHERE = new RegExp(`\\b(every|each)\\s+(end|${UNITS})\\b|\\b${PERIOD_END}\\b`, 'i')
// A title that IS a cadence says when: "every" or "each" ("Every End of
// Sprint", "Each month"), "on" or "at" ("On Quarter's end", "At month end"),
// or the article prose puts in front of a moment ("The end of the quarter").
const CADENCE_WHOLE = new RegExp(`^(((on|at)\\s+)?(every|each)\\s+(end${SEP}of${SEP}(the${SEP})?)?${UNITS}((['’]?s)?${SEP}end)?|(on|at)\\s+(the\\s+)?${PERIOD_END}|the\\s+end${SEP}of${SEP}(the${SEP})?${UNITS})$`, 'i')
// A bare period end ("End of Sprint", "Month end") says no when. When the
// period is one a team reports on (a sprint, month, quarter, year or
// release), a label with no article on a map most often names what the
// period produces, the sprint-end report or review, so it reads as an
// Output; the moment it may also mean keeps it a guess. A shorter period
// ("End of day", "End of week") produces no such thing and stays a guess at
// a Trigger / End, the same type as the "Start of day" that opens its flow.
// A start names no report, so "Start of sprint" stays a confident Trigger /
// End: the pair is asymmetric on purpose. With "every" or "on" in front
// either end is the cadence above.
const PERIOD_NAME = new RegExp(`^${periodEnd('(sprint|month|quarter|year|release)')}$`, 'i')
const CADENCE_WORDS = '(daily|weekly|monthly|quarterly|annual|yearly)'
const REPORT_SUBJECTS = '(status|progress|performance|financial|finance|sales|incident|usage|cost|spend|compliance)'
// A cadence, a period or a subject in front of a report word is the report
// itself: "Weekly reporting", "Monthly digest", "Year-end reporting", "Q3
// reporting", "Financial reporting".
const REPORT_PERIODS = `(${CADENCE_WORDS}|${PERIOD_END}|${UNITS}|q[1-4])`
const REPORT_ITSELF = new RegExp(`^(${REPORT_PERIODS}\\s+(reporting|summar(y|ies)|digests?|updates?|newsletters?|briefs?|briefings?)|${REPORT_SUBJECTS}\\s+reporting)$`, 'i')
const AUDIENCE_WORDS = '(executives?|stakeholders?|customers?|leadership|owners?|team leads?|sponsors?)'
const AUDIENCE = new RegExp(`\\b${AUDIENCE_WORDS}\\b`, 'i')
const AUDIENCE_WHOLE = new RegExp(`^${AUDIENCE_WORDS}(\\s+(team|group|committee|board|council))?$`, 'i')
// "<Someone> Reporting" can name a reporting line, and a line is named for
// whom it reports to. But most words in front of "reporting" name what is
// reported on, when, or how ("Tax reporting", "Sprint reporting", "Supply
// Chain Reporting"), and those are not a who. So it is a guess (2) only when
// the word next to "reporting" is one a line reports to ("Board reporting",
// "Weekly Board Reporting"), or the words read as a name: capitalised, none
// a subject, period or manner, and either led by an acronym ("ACME Model
// Reporting") or ending in an organisational unit ("Retail Division
// Reporting"). Title Case alone is not a name: canvases are written in it.
// An audience word is left to AUDIENCE, so the two never add up to a
// confident call.
const REPORTING = /^([\w'’&.-]+(?:\s+[\w'’&.-]+){0,2})\s+reporting$/i
const REPORTS_TO = /^(board|investors?|portfolios?|management|partners?|regulators?|clients?|shareholders?|donors?|funders?|execs?|pmo|steering|committees?|councils?)$/i
// After another noun "management" is a discipline ("Project Management
// Reporting"), so it names a who only alone or after a rank or a cadence.
const MANAGEMENT_WHO = new RegExp(`^((senior|top|upper|line|general|${CADENCE_WORDS})\\s+)*management$`, 'i')
const ORG_UNIT = /^(divisions?|units?|regions?|segments?|offices?|groups?|departments?|subsidiar(y|ies))$/i
const NOT_A_WHO = new RegExp(`^(${CADENCE_WORDS}|${REPORT_SUBJECTS}|${UNITS}s?|q[1-4]|h[12]|fy\\d*|ytd|end|mid|of|the|to|date|period|` +
  'manual|automated|automatic|ad|hoc|real|time|self|serve|service|' +
  'regulatory|esg|tax|errors?|crash(es)?|expenses?|projects?|epics?|internal|external|operational|consolidated|centrali[sz]ed|' +
  'custom|dashboards?|data|quality|security|audit|risks?|defects?|bugs?|tests?|budgets?|revenue|pipeline|capacity|delivery|kpis?|metrics?|' +
  'okrs?|slas?|slos?|apis?|seo|etl|assets?)$', 'i')
const notAWho = w => NOT_A_WHO.test(w) || w.split('-').some(part => NOT_A_WHO.test(part))
const REPORTING_LINE = {
  // An object with test(), so the case-sensitive "reads as a name" check
  // can sit in SCORE_RULES beside the regular expressions.
  test(line) {
    const m = line.match(REPORTING)
    if (!m || AUDIENCE.test(line)) return false
    const words = m[1].split(/\s+/)
    const head = words[words.length - 1]
    if (REPORTS_TO.test(head) && (!/^management$/i.test(head) || MANAGEMENT_WHO.test(m[1]))) return true
    return words.length >= 2 && words.every(w => /^[A-Z]/.test(w)) &&
      (/^[A-Z]{2,}$/.test(words[0]) || ORG_UNIT.test(head)) && !words.some(notAWho)
  },
}
// A metric in the line: the work word in front is then usually naming the
// measure ("Rework rate above 20%", "Schedule variance").
const METRIC_HINT = '(%|\\b(rates?|targets?|baselines?|percent(age)?|variance|adherence)\\b)'
const DETERMINER = '(the|a|an|our|its|their|this|that|these|those|every|each|all)'
// A leading verb for work that changes something, where the verb alone
// cannot say whether it happens once (an Implementation) or on every run of
// a flow (a Process step): "Schedule status notes", "Consolidate the
// trackers". Several of these words are nouns too, and only the word that
// follows says which. So it is not work when:
//  - a noun it modifies follows ("Upgrade path", "Install guide",
//    "Prototype results", "Wire fees"), for the words that are also nouns;
//  - a preposition follows, which only a noun takes directly ("Schedule for
//    the migration", "Rework from the integration", "Rebuild vs buy");
//  - a verb or a state follows, directly or after one word that is not an
//    article, so the work word is the subject ("Schedule slipped again",
//    "Upgrade path is unclear", "Upgrade blocked by the integration",
//    "Rework caused by the migration"). A state counts only before a
//    preposition or the end, so "Install pending updates" is still work;
//  - it is "connect with" someone;
//  - a measure follows, unless an article makes it an object ("Rework rate
//    above 20%" is a metric, "Upgrade the rate limiter" is work).
// Only the words listed here are detected: a noun or verb missing from them
// still reads as work, which is one reason the call stays a guess.
const WORK_WORDS = '(schedule|consolidate|centrali[sz]e|standardi[sz]e|streamline|unify|connect(?!\\s+with\\b)|replace|rebuild|rewrite|refactor|redesign|rework|upgrade|configure|install|wire|hook up|expose|deprecate|retire|decommission|replatform|prototype|roll out)'
const WORK_NOUNS = '(schedule|rebuild|rewrite|redesign|rework|upgrade|install|wire|prototype|roll out)'
const WORK_NOUN_HEAD = '(paths?|guides?|notes|costs?|delays?|overruns?|pressure|results?|feedback|windows?|dates?|times?|fees?|plans?|instructions|estimates?|overview|impact|failures?|drift|downtime|transfers?)'
const SUBJECT_VERBS = '(is|are|was|were|has|have|had|keeps?|kept|still|slips?|slipped|slipping|conflicts?|changed|changes|moved|moves|fails?|failed|failing|breaks?|broke|broken|could|might|may|will|would|delays|causes|costs|looks|assumes)'
const SUBJECT_STATES = '(blocked|stuck|delayed|stalled|pending|overdue|ready|expected|caused|done)(?=\\s*$|\\s*[,.;:!?(]|\\s+(by|on|in|until|for|at|from|after|since|to|due|because|again|now|yet)\\b)'
const WORK_VERB = new RegExp(`^(?!(${WORK_NOUNS}\\s+${WORK_NOUN_HEAD}|install\\s+base)\\b)${WORK_WORDS}\\b` +
  `(?!\\s+(of|for|from|after|during|vs|versus)\\b)` +
  `(?!(\\s+(?!${DETERMINER}\\b)[\\w'’-]+)?\\s+(${SUBJECT_VERBS}\\b|${SUBJECT_STATES}))` +
  `(?!(?!\\s+${DETERMINER}\\b).*${METRIC_HINT})`, 'i')
// The work word takes an object only when an article or a determiner follows
// it ("Replace the integration", "Hook up the alerts"). Without one it may
// still be a noun neither list knows ("Rework budget for the migration"), so
// it stays a guess however many other cues agree.
const WORK_OBJECT = new RegExp(`^${WORK_WORDS}(\\s+(up|out|over|off))?\\s+${DETERMINER}\\b`, 'i')
const WORK_GUESS = { test: line => WORK_VERB.test(line) && !WORK_OBJECT.test(line) }
const WORK_ON_OBJECT = { test: line => WORK_VERB.test(line) && WORK_OBJECT.test(line) }

// A period's ceremony is a step the flow repeats, not the moment it starts
// or ends: "Month-end close", "End of quarter review", "Sprint retro",
// "Weekly sync". A guess, since a review can also be the document.
const PERIOD_EVENT = new RegExp(`^(${PERIOD_END}|${UNITS}|${CADENCE_WORDS})\\s+(close|closing|reviews?|retros?|retrospectives?|planning|demos?|syncs?|stand-?ups?|meetings?|reconciliations?|kick-?offs?|wrap-?ups?)$`, 'i')

// Weighted keyword cues. Each entry: [regex, points, cap?]. Highest-scoring
// type wins. On a tie the earlier type wins, which is why the three newer
// types come last: a line that already classified one way keeps doing so,
// and they only take lines nothing else claimed or claimed weakly. Nouns are
// plural-safe ("Reports", "Key Results"): the singular-only cues sent both to
// Other.
// A total of 3 is a confident call; under 3 is a guess that the card asks a
// person to check (typeCheck), so a cue that can mislead stays under 3. The
// optional cap is the most the type can total when that cue fires, so a
// guess cannot stack with another cue into a confident call that outranks a
// stronger reading ("Schedule migration risk" is a risk).
const SCORE_RULES = {
  requirement: [[/\b(need|needs|must|should|shall|require[sd]?|has to|have to)\b/i, 3], [/\b(support|enable|provide|allow)\b/i, 1]],
  assumption:  [[/\b(assume|assuming|assumption|expect|expects|presumably|likely|probably|i think|we think|believe)\b/i, 3], [/\bwill\s+\w+/i, 2], [/\b(should be fine|hopefully)\b/i, 2]],
  risk:        [[/\b(risks?|concerns?|danger|threats?|worried|might fail|could fail|fragile|breaks?|vulnerab)\b/i, 3], [/\b(if .* fails|single point of failure)\b/i, 2]],
  goal:        [[/\b(goals?|objectives?|aim|vision|want to|increase|reduce|improve|grow|launch|ship|achieve|reach)\b/i, 3]],
  problem:     [[/\b(problems?|issues?|blockers?|bugs?|broken|pain|can't|cannot|doesn't work|failing|slow|outage)\b/i, 3], [/\b(latency|exceeds?|over (our )?sla|breach(es|ing)?|too slow|error rate|downtime)\b/i, 3],
                 // "Build fails on main" is a red pipeline, not work to do.
                 [/^(build|pipeline|ci|deploy(ment)?|tests?)\s+(is\s+|are\s+|was\s+|keeps\s+)?(fail(s|ed|ing)?|broken|red|flaky)\b/i, 3]],
  decision:    [[/\b(decided|decision|chose|choose|chosen|go with|pick(ed)?|settle[d]? on|opt(ed)? for)\b/i, 3]],
  // Named systems ("Data Central", "Partner Portal") are resources too.
  resource:    [[/\b(teams?|budgets?|tools?|assets?|librar(y|ies)|apis?|services?|credits?|headcount|engineers?|designers?|systems?|platforms?|databases?|data sources?|warehouses?|central|hubs?|portals?)\b/i, 1]],
  // The period and report-itself cues are guesses that must not stack with
  // the noun cue: in "End of release" one word is both the period and the
  // output noun, and that is one reading counted twice.
  output:      [[/\b(deliverables?|outputs?|results?|outcomes?|artifacts?|reports?|doc(s|umentation)?|deploy|releases?)\b/i, 2],
                 [PERIOD_NAME, 2, 2], [REPORT_ITSELF, 2, 2]],
  context:     [[/\b(background|context|currently|today|historically|note that|fyi|for reference)\b/i, 2]],
  // `set up` is building something, not a step: leave it to implementation.
  process:     [[/^(update|create|add|send|generate|assign|review|submit|move|set(?!\s+up\b)|mark|run|trigger|notify)\b/i, 3], [/\b(step \d|then\b)/i, 1],
                 [PERIOD_EVENT, 2]],
  // A cadence ("every end of sprint", "on quarter's end") is what starts a
  // flow. A bare "weekly" is not: "Weekly reports" are an output. Only a
  // title that IS the cadence is a confident trigger: "Every week we lose
  // two customers" mentions one, and a mention alone is a hint (1 point).
  // "End" is a finish, but "End of Sprint" is a period's name (PERIOD_NAME).
  terminator:  [[new RegExp(`^(start|begin|finish|done|complete[d]?|end(?!${SEP}of${SEP}(the${SEP})?${UNITS}\\b))\\b`, 'i'), 3],
                 [CADENCE_ANYWHERE, 1],
                 [CADENCE_WHOLE, 2]],
  metric:      [[/\b(kpis?|okrs?|metrics?|key results?|slas?|slos?|nps)\b/i, 3], [new RegExp(METRIC_HINT, 'i'), 2]],
  // A leading "build" is work unless the build is the subject ("Build
  // fails on main") or its object is not a thing ("Build trust with ...").
  implementation: [[/^(implement|integrate|migrate|automate|set up|(build|develop)(?!\s+(fails?|failed|failing|broke|broken|breaks|is|was|keeps|still|red|trust|relationships?|rapport|confidence|consensus|momentum|awareness|credibility|loyalty|reputation|culture)\b))\b/i, 3],
                   [/\b(implement(s|ed|ing|ation)?|integrat(e|es|ed|ing|ion|ions)|migrat(e|es|ed|ing|ion)|automat(e|es|ed|ing|ion))\b/i, 2],
                   // 2.5 outranks a noun cue of 2 ("Schedule the weekly report"
                   // is the work, not the report) and stays a guess. Only with
                   // an object in view can an implementation noun lift it to 3,
                   // and no further, so a risk or problem cue of 3 still wins
                   // the tie ("Replace the integration: risk of data loss").
                   [WORK_GUESS, 2.5, 2.5], [WORK_ON_OBJECT, 2.5, 3]],
  // An audience word anywhere is a weak cue (2): "Customers will pay for
  // this" is a belief and "Customer churn above 5%" a metric, and both tie
  // back to the earlier type. Only a title that names the audience outright
  // ("Customers", "Leadership team") is a confident stakeholder. A
  // reporting line ("Portfolio Reporting") is a guess at one.
  stakeholder: [[AUDIENCE, 2], [AUDIENCE_WHOLE, 1], [REPORTING_LINE, 2]],
}

// "The" goes too, except before a period end: "The end of the quarter" is
// a moment, and CADENCE_WHOLE needs the article to tell it from a label.
const LEADING_FILLER = new RegExp(`^(we|i|the(?!\\s+end${SEP}of${SEP}(the${SEP})?${UNITS}\\b)|our|they|it|this|that|there)\\s+`, 'i')

/**
 * Classify one raw line into { type, title, confidence, source }.
 * confidence: 'high' (a prefix word or a strong score) | 'low' (weak/none).
 * source: 'prefix' (a `sure` PREFIXES word, which leaves the title), 'question'
 * (a trailing "?"), 'alias' (another PREFIXES key, which stays in the title)
 * or 'guess' (the scoring). Only the first two are certain: the brain dump
 * asks for a check on every alias and guess, confident or not, and the
 * importers on the low-confidence ones. `afterPrefix` marks a title that
 * followed a prefix word, which the dump starts with a capital (capitalFirst);
 * the importers keep the title as written.
 * A title alone cannot always carry its type: the eleven reporting-flow
 * titles in tests/types-registry.test.js now all land where their author
 * meant, but eight of them only as a guess ("ACME Model Reporting" could
 * be reporting on a model, "End of Sprint" the moment itself), which is
 * why low-confidence calls ask to be checked.
 */
export function categorizeLine(raw) {
  const line = cleanLine(raw)
  const pre = matchPrefix(line)
  const asks = /[?？]$/.test(line)

  // 1. A sure prefix: authoritative, unless it is a word that asks ("Who:")
  // on a line that asks.
  if (pre?.sure && pre.rest && !(asks && ASKING.has(pre.word.toLowerCase()))) {
    return { type: pre.type, title: pre.rest, confidence: 'high', source: 'prefix', afterPrefix: true }
  }

  // 2. A trailing "?" (or the full-width "？") is a genuine question unless
  // it reads as a belief. It wins over a prefix word that is not sure, and
  // the word joins the question: "Should: we support SAML?" asks "Should we
  // support SAML?".
  const looksAssumed = /\b(assume|assuming|expect|believe|will work|should be|probably|likely)\b/i.test(line)
  if (asks && !looksAssumed) {
    if (pre?.rest) return { type: 'question', title: `${pre.word} ${pre.rest}`, confidence: 'high', source: 'question', afterPrefix: true }
    return { type: 'question', title: line, confidence: 'high', source: 'question' }
  }

  // 3. Any other prefix word: its type, as a guess. The word stays in the
  // title, since it was the writer's word and not this syntax: "Done:
  // client merged" and "Start: 3 March" mean less without it.
  if (pre?.rest) return { type: pre.type, title: line, confidence: 'high', source: 'alias' }

  // 4. Score the whole line (filler-stripped) against keyword cues.
  const probe = line.replace(LEADING_FILLER, '')
  let best = { type: 'custom', score: 0 }
  for (const [type, rules] of Object.entries(SCORE_RULES)) {
    let score = 0, cap = Infinity
    for (const [re, pts, most = Infinity] of rules) {
      if (re.test(probe)) { score += pts; cap = Math.min(cap, most) }
    }
    score = Math.min(score, cap)
    if (score > best.score) best = { type, score }
  }

  if (best.score >= 3) return { type: best.type, title: line, confidence: 'high', source: 'guess' }
  if (best.score >= 1) return { type: best.type, title: line, confidence: 'low', source: 'guess' }
  return { type: 'custom', title: line, confidence: 'low', source: 'guess' }
}

// One line of a dump: how deep it sits, whether it is a list item, its text.
// Depth = indentUnits*10 + (isBullet ? 1 : 0), where two spaces or one tab is
// one indent unit, so "Header / - bullet" nests without indentation. A dash,
// star, plus or number is a marker only with a space after it, as Markdown
// has it: "-5% since launch" and "3.5% churn" are not list items. A bullet
// glyph always is.
const MARKER = /^(\s*)([-*+–](?=\s|$)|[•◦▪‣]|\d+[.)](?=\s|$))?\s*/
function lineParts(raw) {
  const m = raw.match(MARKER)
  const ws = (m[1] || '').replace(/\t/g, '  ')
  const bullet = !!m[2]
  const content = raw.slice(m[0].length).replace(/^\[[ xX]\]\s+/, '').trim()
  return { depth: Math.floor(ws.length / 2) * 10 + (bullet ? 1 : 0), bullet, content }
}

/**
 * Parse freeform text into an outline: top-level lines become blocks, while
 * more-indented or bulleted lines beneath them fold into that block's
 * description. A line is a child only when it is "deeper" than the current
 * block, so a flat bullet list (all same depth) still becomes sibling blocks.
 *
 * A heading ("Risks:", "## Open questions", see headingType) makes no block:
 * it types the list under it. Its list is the lines deeper than it, or, when
 * the first line under it sits at its own depth, the lines at that depth up
 * to a blank line ("Word:") or the next heading (Markdown). Each item carries `section` (the heading's type or null)
 * and `children` ([{ text, bullet }], the raw form of `description`).
 */
export function parseOutline(text) {
  const items = []          // { line, description: [lines], children, depth, section }
  let current = null        // the item deeper lines fold into
  let section = null        // { type, depth, itemDepth }
  String(text || '').split(/\r?\n/).forEach(raw => {
    if (!raw.trim()) {
      // A blank line ends a flat list under a "Word:" heading; a bulleted or
      // indented one ends where a shallower line starts. A Markdown heading
      // runs to the next heading, since pasted Markdown puts a blank line
      // between its paragraphs.
      if (section && !section.markdown && section.itemDepth != null && section.itemDepth <= section.depth) section = null
      return
    }
    const { depth, bullet, content } = lineParts(raw)
    if (!content) return
    if (section && depth < (section.itemDepth ?? section.depth)) section = null
    const child = current && depth > current.depth
    const head = child ? null : headingType(content)
    const markdown = !child && /^#{1,6}\s/.test(content)
    if (head) { section = { type: head, depth, itemDepth: null, markdown }; current = null; return }
    // Any other Markdown heading ("## Timeline") ends the section above it.
    if (markdown) section = null
    if (child) {
      current.children.push({ text: content, bullet })
      current.description.push(bullet ? '• ' + content : content)
      return
    }
    if (section && section.itemDepth == null) section.itemDepth = depth
    current = { line: content, description: [], children: [], depth, section: section ? section.type : null }
    items.push(current)
  })
  return items
}

/**
 * What a dump of text becomes, before anything touches the canvas: one
 * { type, title, description, criteria, typeCheck, source } per block. Pure.
 *
 * The type comes from the line's own sure prefix, else the heading it sits
 * under, else a trailing "?", else another prefix word or the classifier,
 * and those last two are guesses (`typeCheck`). Under a requirement or a
 * metric typed by a prefix or a heading the "- " lines are its criteria (a
 * metric's Targets); everywhere else, a guessed requirement included, and
 * for lines without a marker, they fold into the description. With `nest`
 * off every line is its own block, still typed by its heading.
 */
export function readDump(text, nest = true) {
  const outline = parseOutline(text)
  const items = nest ? outline : outline.flatMap(it => [
    { ...it, description: [], children: [] },
    ...it.children.map(c => ({ line: c.text, description: [], children: [], section: it.section })),
  ])
  return items.map(item => {
    const own = categorizeLine(item.line)
    const fromHeading = !!item.section && own.source !== 'prefix'
    const type = fromHeading ? item.section : own.type
    const source = fromHeading ? 'heading' : own.source
    const certain = source === 'prefix' || source === 'heading' || source === 'question'
    const { title, overflow } = splitTitle(own.afterPrefix ? capitalFirst(own.title) : own.title)
    const spec = { type, title, description: item.description.join('\n'), criteria: [],
      typeCheck: !certain, source }
    if (overflow) spec.description = overflow + (spec.description ? '\n' + spec.description : '')
    // Only a type somebody wrote makes bullets criteria: under a guess they
    // stay in the description, which every type shows, so a guess fixed to
    // a type without criteria cannot hide them.
    if (certain && CRITERIA_FROM_BULLETS.has(type) && item.children.some(c => c.bullet)) {
      const seen = new Set(), rest = []
      item.children.forEach(c => {
        if (!c.bullet) { rest.push(c.text); return }
        const text = c.text.slice(0, 300), key = text.toLowerCase()
        if (seen.has(key)) return
        // normalize.js keeps 30; past that the line stays, in the description.
        if (spec.criteria.length >= 30) { rest.push('• ' + c.text); return }
        seen.add(key); spec.criteria.push(text)
      })
      spec.description = [overflow, ...rest].filter(Boolean).join('\n')
    }
    return spec
  })
}

/** The longest title a dumped line keeps; a card's title is never clamped. */
export const TITLE_MAX = 120

// A full stop after one of these ends a word, not a sentence: "e.g. the
// two big ones" carries on.
const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf|approx|incl|esp|viz|al|mr|mrs|ms|dr|st|no|fig|inc|ltd|co|jr|sr)\.$/i

// Where the first sentence of `s` ends (an index just past its . ! or ?),
// at least 12 characters in and no further than TITLE_MAX, or 0. A
// sentence ends where the next word does not start in lower case and the
// full stop does not close an abbreviation.
function firstSentenceEnd(s) {
  const re = /[.!?](?=\s+(\S))/g
  let m
  while ((m = re.exec(s))) {
    const end = m.index + 1
    if (end > TITLE_MAX) break
    if (m.index < 12 || /\p{Ll}/u.test(m[1])) continue
    if (s[m.index] === '.' && ABBREVIATION.test(s.slice(0, end))) continue
    return end
  }
  return 0
}

/**
 * A pasted paragraph is not a title. Past TITLE_MAX characters the title is
 * the first sentence when that fits, and the rest of the line moves to the
 * description; otherwise it is cut at a word with an ellipsis and the
 * description keeps the whole line. Nothing typed is lost either way.
 */
export function splitTitle(text) {
  const s = String(text || '').trim()
  if (s.length <= TITLE_MAX) return { title: s, overflow: '' }
  const end = firstSentenceEnd(s)
  if (end) return { title: s.slice(0, end), overflow: s.slice(end).trim() }
  const cut = s.slice(0, TITLE_MAX)
  const at = cut.lastIndexOf(' ')
  return { title: (at > TITLE_MAX / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:]+$/, '') + '…', overflow: s }
}

/**
 * Turn freeform text into typed blocks in step columns (Why, Who, Proof,
 * What, How, Doubt, then Other), in the nearest free space to the middle of
 * the view, or to `at` (a world point: the arrangement's top-left sits half
 * a card left of it) when given. Shared by the paste handler, the canvas
 * menu's Paste as blocks and the start panel's notes. One undo step. Returns the array of created block ids. When
 * `nest` is true (default), indented/bulleted lines fold into the block
 * above them.
 *
 * The camera then shows the result at a readable zoom (zoom-controls.js
 * arriveAt), as a microtask, so a caller that moves the new blocks right
 * after has moved them first; if that put them on a card, they move clear
 * of it first (settleDump).
 */
export function createBlocksFromText(text, nest = true, { at = null } = {}) {
  if (ui.readOnly) return []
  const specs = readDump(text, nest)
  if (!specs.length) return []

  snapshot()
  const ids = specs.map(spec => {
    const id = genId()
    state.blocks[id] = {
      id, type: spec.type, title: spec.title, description: spec.description, notes: '',
      x: 0, y: 0,
      actions: [], questions: [],
      docRef: null,
      width: null, color: null, collapsed: false, groupId: null,
      status: null, priority: null,
      cardStyle: null, borderWidth: null, highlight: null,
    }
    if (spec.criteria.length) state.blocks[id].criteria = spec.criteria
    // A type the classifier picked, however sure it was, waits for a person
    // to confirm it, and says so on the card, instead of passing as real.
    if (spec.typeCheck) state.blocks[id].typeCheck = true
    return id
  })

  // Render first: the columns stack by each card's real height, and a card
  // with a description is taller than the estimate.
  renderAllBlocks()
  placeDump(ids, at)
  renderAllBlocks()
  renderArrows()
  runGapDetection()
  updateHint()
  debouncedSave()
  ui.promptDirty = true

  const guessed = specs.filter(s => s.typeCheck).length
  queueMicrotask(() => {
    const live = ids.filter(id => state.blocks[id])
    if (!live.length) return
    settleDump(live)
    // The camera's own arrival (zoom-controls.js): left alone when the dump
    // is already on screen at a readable zoom, else 75% on its start.
    const all = arriveAt(live, { stay: true })?.whole !== false
    showToast(dumpSummary(live.length, guessed, all), 'info', guessed || !all ? 4200 : 2600)
  })
  return ids
}

/**
 * The toast after a dump: how many, how many types to check, how to see
 * them all. `fit` names the way to see everything ('Shift+1', or 'Fit' on
 * a touch screen).
 */
export function dumpSummary(count, guessed = 0, allInView = true, fit = fitKeyName()) {
  let msg = `Added ${count} block${count === 1 ? '' : 's'}`
  if (guessed) {
    msg += guessed === count && count > 1
      ? ', every type a guess to check'
      : `, ${guessed} with a guessed type to check`
  }
  if (!allInView) msg += `. ${fit} shows all of ${count === 1 ? 'it' : 'them'}`
  return msg
}

/**
 * The step arrangement that fits the view a dump arrives in, a viewport of
 * `W` by `H` screen pixels. A wide view gets columns, wrapped into bands
 * where that lets the whole dump show larger: of every place the columns
 * could break into a new band below, the one whose arrangement fits the
 * view at the highest zoom (one band when that is no worse). A tall view
 * (a phone) gets step rows, as many cards across as read at ARRIVAL_ZOOM.
 * With no laid-out viewport, plain columns. Pure: sizes in, layoutByStep's
 * result out.
 */
export function layoutDump(nodes, W = 0, H = 0) {
  if (!(W > 0 && H > 0)) return layoutByStep(nodes)
  // The arrival's margin is in world pixels (zoom-controls.js arrivalView),
  // so the zoom an arrangement arrives at is the one arrivalView computes.
  const pad = ARRIVAL_PAD * 2
  if (H > W) {
    const cardW = Math.max(DEFAULT_WIDTH, ...nodes.map(n => n.w || 0)), gap = STEP_LAYOUT.rowGap
    const across = Math.max(1, Math.floor((W / ARRIVAL_ZOOM - pad + gap) / (cardW + gap)))
    return layoutByStep(nodes, { direction: 'TB', grow: false, maxPerColumn: across })
  }
  const zoomOf = l => Math.min(1, W / (Math.max(1, l.width) + pad), H / (Math.max(1, l.height) + pad))
  const one = layoutByStep(nodes)
  const width = new Map(nodes.map(n => [n.id, n.w || DEFAULT_WIDTH]))
  let best = one, bestZoom = zoomOf(one)
  one.lanes.forEach(lane => {
    const wrap = one.positions.get(lane.ids[0]).x + Math.max(...lane.ids.map(id => width.get(id)))
    if (wrap >= one.width) return
    const l = layoutByStep(nodes, { wrap })
    const z = zoomOf(l)
    if (z > bestZoom + 1e-6) { best = l; bestZoom = z }
  })
  return best
}

// Step columns that fit the view, then the nearest free space for the whole
// arrangement, so a dump on a busy map never lands on a card.
function placeDump(ids, at) {
  const nodes = ids.map(id => ({ id, type: state.blocks[id].type, ...blockSize(id) }))
  const vp = $.canvasViewport()
  const layout = layoutDump(nodes, vp?.clientWidth || 0, vp?.clientHeight || 0)
  let want
  if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) want = { x: at.x - DEFAULT_WIDTH / 2, y: at.y }
  else {
    const r = $.canvasViewport().getBoundingClientRect()
    const c = toWorld(r.width / 2, r.height / 2)
    want = { x: c.x - layout.width / 2, y: c.y - layout.height / 2 }
  }
  const spot = nearestFreeSpot(want.x, want.y, layout.width, layout.height, occupiedRects(ids), { step: 40 })
  ids.forEach(id => {
    const p = layout.positions.get(id) || { x: 0, y: 0 }
    state.blocks[id].x = spot.x + p.x
    state.blocks[id].y = spot.y + p.y
  })
}

/**
 * Keep a dump off the cards that were there before it, after its caller
 * has had its say: the canvas menu's Paste as blocks moves the arrangement
 * to where the menu opened, which can be on a card. The arrangement moves
 * as one to the nearest free space; nothing happens when it is clear.
 * Part of the dump's own undo step. Returns true when it moved.
 */
export function settleDump(ids) {
  const live = ids.filter(id => state.blocks[id])
  if (!live.length) return false
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  live.forEach(id => {
    const b = state.blocks[id], { w, h } = blockSize(id)
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + w); maxY = Math.max(maxY, b.y + h)
  })
  const spot = nearestFreeSpot(minX, minY, maxX - minX, maxY - minY, occupiedRects(live), { step: 40 })
  const dx = spot.x - Math.round(minX), dy = spot.y - Math.round(minY)
  if (!dx && !dy) return false
  live.forEach(id => {
    const b = state.blocks[id]
    b.x = Math.round(b.x + dx); b.y = Math.round(b.y + dy)
  })
  renderAllBlocks()
  renderArrows()
  runGapDetection()
  debouncedSave()
  return true
}

let pasteWired = false
export function setupPasteHandler() {
  if (pasteWired) return
  pasteWired = true
  document.addEventListener('paste', e => {
    const tag = document.activeElement?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.contentEditable === 'true') return
    if (ui.readOnly) return
    // A modal dialog (the incoming-link chooser), an open menu or the
    // shortcut sheet owns the keyboard: nothing lands on the map behind it.
    if (modalDialogOpen() || isMenuOpen() || e.target?.closest?.('dialog, .pf-menu, #shortcutOverlay')) return
    const sheet = document.getElementById('shortcutOverlay')
    if (sheet && sheet.style.display !== 'none' && sheet.getAttribute('aria-modal') === 'true') return
    const text = e.clipboardData?.getData('text/plain')
    if (!text?.trim()) return
    e.preventDefault()
    createBlocksFromText(text)
  })
}

// ── Type check on the card ───────────────────────────────────
//
// A type the classifier was unsure of is marked `typeCheck` on the block, and
// the card's type label becomes a button (renderBlock). Clicking it opens the
// type menu with "Looks right" first; either choice clears the mark in one
// undo step. This replaced chips floated above the cards, which covered their
// neighbours, never dimmed, vanished on the next press anywhere and lost
// their clicks to the viewport.

/**
 * Mark the low-confidence blocks among `created` ([{ id, confidence }]) as
 * awaiting a type check. Metadata only, so no undo step of its own: the
 * import or Brain Dump that created them already took one. The name is the
 * old one because the importers and the `pf:show-type-chips` event use it.
 */
export function showTypeChips(created) {
  if (ui.readOnly) return 0
  const ids = (Array.isArray(created) ? created : [])
    .filter(c => c && c.confidence === 'low' && state.blocks[c.id] && !state.blocks[c.id].typeCheck)
    .map(c => c.id)
  if (ids.length) mutateBlocks(ids, { typeCheck: true }, { undo: false })
  return ids.length
}

/**
 * Settle a block's type check: confirm the type it has (no `type`), or change
 * it. Either way the mark goes, as one undo step, by the rule every type
 * picker shares (retypeBlock). Returns false when there was nothing to do.
 */
export function resolveTypeCheck(id, type = null) {
  const b = state.blocks[id]
  if (!b || ui.readOnly) return false
  if (type && !Object.hasOwn(TYPES, type)) return false
  if (!b.typeCheck && (!type || type === b.type)) return false
  retypeBlocks([id], type)
  // The inspector shows the type too; the retype leaves it to the caller.
  if (selection.ids.has(id)) renderInspector()
  return true
}

// The card re-renders, so the button that had focus is gone: hand focus to
// the card rather than dropping it on the page.
function refocusCard(id) {
  const ae = document.activeElement
  if (!ae || ae === document.body) getBlockEl(id)?.focus({ preventScroll: true })
}

// The compact form of the shared type list: "Looks right", then one row per
// step opening its types, so the menu hung off a small label never covers
// its own card (all sixteen under headings stood about 790px tall).
function typeCheckItems(id) {
  const b = state.blocks[id]
  return typeMenuItems(b.type, type => { resolveTypeCheck(id, type); refocusCard(id) },
    { unconfirmed: true, steps: true, typeHint: b.typeHint || '' })
}

/** Open the type menu under a card's type-check button. */
export function openTypeChipMenu(anchor) {
  const id = anchor?.dataset?.typeCheck
  if (!id || !state.blocks[id] || ui.readOnly) return null
  return openDropdown(anchor, typeCheckItems(id), { label: 'Block type', className: 'type-check-menu' })
}

// The start panel's wiring (the notes field, Turn into blocks) lives in
// start-panel.js; this module keeps the text-to-blocks work it calls.

let typeChecksWired = false
export function setupTypeChips() {
  if (typeChecksWired) return
  typeChecksWired = true
  // Importers (the dump lives here, interop does not) report their
  // low-confidence blocks via an event, so no module has to import this one.
  window.addEventListener('pf:show-type-chips', e => showTypeChips(Array.isArray(e.detail) ? e.detail : []))
  // The button carries data-canvas-ui, so a press on it neither selects nor
  // drags the card; its click opens the menu.
  $.canvasRoot().addEventListener('click', e => {
    const btn = e.target.closest('.block-type-check'); if (!btn) return
    e.stopPropagation()
    openTypeChipMenu(btn)
  })
  // Tab steps from card to card and never lands on the button, so T opens
  // the check for the focused card (or the one selected card when focus is
  // on the page). Never while typing.
  document.addEventListener('keydown', e => {
    if ((e.key || '').toLowerCase() !== 't' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
    if (ui.readOnly) return
    const ae = document.activeElement
    if (ae?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae?.tagName || '')) return
    const onPage = !ae || ae === document.body
    const card = (!onPage && ae.closest?.('.block')) ||
      (onPage && selection.ids.size === 1 ? getBlockEl(selection.blockId) : null)
    const btn = card && $.canvasRoot().contains(card) ? card.querySelector('.block-type-check') : null
    if (!btn) return
    e.preventDefault()
    openTypeChipMenu(btn)
  })
}
