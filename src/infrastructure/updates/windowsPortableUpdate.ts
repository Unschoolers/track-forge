interface TauriWindows {
  readonly core?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> }
}

export function isPortableWindows(): boolean {
  return typeof (window as Window & { __TAURI__?: TauriWindows }).__TAURI__?.core?.invoke === 'function'
}

/** Open the official EXE URL via Windows ShellExecute/Explorer, never modify the running binary. */
export async function downloadWindowsUpdate(version: string): Promise<void> {
  const invoke = (window as Window & { __TAURI__?: TauriWindows }).__TAURI__?.core?.invoke
  if (!invoke) throw new Error('Windows desktop update bridge is unavailable.')
  await invoke('desktop_download_update', { tag: version })
}
