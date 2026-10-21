# Pi super.engineering Themes

**`@hk-vk/pi-super-engineering-themes`** adapts Pi's terminal UI to the light/dark appearance and workspace colors of [super.engineering](https://super.engineering/).

super.engineering is a native macOS workspace for agentic engineering: it groups projects and Git worktrees and connects coding-agent terminals, chats, and review tools to them. [Pi](https://pi.dev/) is the coding-agent CLI running inside its terminal. This package changes **Pi's presentation**, not Super's settings or app renderer. It is a local, unofficial integration, separate from the `pi-superconductor` package that exposes CLI-control tools.

## Install

```sh
pi install npm:@hk-vk/pi-super-engineering-themes
```

For local development:

```sh
pi install /Users/harikrishnan/coding/personal/pi-packages/packages/pi-super-engineering-themes
```

Then run `/reload` in each Pi session where you want the extension active.

- `/super-theme` — refresh and show owning workspace, appearance, applied/error state, and theme-reset repair count.
- `/settings` → **Theme** — inspect the installed named themes.

The monorepo folder is **`packages/pi-super-engineering-themes`** and the npm package is **`@hk-vk/pi-super-engineering-themes`**. The existing `/super-theme` command and generated theme filenames remain unchanged for compatibility.

## Features

- Verifies that this exact Pi caller is managed by Super; activates only in its TUI terminal.
- Resolves the terminal's **owning workspace**, rather than following whichever workspace is globally selected. Hidden terminals do not adopt another workspace's colors.
- Reads Super's app-wide System/Light/Dark setting and the workspace's separate light/dark chrome, accent, and highlight overrides.
- Derives readable Pi text, prompt panels, tool panels, links, syntax, borders, and selections. Links use the workspace accent; successful tools do not get a green background wash.
- Installs named light/dark themes per workspace. Different workspaces cannot overwrite one shared pair of theme files.
- Keeps the last valid palette when the app or settings are unavailable and reports stale/error state instead of claiming a successful sync.
- Uses a cached in-memory guard to repair unexpected theme resets without a CLI request or file write. No redraw when colors already match.

## How it works

1. Verify the caller with the public `sc layout state --self` command.
2. Resolve its worktree against `sc workspace list`, using canonical paths. Ambiguous membership is refused.
3. Bind to the exact workspace ID and fetch its color overrides with `sc workspace get`.
4. Read `theme_mode` from that app instance's settings file; for System mode, query macOS appearance.
5. Generate both named palettes and select the matching one through Pi's public theme API.
6. Refresh the bound workspace every five seconds; settings-file changes and `/super-theme` also refresh it.

The reset guard checks the in-memory theme every 100 ms and opportunistically on focus reports. It uses no additional CLI process. A guard repair increments the counter displayed by `/super-theme`. Resources stop on session shutdown/reload.

The extension applies Theme instances only within its Pi process; it never persists a theme selection. Your saved default remains unchanged outside Super. Named files are available for explicit manual selection. Reload every terminal running an older version: old code may still persist a Super theme. The cached guard repairs reload resets locally without changing global settings.

## Readability and limitations

The generator targets at least **7:1 computed sRGB contrast** for every foreground against its generated page and panel backgrounds. User prompts use a distinct surface; tool panels use restrained workspace-derived colors. Conventional success/error/diff foreground hues remain semantic rather than exact copies of Super.

**These are palette calculations, not measurements of your screen.** Super's terminal palette is configured separately from workspace chrome. The public CLI exposes workspace overrides, not the complete resolved terminal palette or the current appearance. Defaults are used for missing overrides; chrome intensity/alpha and prominence are interpreted by this adapter, not by Super's internal rendering code. Transparent chrome cannot be reproduced exactly in an opaque terminal panel.

Pi does not expose a root-background theme token. Super still paints the terminal canvas. Terminal color approximations, external renderers using hardcoded ANSI colors, and transient host terminal frames may differ. The extension does not override individual tool/message renderers or guarantee a zero-frame workspace-switch transition.

## Documentation

- [Integration architecture and token mapping](docs/integration.md)
- [Troubleshooting and verification](docs/troubleshooting.md)
- [super.engineering documentation](https://super.engineering/docs/)
- [Super themes and appearance](https://super.engineering/docs/themes-and-appearance/)
- [Super CLI automation](https://super.engineering/docs/cli-local-api/)
- [Pi themes](https://pi.dev/docs/latest/themes)
- [Pi extensions](https://pi.dev/docs/latest/extensions)

## Development

```sh
cd /Users/harikrishnan/coding/personal/pi-packages/packages/pi-super-engineering-themes
pnpm test
```

Tests cover both appearances' contrast, semantic mapping, workspace isolation, concurrent theme installs, scope checks, CLI identity, reload recovery, proxy-aware matching, cached guard behavior, cleanup, and stale/error recovery. Live switching still needs testing in the app.

The repository-only `reports/contrast-audit.json` is a historical local snapshot comparing built-in/installed themes on their declared panels. It is not a screen measurement or a continuously updated benchmark. Null means a terminal-default, indexed, or missing color prevented a reliable calculation.

Implementation references are the official Pi docs, extension examples, public Super docs, and observed `sc` output.
