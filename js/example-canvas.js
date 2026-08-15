// ════════════════════════════════════════════════════════════
//  example-canvas.js — The worked example from tutorial.html.
//
//  Its own module so the walkthrough page and the test suite read
//  the same object: a broken example on a page that teaches the
//  tool is worse than no example.
// ════════════════════════════════════════════════════════════

const B = (id, type, title, description, x, y, extra = {}) => ({
  id, type, title, description,
  notes: '', x, y, actions: [], questions: [],
  docRef: null, width: null, color: null, collapsed: false,
  groupId: null, status: null, priority: null,
  cardStyle: null, borderWidth: null,
  ...extra,
})

const E = (id, from, to, label, note) => ({
  id, from, to, style: 'routed', bidirectional: false,
  color: null, weight: 2, label, note, fromPort: null, toPort: null,
})

export const EXAMPLE_CANVAS = {
    blocks: [
      B('t1', 'terminator', 'Report received',
        '"Checkout is broken for some people." Forwarded Thursday morning, no version, no account id, no screenshot.', 0, 0),

      B('t2', 'problem', 'Checkout returns 500 on some card payments',
        'Intermittent. Stated as the symptom only, with no theory attached, because the theory is the part we keep getting wrong.',
        300, 0, { priority: 'high', actions: ['resolve'] }),

      B('t3', 'process', 'Reproduce it',
        'Find one account and one card that fails reliably. Until this exists there is nothing to fix and nothing to prove fixed.',
        640, -230),

      B('t4', 'question', 'Does it happen on staging?',
        'If staging is clean, the cause is environmental: config, credentials, data, or a downstream service that only exists in production.',
        640, 10),

      B('t5', 'question', 'When did the first failure land?',
        'First error in the logs, not first complaint. People report days late, and that gap is where the wrong deploy gets blamed.',
        640, 250),

      B('t6', 'assumption', 'It started with Tuesday\'s deploy',
        'The most-reached-for explanation in any outage, and wrong often enough to be worth checking before it steers the whole search.',
        980, 250, { actions: ['validate'] }),

      B('t7', 'assumption', 'The payment service is at fault',
        'It is the component everyone names first. Name the evidence that would confirm it, and the evidence that would rule it out.',
        980, 10, { actions: ['validate'] }),

      B('t8', 'context', 'What changed in the last week',
        'Two deploys, a dependency bump, and a card processor certificate rotated on Wednesday. The last one is in nobody\'s changelog.',
        300, 260),

      B('t9', 'problem', 'No test covers the payment retry path',
        'So a regression there is invisible until a customer finds it. This is why the report arrived from a customer.',
        980, -230, { actions: ['resolve'] }),

      B('t10', 'output', 'Root cause, with the evidence for it',
        'The mechanism plus the specific log line, trace, or diff that proves it. A cause without evidence is still a guess wearing a suit.',
        1320, 10, { priority: 'high' }),

      B('t11', 'requirement', 'A test that fails before the fix',
        'Written against the reproduction. If it passes on the unfixed code it is testing something else.',
        1660, 10, { priority: 'high' }),

      B('t12', 'terminator', 'Fixed and proven',
        'Test goes red then green, the symptom is gone where it was reported, and the cause is written down somewhere the next person will look.',
        2000, 10)
    ],
    arrows: [
      E('e1', 't1', 't2', 'reported as'),
      E('e2', 't2', 't3', 'reproduce'),
      E('e3', 't2', 't4', 'scope'),
      E('e4', 't2', 't5', 'when'),
      E('e5', 't5', 't6', 'suggests'),
      E('e6', 't3', 't7', 'points at'),
      E('e7', 't8', 't2', 'context for',
        'The certificate rotation is the one nobody wrote down. Check it before the deploy.'),
      E('e8', 't6', 't7', 'underpins'),
      E('e9', 't7', 't10', 'confirmed or ruled out by'),
      E('e10', 't9', 't2', 'why nobody caught it'),
      E('e11', 't10', 't11', 'requires'),
      E('e12', 't9', 't11', 'motivates'),
      E('e13', 't11', 't12', 'closes')
    ],
    groups: [],
    meta: {
      title: 'Checkout 500s — investigation',
      contextBrief: 'Node service, Postgres, Stripe. Reported by a customer, not by monitoring, which is its own problem.',
      cardStyle: 'outline',
      situation: {
        codebase: 'current',
        runtime: 'code',
        firstMove: 'read',
        repoHint: 'the checkout service',
        constraints: 'Reproduce before theorising\nDo not change behaviour while investigating\nNo dependency upgrades in the fix'
      }
    }
  }
