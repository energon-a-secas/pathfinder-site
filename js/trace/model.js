// ════════════════════════════════════════════════════════════
//  trace/model.js: What a trace is made of
//
//  A trace is the second document type in Pathfinder. Where a canvas is
//  free-position typed cards you drag, a trace is a YAML document you
//  write: either a decision tree (how to think through a failure) or a
//  topology (what talks to what, and where it stops working).
//
//  Nothing here touches the DOM or app state. The registries are data,
//  read by the parser, the renderer, the suggestion engine and the spec
//  in llms.txt, so a kind cannot exist in one and be missing from another.
// ════════════════════════════════════════════════════════════

export const KINDS = ['tree', 'topology']
export const DEFAULT_KIND = 'tree'

/**
 * Tree node kinds.
 *
 * The set is deliberately small. Each one earns its place by having a
 * different shape on the page and a different job in the argument: a
 * `check` branches, an `action` does not, a `cause` is where the search
 * stopped, and a `deadend` says this path is somebody else's problem.
 * Adding a kind that renders like an existing one is how a diagram
 * language stops being readable.
 */
export const NODE_KINDS = {
  check:   { label: 'Check',     color: '#38bdf8', shape: 'hex',   hint: 'A question with branches. The only kind that may carry `branches`.' },
  action:  { label: 'Action',    color: '#60a5fa', shape: 'rect',  hint: 'Something to do. Continues to one next node.' },
  cause:   { label: 'Cause',     color: '#f87171', shape: 'rect',  hint: 'The thing that was actually wrong.' },
  fix:     { label: 'Fix',       color: '#34d399', shape: 'rect',  hint: 'What resolves it.' },
  deadend: { label: 'Dead end',  color: '#94a3b8', shape: 'rect',  hint: 'Nothing more to try here. Escalate, or it is out of scope.' },
  note:    { label: 'Note',      color: '#64748b', shape: 'plain', hint: 'Context hanging off the flow. Never branches.' },
}

/**
 * Topology node kinds.
 *
 * `container: true` means the node holds others via `in:` and is drawn as
 * a labelled boundary rather than a box. Containers nest without limit;
 * an account holding a VPC holding a subnet is the ordinary case, and it
 * is the thing Mermaid cannot draw, which is half of why this format
 * exists.
 */
export const TOPO_KINDS = {
  account:  { label: 'Account',   color: '#a78bfa', container: true,  hint: 'An AWS account boundary. The one people forget is a boundary.' },
  region:   { label: 'Region',    color: '#818cf8', container: true,  hint: 'A region boundary.' },
  vpc:      { label: 'VPC',       color: '#2dd4bf', container: true,  hint: 'A VPC. Put the CIDR in the label; overlapping CIDRs are a recurring cause.' },
  subnet:   { label: 'Subnet',    color: '#22d3ee', container: true,  hint: 'A subnet. Say public or private in the label.' },
  zone:     { label: 'Zone',      color: '#64748b', container: true,  hint: 'Any other boundary: on-prem, a partner network, a k8s namespace.' },

  client:   { label: 'Client',    color: '#f0abfc', container: false, hint: 'Where the call starts.' },
  compute:  { label: 'Compute',   color: '#60a5fa', container: false, hint: 'EC2, ECS task, Lambda, pod.' },
  service:  { label: 'Service',   color: '#818cf8', container: false, hint: 'The thing being called. ALB, API, managed service.' },
  gateway:  { label: 'Gateway',   color: '#fbbf24', container: false, hint: 'TGW, NAT, IGW, VPN, Direct Connect.' },
  endpoint: { label: 'Endpoint',  color: '#34d399', container: false, hint: 'Interface or gateway VPC endpoint, PrivateLink service.' },
  dns:      { label: 'DNS',       color: '#38bdf8', container: false, hint: 'A hosted zone, a resolver, a resolver rule.' },
  store:    { label: 'Data',      color: '#2dd4bf', container: false, hint: 'RDS, DynamoDB, S3, a queue.' },
  identity: { label: 'Identity',  color: '#c084fc', container: false, hint: 'An IAM role, a trust policy, an assumed-role hop.' },
  external: { label: 'External',  color: '#94a3b8', container: false, hint: 'Something outside your control. The internet, a SaaS, a partner.' },
}

/**
 * Link state.
 *
 * `unknown` is the default and it is the honest one: at the moment you
 * draw a map during an incident you usually do not know whether a hop
 * works. A format that defaults to `ok` invites a map that lies.
 */
export const LINK_STATES = {
  branch:   { label: 'Branch',     color: null,      dash: null,   hint: 'An outcome of a check. Trees use this and it is not a claim about anything.' },
  unknown:  { label: 'Unverified', color: '#94a3b8', dash: '5 4',  hint: 'Nobody has checked this hop. The default in a topology.' },
  ok:       { label: 'Verified',   color: '#34d399', dash: null,   hint: 'Checked, and it works. Say how in `evidence`.' },
  broken:   { label: 'Broken',     color: '#f87171', dash: null,   hint: 'Checked, and it fails. This is what you are here about.' },
  proposed: { label: 'Proposed',   color: '#fbbf24', dash: '2 5',  hint: 'A path that does not exist yet. What you are considering building.' },
}
/**
 * The default depends on the document.
 *
 * In a topology, an unmarked hop genuinely is unverified, and saying so is
 * the honest default: a map that quietly claims every link works is worse
 * than no map. In a tree, an edge is just an outcome of a check and makes
 * no claim at all, so borrowing `unknown` there drew 46 dashed grey lines
 * that all meant nothing.
 */
export const DEFAULT_LINK_STATE = 'unknown'
export const defaultStateFor = traceKind => traceKind === 'topology' ? 'unknown' : 'branch'

/** Document status. Presentation and filing, never behaviour. */
export const TRACE_STATUS = {
  draft:         { label: 'Draft' },
  investigating: { label: 'Investigating' },
  resolved:      { label: 'Resolved' },
  documented:    { label: 'Runbook' },
}
export const DEFAULT_STATUS = 'draft'

/** Sizing. Boxes are computed from content, never measured in the DOM. */
export const BOX = {
  minW: 180, maxW: 300,
  padX: 14, padY: 12,
  titleSize: 14, titleLead: 19,
  bodySize: 12,  bodyLead: 16,
  probeSize: 11, probeLead: 15,
  gapAfterTitle: 6,
  badgeH: 15,
  containerPad: 26, containerHeadH: 24,
}

/** Which node kinds a given document kind accepts. */
export function kindsFor(traceKind) {
  return traceKind === 'topology' ? TOPO_KINDS : NODE_KINDS
}
