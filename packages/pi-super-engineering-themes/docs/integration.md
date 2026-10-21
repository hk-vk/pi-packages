# Integration: Pi and super.engineering

## The two systems

[super.engineering](https://super.engineering/docs/) is the host macOS app. Workspaces own projects, color overrides, layouts, and scoped defaults; worktrees own checked-out files, terminal sessions, and task state. Its interface is native Rust/Metal; embedded browser/HTML surfaces use WebKit, not Electron.

[Pi](https://pi.dev/) is a separate coding-agent process inside a Super terminal. Its extension API controls Pi themes, not the host's native UI. Theme changes use `ctx.ui.setTheme(name | Theme)`; semantic tokens style standard components and extensions that follow Pi's theme API.

This integration is **not** related to other public repositories or products named Superconductor. The current host is super.engineering. Legacy `SUPERCONDUCTOR_*` environment names and `~/.superconductor` paths remain compatibility inputs; upgraded `~/.super.engineering` paths may resolve to that storage.

## Verified inputs

The extension first checks the terminal environment, then requires a managed Pi target from the public CLI. CLI presence alone is not caller verification.

```sh
sc layout state --self --output json
sc workspace list --json
sc workspace get WORKSPACE_ID --json
```

Every process is launched with argv and `shell: false`; no local API internals or mutations are used. The inherited socket selects the caller's instance. Requests have a timeout, output limit, and shutdown cancellation.

Workspace ownership is found by canonical worktree-path membership, using the longest matching root. Missing/ambiguous membership is an error. After initial resolution, refreshes query only the bound ID; selecting another workspace does not retarget a background terminal.

## Source-to-Pi mapping

| Source | Pi use |
|---|---|
| Instance settings `theme_mode` | Select light/dark; System/Auto uses macOS appearance |
| `theme.light` / `theme.dark` | Independent palette inputs for each appearance |
| `chrome.hue/saturation/brightness` | Workspace tint and fallback accent hue |
| `chrome.intensity/alpha` | Strength of generated opaque surfaces; not exact transparency |
| `accent.hue/saturation/brightness/prominence` | Borders, links, headings, syntax accents, custom labels |
| `accent_style` | Harmonized versus vivid accent treatment |
| `highlight.hue/saturation/brightness/prominence` | Selected/search panel tint |
| Pi semantic roles | Foreground contrast adjustment and conventional success/error/diff hues |

Super's terminal ANSI/foreground/background palette is separate from workspace chrome. `sc workspace get` returns overrides, not a fully resolved terminal RGB palette. Missing channels use conservative defaults. Derivation is intentionally contrast-limited; it does not promise exact RGB equality with the host.

## Persistence and reload

Both palettes are atomically written under Pi's user theme directory (`PI_CODING_AGENT_DIR`, otherwise `~/.pi/agent`):

```text
themes/super-workspace-<workspace-hash>-light.json
themes/super-workspace-<workspace-hash>-dark.json
```

A deterministic hash separates workspace theme names without putting arbitrary names/IDs into file paths. It is not an identifier used for CLI targeting; CLI calls preserve the exact app ID.

Only a fresh `Theme` instance is applied. The extension never selects a theme by name, because that API persists a global setting and leaks workspace colors into unrelated terminals. Generated files remain available for explicit manual selection. The in-memory guard repairs reload resets locally; the saved default remains unchanged. Reload older running copies to stop their previous global-persistence behavior.

Pi exposes `ctx.ui.theme` through a proxy. Equality by object identity is invalid. The integration compares theme name, appearance, and rendered semantic ANSI tokens instead.

## Timing and cleanup

- Bound workspace refresh: five seconds; one `workspace get` per poll.
- Settings-file check: one second; manual `/super-theme` refresh is also available.
- In-memory reset guard: 100 ms and focus reports when the terminal provides them.
- Matching palette: no file rewrite or theme redraw.
- Read/CLI failure: retain last valid palette; status reports stale/error state.
- Shutdown/reload: cancel CLI requests and stop timers, file watchers, and input subscriptions.

The guard can repair a Pi-side reset; it cannot synchronize Super's terminal presentation atomically with a workspace switch. A visible flash with no recorded Pi reset needs host-side investigation.

## Official references

### super.engineering

- [Overview](https://super.engineering/docs/)
- [Workspace model](https://super.engineering/docs/workspaces-and-branches/)
- [Themes and appearance](https://super.engineering/docs/themes-and-appearance/)
- [Public CLI](https://super.engineering/docs/cli-local-api/)

### Pi

- [Themes](https://pi.dev/docs/latest/themes)
- [Extensions](https://pi.dev/docs/latest/extensions)
- [Terminal UI](https://pi.dev/docs/latest/tui)
- [Packages](https://pi.dev/docs/latest/packages)

Installed Pi docs/types remain authoritative for the runtime API; `sc help` is authoritative for the installed CLI build.
