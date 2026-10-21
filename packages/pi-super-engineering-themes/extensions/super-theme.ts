import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { installThemes } from '../src/theme-files.mjs';
import { startThemeGuard } from '../src/guard.mjs';
import { Theme, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { isSuper, settingsPath, startSync } from '../src/sync.mjs';
import { scClient, verifyCaller, sessionWorkspace, workspaceById } from '../src/sc.mjs';
import { themeMatches, backgroundTokens } from '../src/palette.mjs';

const tokens: string[] = JSON.parse(readFileSync(new URL('../src/tokens.json', import.meta.url), 'utf8'));

export default function(pi: ExtensionAPI) {
 let sync: ReturnType<typeof startSync> | undefined;
 let controller: AbortController | undefined;
 let lastError: string | undefined;
 let appliedTheme: Theme | undefined;
 let guard: ReturnType<typeof startThemeGuard> | undefined;
 let repairs = 0;
 const stop = () => { guard?.stop(); guard = undefined; sync?.stop(); sync = undefined; controller?.abort(); controller = undefined; appliedTheme = undefined; repairs = 0; };
 pi.on('session_start', async (_event, ctx) => {
  stop();
  if (ctx.mode !== 'tui' || !isSuper(process.env)) return;
  const abort = new AbortController(); controller = abort;
  const sc = scClient({ cwd: ctx.cwd, signal: abort.signal });
  try {
   if (!(await verifyCaller(sc)) || abort.signal.aborted) return;
   // Bind once. Switching the foreground app workspace must not change a
   // hidden terminal's palette; refresh only this exact workspace thereafter.
   const owner = await sessionWorkspace(sc, ctx.cwd);
   if (abort.signal.aborted) return;
   sync = startSync({
    path: settingsPath(process.env),
    workspace: () => workspaceById(sc, owner.id),
    isApplied: () => themeMatches(ctx.ui.theme, appliedTheme, tokens),
    apply: async ({mode, theme, workspaceId}) => {
     if (abort.signal.aborted) return false;
     const themes = await installThemes(join(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent'), 'themes'), theme, tokens, workspaceId);
     if (abort.signal.aborted) return false;
     const { name, path, colors } = themes[mode];
     const fg = Object.fromEntries(Object.entries(colors).filter(([key]) => !backgroundTokens.includes(key)));
     const bg = Object.fromEntries(Object.entries(colors).filter(([key]) => backgroundTokens.includes(key)));
     // Theme objects apply only to this process. Never call setTheme(name):
     // that API persists to global settings and leaks Super colors into other
     // Pi terminals. Named files remain available for explicit manual use.
     // The cached guard repairs Pi's post-/reload saved-theme pass locally.
     // Older Pi hosts ignore appearance; newer hosts can use the hint.
     const themeOptions = { name, sourcePath: path, appearance: mode };
     const nextTheme = new Theme(fg as any, bg as any, ctx.ui.theme.getColorMode(), themeOptions);
     const result = ctx.ui.setTheme(nextTheme);
     if (result.success) appliedTheme = nextTheme;
     lastError = result.success ? undefined : result.error;
     return result.success;
    },
   });
   await sync.ready;
   if (abort.signal.aborted) return;
   guard = startThemeGuard({
    matches: () => !appliedTheme || themeMatches(ctx.ui.theme, appliedTheme, tokens),
    restore: () => {
     if (abort.signal.aborted || !appliedTheme) return;
     const result = ctx.ui.setTheme(appliedTheme);
     if (result.success) repairs++;
    },
    onInput: handler => ctx.ui.onTerminalInput(handler),
   });
  } catch (error) {
   if (!abort.signal.aborted) lastError = error instanceof Error ? error.message : String(error);
  }
 });
 pi.on('session_shutdown', stop);
 pi.registerCommand('super-theme', {
  description: 'Refresh and show the installed Super workspace theme status',
  handler: async (args, ctx) => {
   // Also repairs Pi's post-/reload reapplication of the saved theme.
   await sync?.refresh();
   const state = sync?.status();
   const error = sync?.health().error || lastError;
   const applied = state && themeMatches(ctx.ui.theme, appliedTheme, tokens);
   const message = state
    ? `Super theme: ${state.workspaceName} / ${state.mode}. ${applied ? 'Applied' : 'NOT currently applied'}. Workspace-isolated; cached guard active (v0.2). Unexpected theme resets repaired: ${repairs}.${error ? ' Retaining previous colors: '+error : ''}`
    : `Super theme not synced${error ? ': '+error : '; requires a verified Super terminal and readable appearance settings'}.`;
   ctx.ui.notify(message, applied && !error ? 'info' : 'warning');
  },
 });
}
