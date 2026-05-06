# Visual Design Recommendations - Team Mode

## Design Philosophy

**Current:** Single-user tool with static UI
**Target:** Dynamic multiplayer meeting facilitator

Key principle: **Make collaboration visible** - everyone should see who's doing what in real-time, but without visual noise.

---

## 🎨 Visual Changes by Component

### 1. Header Bar (Presence Indicator)

**Current:**
```
[Logo]  Pathfinder    Export ▾  Share      [Icons] [Help]
```

**New (Team Mode):**
```
[Logo]  Pathfinder    🟢 4 here  ⏱️ 03:42  Facilitate  Export  Share  [Theme]
           ├─ L  ├─ M  ├─ S  └─ J
```

**Design Spec:**
- **Presence avatars:** 28x28px circles with initials
  - Green border = actively editing (last action < 30s)
  - Gray border = viewing (last action < 5min)
  - Dotted border = away
- **Timer:**```
  ⏱️ 03:42 (green when > 3min left)
  ⏱️ 00:42 (orange when < 1min)
  ⏱️ 00:00 (red, pulses, play alert sound)
```

**CSS:**
```css
.presence-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  background: rgba(99, 102, 241, 0.1);
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
}

.presence-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--user-color), rgba(255,255,255,0.2));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  border: 2px solid var(--status-color);
  box-shadow: 0 0 0 1px rgba(255,255,255,0.1);
}

.timer-widget {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  background: rgba(16, 185, 129, 0.1);
  border-radius: 16px;
}

.timer-display {
  font-family: 'JetBrains Mono', monospace;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.timer-display.warning {
  color: #f59e0b; /* amber-500 */
  animation: pulse 1s infinite;
}

.timer-display.critical {
  color: #ef4444; /* red-500 */
  animation: pulse 0.5s infinite;
}
```

---

### 2. Block Voting Dots

**Current:**
```
┌─────────────────┐
│ [Type]    ⌄     │
│                 │
│ Block Title     │
│                 │
└─────────────────┘
```

**New (with votes):**
```
┌─────────────────┐
│ [Type] 🗳️ 8   ⌄ │
│                 │
│ Block Title     │
│                 │
│  🔵🔵🔵🔵🔵      │  ← 5 dots (colored by voter)
│   (my dots)     │
└─────────────────┘
```

**Design Spec:**
- Vote indicator: `🗳️` emoji + total count in header
- Dot row: Below description, 24px tall
- Dot size: 12px diameter
- My dots: Solid color (user's theme color)
- Others' dots: Semi-transparent (0.6 opacity)
- Hover dot: Shows voter name in tooltip

**CSS:**
```css
.block-votes {
  display: flex;
  gap: 4px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255,255,255,0.08);
}

.vote-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--user-color);
  cursor: pointer;
  transition: transform 0.15s ease;
}

.vote-dot:hover {
  transform: scale(1.3);
}

.vote-dot.others {
  opacity: 0.6;
}

.vote-empty {
  width: 12px;
  height: 12px;
  border: 1px dashed rgba(255,255,255,0.3);
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s ease;
}

.vote-empty:hover {
  border-style: solid;
  border-color: var(--user-color);
  background: rgba(255,255,255,0.1);
}
```

**Interaction:**
- Single click: Add 1 dot (if have dots remaining)
- Shift+click: Remove 1 dot
- Right-click: Remove all my dots from this block

---

### 3. Live Cursors

**When other users move their mouse:**
```
┌─────────────────┐
│ Block Title     │
      ↖
  ┌─────┐
  │  S  │  ← Sarah's cursor
  └─────┘
```

**Design Spec:**
- Cursor indicator: Small dot (8px) + name tag
- Only shows when user is active (moved in last 5s)
- Fades out after 2s of inactivity
- Color: User's theme color
- Smooth interpolation (not jerky)

**CSS:**
```css
.live-cursor {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--user-color);
  pointer-events: none;
  z-index: 1000;
  transition: transform 0.1s ease-out;
}

.cursor-label {
  position: absolute;
  top: 12px;
  left: 4px;
  background: rgba(0,0,0,0.8);
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.live-cursor.active .cursor-label {
  opacity: 1;
}
```

**Throttling:** Send cursor position max 10x/sec (100ms intervals)

---

### 4. Meeting Mode Sidebar

**Current Right Panel:**
```
┌─────────────────┐
│ Inspector | Prompt│
├─────────────────┤
│ [Block details] │
│                 │
│ [Prompt output] │
└─────────────────┘
```

**New Meeting Mode:**
```
┌─────────────────┐
│ Inspector | Prompt│  ← Collapsible
├─────────────────┤
│ ⏱️  05:23       │  ← Timer always visible
├─────────────────┤
│ Meeting:        │
│ Sprint Planning │
├─────────────────┤
│ Phase 2 of 5    │
│ 🟢 Brainstorm   │
│ ⭕ Voting        │
│ ⭕ Planning      │
│ ⭕ Assign        │
│ ⭕ Close         │
├─────────────────┤
│ Next Phase →    │  ← Big button
└─────────────────┘
```

**Design Spec:**
- Meeting mode is collapsible (facilitators can hide when not needed)
- Timer always visible at top (even when collapsed)
- Phase progress shows all 5 phases
- Current phase: green dot + bold
- Completed: checkmark
- Future: empty circle
- "Next Phase" button: large, prominent (50px tall)

**CSS:**
```css
.meeting-sidebar {
  background: rgba(30, 41, 59, 0.95); /* slate-800 */
  border-left: 1px solid rgba(148, 163, 184, 0.2);
  padding: 16px;
  font-size: 13px;
}

.phase-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0;
}

.phase-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  opacity: 0.6;
  transition: all 0.2s ease;
}

.phase-item.current {
  opacity: 1;
  background: rgba(99, 102, 241, 0.15);
  font-weight: 600;
}

.phase-item.completed {
  opacity: 1;
  color: #10b981; /* emerald-500 */
}

.phase-icon {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid currentColor;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
}

.next-phase-btn {
  width: 100%;
  padding: 12px 16px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: transform 0.15s ease;
}

.next-phase-btn:hover {
  transform: translateY(-1px);
}

.next-phase-btn:active {
  transform: translateY(0);
}
```

**Interaction:**
- Click "Next Phase":
  - Timer resets
  - Next phase becomes active (green)
  - Old phase shows checkmark
  - Brief toast message ("Now: Voting Phase")

---

### 5. Voting Results View

**When timer ends on voting phase:**

**Canvas auto-arranges:**
```
┌─────────────────┐  ┌─────────────────┐
│ [Winner]        │  │ [2nd place]     │
│ Block C         │  │ Block A         │
│ 🗳️ 12           │  │ 🗳️ 9            │
└─────────────────┘  └─────────────────┘
         ↓                     ↓
    ┌──────────┐        ┌──────────┐
    │ Winner!  │        │ Consider │
    └──────────┘        └──────────┘
```

**Auto-sort by votes:**
```javascript
function autoSortByVotes() {
  const blocksWithVotes = Object.values(state.blocks)
    .map(b => ({
      ...b,
      voteCount: Object.values(b.votes || {}).reduce((s, v) => s + v.dots, 0)
    }))
    .sort((a, b) => b.voteCount - a.voteCount)

  // Space them out horizontally
  blocksWithVotes.forEach((b, i) => {
    b.x = 200 + i * 280
    b.y = 200
  })

  // Add visual indicators
  if (blocksWithVotes[0]) addWinnerBadge(blocksWithVotes[0].id)
  if (blocksWithVotes[1]) addRunnerUpBadge(blocksWithVotes[1].id)
}
```

**CSS for badges:**
```css
.vote-winner-badge {
  position: absolute;
  top: -12px;
  right: -12px;
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  color: #000;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 700;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-4px); }
}
```

---

### 6. Presentation Mode

**Enable with Ctrl+P:**
```
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║                         FULL SCREEN                          ║
║                                                              ║
║  ┌─────────────────┐        ┌─────────────────┐             ║
║  │                 │        │                 │             ║
║  │   Block 1       │        │   Block 2       │             ║
║  │                 │        │                 │             ║
║  └─────────────────┘        └─────────────────┘             ║
║                                                              ║
║  [ ← Previous ]  [Next → ]  [Exit Esc ]  [Fit All]          ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

**CSS:**
```css
.presentation-mode {
  overflow: hidden;
}

.presentation-mode .header-bar,
.presentation-mode .palette,
.presentation-mode .right-panel {
  display: none !important;
}

.presentation-mode .canvas-viewport {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  border: none;
}

.presentation-controls {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(15, 23, 42, 0.92);
  backdrop-filter: blur(16px);
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.presentation-controls button {
  padding: 8px 16px;
  background: rgba(99, 102, 241, 0.2);
  color: #e0e7ff;
  border: none;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease;
}

.presentation-controls button:hover {
  background: rgba(99, 102, 241, 0.35);
}
```

---

### 7. Block Comments UI

**Comment count badge on block:**
```
┌─────────────────┐
│ [Type] 💬 3   ⌄ │
│                 │
│ Block Title     │
│                 │
└─────────────────┘
```

**Click to open comment thread:**
```
┌─────────────────────────┐
│ Comments (3)        [×] │
├─────────────────────────┤
│ 💬 User A: This is a   │
│    comment              │
│    2m ago            […]│
├─────────────────────────┤
│ 💬 User B: I agree    │
│    5m ago            […]│
├─────────────────────────┤
│ [Add comment…]         │
│ [Send]                 │
└─────────────────────────┘
```

**CSS:**
```css
.comment-indicator {
  position: absolute;
  top: 8px;
  right: 40px; /* Between type badge and collapse btn */
  background: rgba(99, 102, 241, 0.2);
  color: #c7d2fe;
  padding: 2px 6px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.comment-indicator:hover {
  background: rgba(99, 102, 241, 0.35);
  transform: scale(1.05);
}

.comment-thread {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 8px;
  width: 280px;
  max-height: 400px;
  background: rgba(15, 23, 42, 0.98);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  backdrop-filter: blur(16px);
  z-index: 100;
  overflow: hidden;
  box-shadow: 0 10px 25px rgba(0,0,0,0.4);
}

.comment-item {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.comment-author {
  font-weight: 600;
  font-size: 12px;
  color: #e0e7ff;
}

.comment-text {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.4;
  color: #cbd5e1;
}

.comment-time {
  margin-top: 4px;
  font-size: 11px;
  color: #94a3b8;
}
```

---

### 8. Share Dialog Redesign

**Current:**
```
Share
├─ Copy link
├─ Copy view-only link
└─ Copy embed code
```

**New:**
```
📤 Share Canvas
├─ 🔗 Copy edit link      [Team members can edit]
├─ 👁️  Copy view link      [Stakeholders - read only]
├─ 📧 Email invite...      [Send to team]
│                          To: [________] [Add]
│                          [Send Invites]
├─ ⚙️  Permissions         [Who can edit: ]
│                          ○ Anyone with link
│                          ○ Only invited
└─ 📊 Export summary       [Meeting notes]
```

**CSS:**
```css
.share-permissions {
  padding: 12px;
  background: rgba(30, 41, 59, 0.5);
  border-radius: 8px;
  margin-top: 8px;
}

.permission-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  cursor: pointer;
}

.permission-option input[type="radio"] {
  width: 16px;
  height: 16px;
  accent-color: #6366f1;
}

.email-invite {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.email-invite input {
  flex: 1;
  padding: 8px 12px;
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 6px;
  color: #e2e8f0;
}

.email-invite button {
  padding: 8px 16px;
  background: #6366f1;
  color: white;
  border: none;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
}
```

---

### 9. Action Items Badge

**On Decision blocks:**
```
┌─────────────────┐
│ Decision       ⌄│
│                 │
│ Use PostgreSQL  │
│                 │
│ [Action Items]  │  ← New badge
│ Assigned to: L  │
│ Due: 2026-03-21 │
└─────────────────┘
```

**CSS:**
```css
.action-item-badge {
  display: inline-block;
  padding: 2px 8px;
  background: linear-gradient(135deg, #10b981, #059669);
  color: white;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  margin-top: 8px;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.action-item-badge:hover {
  transform: scale(1.05);
}

.action-details {
  margin-top: 6px;
  font-size: 12px;
  color: #94a3b8;
}
```

---

### 10. Toast Notifications

**For team events:**
```
┌─────────────────────────┐
│ 🗳️ Sarah voted on       │
│ "Database Issue"       │
└─────────────────────────┘
  (slides in from top-right, stays 3s)
```

**CSS:**
```css
.toast-notification {
  position: fixed;
  top: 24px;
  right: 24px;
  max-width: 300px;
  padding: 12px 16px;
  background: rgba(15, 23, 42, 0.98);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 8px;
  backdrop-filter: blur(16px);
  z-index: 10000;
  animation: slideInRight 0.3s ease;
  box-shadow: 0 8px 20px rgba(0,0,0,0.3);
}

@keyframes slideInRight {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes slideOutRight {
  from {
    transform: translateX(0);
    opacity: 1;
  }
  to {
    transform: translateX(100%);
    opacity: 0;
  }
}

.toast-exiting {
  animation: slideOutRight 0.3s ease forwards;
}
```

**Usage:**
```javascript
function showToast(message, type = 'info', duration = 3000) {
  const toast = document.createElement('div')
  toast.className = `toast-notification toast-${type}`
  toast.innerHTML = message
  document.body.appendChild(toast)

  setTimeout(() => {
    toast.classList.add('toast-exiting')
    setTimeout(() => toast.remove(), 300)
  }, duration)
}

// Team events
showToast('🗳️ Sarah voted on "DB Issue"')
showToast('✏️ Luciano is editing "Goal 1"')
showToast('➕ Marco added a Risk block', 'success')
showToast('⏰ Time for the next phase', 'warning')
```

---

## 🎨 Color Palette for Team Features

### User Colors (Distinct, accessible)
```css
:root {
  --user-sarah: #ef4444;   /* red-500 */
  --user-luciano: #3b82f6; /* blue-500 */
  --user-marco: #10b981;   /* emerald-500 */
  --user-alex: #f59e0b;    /* amber-500 */
  --user-maya: #8b5cf6;    /* violet-500 */
  --user-others: #6b7280;  /* gray-500 */
}
```

### Status Indicators
```css
.online { background: #10b981; }
.away { background: #f59e0b; }
.offline { background: #6b7280; }
.editing { animation: pulse-green 1.5s infinite; }
```

---

## 💻 Responsive Design Notes

### Mobile (max-width: 768px)
- **Presence indicator:** Collapse avatars to just count
  - "4 here" with dropdown showing names
- **Timer:** Always visible at top (replaces some header elements)
- **Voting:** Dots are larger (16px) for touch
- **Comments:** Full-screen modal instead of popover

### Tablet (768px - 1024px)
- **Meeting sidebar:** Collapsible to save space
- **Presence:** Show 3 avatars, +N more

---

## 🎬 Animation Guidelines

### Transitions
- **Cursor movement:** 0.1s ease-out (feels responsive)
- **Vote updates:** 0.2s ease (celebratory)
- **Phase changes:** 0.3s ease (significant moment)
- **Toast notifications:** 0.3s ease (attention-grabbing)

### Hover Effects
- **Block highlight:** Subtle scale (1.02) + glow
- **Buttons:** Lift (translateY -1px) + shadow
- **Voting dots:** Grow + tooltip

### Micro-interactions
- **Adding vote:** Dot appears with scale(0) → scale(1.2) → scale(1)
- **Timer ending:** Pulse animation + color change
- **New comment:** Badge bounce

---

## 🎯 Implementation Priority

**Critical for MVP:**
1. Presence indicator (avatars in header)
2. Timer widget (essential for meeting flow)
3. Voting dots (block-level visual)
4. Live cursors (real-time feel)
5. Toast notifications (feedback)

**Nice to have:**
6. Presentation mode (polish)
7. Comment UI (good but complex)
8. Share dialog (slower iteration)

---

## 📱 Quick Comparison: Before vs After

**Feature** | **Before** | **After** | **Impact**
---|---|---|---
Users editing | ❌ Unknown | 🟢 4 live cursors | High
Time remaining | ❌ No timer | ⏱️ 03:42 | High
Team consensus | ❌ Discussion | 🗳️ Dot voting | Critical
Who's online | ❌ Guessing | 👥 Avatar list | Medium
Meeting flow | ❌ Unstructured | 📋 5 phases | High
Visual clutter | ⚠️ Busy UI | 🎬 Presentation mode | Medium

---

## 🎲 Edge Cases

**50+ users:**
- Show only first 6 avatars
- "+42 more" indicator
- Click to see full list

**Timer on mobile:**
- Sticky at top even when scrolling
- Large touch target (44px min)

**Voting with no votes:**
- Show "No votes yet" helper text
- Auto-prompt: "Click blocks to vote!"

**Presentation mode with no blocks:**
- Show "Add blocks to start presenting"
- Disable "Next" button

---

## 🎨 Conclusion

The visual changes focus on **making invisible work visible**:
- Who's participating (presence)
- How much time is left (timer)
- What the team thinks (voting)
- Where we are (meeting phases)
- What happened (toasts)

This transforms Pathfinder from a beautiful but solitary tool into a vibrant, multiplayer workspace.
