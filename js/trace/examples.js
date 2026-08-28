// ════════════════════════════════════════════════════════════
//  trace/examples.js: Loadable worked traces
//
//  Each entry is fetched from traces/ rather than inlined, so the file an
//  author downloads and the example the page loads are the same bytes.
//  An example that drifts from the file it documents is worse than none.
// ════════════════════════════════════════════════════════════

export const EXAMPLES = [
  {
    id: 'aws-cross-account-connectivity',
    name: 'AWS: account A cannot reach account B',
    kind: 'tree',
    blurb: 'Symptom first, then DNS, routing, security groups and NACLs, in the order that costs least to check.',
    file: 'traces/aws-cross-account-connectivity.yaml',
  },
  {
    id: 'aws-private-service-topology',
    name: 'AWS: cross-account private service (map)',
    kind: 'topology',
    blurb: 'The same problem drawn as a topology: two accounts, the boundaries, and which hop is broken.',
    file: 'traces/aws-private-service-topology.yaml',
  },
]

export async function loadExample(id) {
  const ex = EXAMPLES.find(e => e.id === id)
  if (!ex) throw new Error(`No example "${id}"`)
  const res = await fetch(ex.file)
  if (!res.ok) throw new Error(`Could not load ${ex.file} (${res.status})`)
  return res.text()
}
