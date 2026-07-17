export async function windowAction(action: 'minimize' | 'maximize' | 'close') {
  if (!window.__TAURI_INTERNALS__) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const current = getCurrentWindow()
  if (action === 'minimize') await current.minimize()
  if (action === 'maximize') await current.toggleMaximize()
  if (action === 'close') await current.close()
}

export async function pickDirectory(defaultPath?: string): Promise<string | null> {
  if (!window.__TAURI_INTERNALS__) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({ directory: true, multiple: false, defaultPath })
  return typeof selected === 'string' ? selected : null
}

