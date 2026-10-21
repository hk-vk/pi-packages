import { watchFile, unwatchFile } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';

export function isSuper(env) {
  return /^(superconductor|super\.engineering)$/i.test(env.TERM_PROGRAM || '') &&
    Boolean(env.SUPER_ENGINEERING_TERMINAL_ID || env.SUPERCONDUCTOR_TERMINAL_ID);
}
export function settingsPath(env, home = homedir()) {
  const socket = env.SUPER_ENGINEERING_LOCAL_API_SOCKET || env.SUPERCONDUCTOR_LOCAL_API_SOCKET;
  // Use this instance's profile, not whichever app profile happens to exist.
  return socket && socket.startsWith('/') ? join(dirname(socket), 'settings.json') : join(home, '.super.engineering/settings.json');
}
export function appearance(mode, system) {
  const value = typeof mode === 'string' ? mode.toLowerCase() : '';
  if (value === 'light' || value === 'dark') return value;
  if (value === 'system' || value === 'auto') return system;
  return undefined;
}
export function systemAppearance() {
  return new Promise(resolve => {
    if (process.platform !== 'darwin') return resolve(undefined);
    execFile('/usr/bin/defaults', ['read', '-g', 'AppleInterfaceStyle'], { timeout: 1000 }, (error, stdout) => {
      if (!error) resolve(stdout.trim().toLowerCase() === 'dark' ? 'dark' : 'light');
      else if (error.code === 1) resolve('light');
      else resolve(undefined);
    });
  });
}

export function startSync({ path, apply, workspace, isApplied = () => true, read = () => readFile(path, 'utf8'), system = systemAppearance,
  watch = cb => { watchFile(path, { persistent: false, interval: 1000 }, cb); return () => unwatchFile(path, cb); },
  every = cb => { const timer = setInterval(cb, 5000); timer.unref(); return () => clearInterval(timer); } }) {
  let closed = false, busy = false, pending = false, current, signature, error;
  async function refresh() {
    if (closed) return;
    if (busy) { pending = true; return; }
    busy = true;
    try {
      const settings = JSON.parse(await read());
      const followSystem = ['system', 'auto'].includes(String(settings.theme_mode).toLowerCase());
      const mode = appearance(settings.theme_mode, followSystem ? await system() : undefined);
      if (!mode) throw new Error('Super appearance is unknown; retaining previous theme');
      const active = await workspace();
      const next = { mode, workspaceId: active.id, workspaceName: active.name, theme: active.theme ?? {} };
      const key = JSON.stringify(next);
      if (!closed && (key !== signature || !isApplied())) {
        if (await apply(next) === false) throw new Error('Pi did not accept the generated theme');
        current = next; signature = key;
      }
      error = undefined;
    } catch (cause) {
      // Atomic saves, missing files and invalid JSON preserve the last valid
      // theme, but expose stale/error state rather than claiming success.
      if (!closed) error = cause instanceof Error ? cause.message : String(cause);
    }
    finally { busy = false; if (pending && !closed) { pending = false; void refresh(); } }
  }
  const stopWatch = watch(() => void refresh());
  const stopTimer = every(() => void refresh());
  const ready = refresh();
  return { ready, refresh, status: () => current, health: () => ({ error, stale: Boolean(error), closed }), stop() { closed = true; stopWatch(); stopTimer(); } };
}
