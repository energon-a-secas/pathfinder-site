import { ui, saveState, saveStatus } from './state.js'
import { exportJSON } from './export.js'

export function setupPersistence() {
  const host = document.getElementById('saveStatusBar')
  if (!host) return
  if (ui.readOnly || ui.embed) { host.hidden = true; return }
  const status = document.getElementById('saveStatusText')
  const detail = document.getElementById('saveStatusDetail')
  const retry = document.getElementById('saveRetry')
  const backup = document.getElementById('saveBackup')
  const refresh = () => {
    host.dataset.phase = saveStatus.phase
    status.textContent = saveStatus.phase === 'error' ? 'Not saved'
      : saveStatus.phase === 'pending' ? 'Saving…'
      : saveStatus.phase === 'saved' ? 'Saved locally' : 'Local map'
    detail.textContent = saveStatus.message
    detail.hidden = !saveStatus.message
    retry.hidden = saveStatus.phase !== 'error'
    backup.hidden = saveStatus.phase !== 'error'
    host.title = saveStatus.savedAt ? 'Last saved at ' + new Date(saveStatus.savedAt).toLocaleTimeString() : ''
  }
  retry.addEventListener('click', saveState)
  document.getElementById('saveBackup').addEventListener('click', exportJSON)
  window.addEventListener('pf:save-status', refresh)
  const flush = () => {
    if (saveStatus.phase === 'pending' || saveStatus.phase === 'error') return saveState()
    return true
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush() })
  window.addEventListener('pagehide', flush)
  window.addEventListener('beforeunload', e => {
    if (!flush()) { e.preventDefault(); e.returnValue = '' }
  })
  refresh()
}
