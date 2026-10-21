# Troubleshooting

## Install or rename migration

The project was previously called `pi-super-theme`; its package and directory are now `pi-super-engineering-themes`.

```sh
pi remove /Users/harikrishnan/coding/personal/pi-super-theme
pi install /Users/harikrishnan/coding/personal/pi-packages/packages/pi-super-engineering-themes
pi list
```

If the old package is no longer listed, skip removal. Do not load both old and new copies. Existing `super-workspace-*` theme names and `/super-theme` are intentionally preserved. The unrelated `pi-superconductor` CLI wrapper is not renamed or removed.

Run `/reload` in each Pi terminal to use the new extension. Already-running terminals retain their old JavaScript until reloaded; an older copy can continue regenerating its old shared theme files.

## Verify sync

Run `/super-theme`. It should report:

- The terminal's owning workspace, not merely the foreground workspace.
- Correct light/dark appearance.
- `Applied` rather than `NOT currently applied`.
- Guard marker `v0.2` and unexpected-reset repair count.
- Any failure retaining stale colors.

Read-only app checks:

```sh
sc status --json
sc layout state --self --output json
sc workspace list --json
sc workspace get WORKSPACE_ID --json
```

Use the exact ID from the app; do not invent one. A project registered in several workspaces may have ambiguous path membership, which the adapter refuses rather than guessing.

## Brief workspace-switch flash

1. Run `/super-theme` and note the repair count.
2. Switch away and back using the same shortcut that produces the flash.
3. Run `/super-theme` again.

An increased counter means the cached guard repaired a Pi theme reset. An unchanged counter with a visible flash points toward a host terminal/background/frame transition, but does not prove it. Record the transition and keep the status output when reporting it. The guard does not guarantee a completely flash-free host presentation.

## Green tool cards or blue links

Current tool panels all share a chrome-derived surface, and links inherit the workspace accent. If old green washes or fixed-blue links remain, reload the affected terminal. Existing extensions that embed literal ANSI colors may bypass theme tokens and require separate investigation; this adapter does not rewrite renderers.

## Light/dark mismatch

Super separates app-wide appearance, workspace colors, and terminal palette. The adapter reads the instance's `theme_mode` and workspace overrides. It cannot query a fully resolved terminal palette through `sc`. Make sure Super's app appearance and terminal palette are configured as expected, then run `/super-theme` to refresh. Unsupported/unreadable appearance settings preserve the last valid palette and report an error.

## Test scope

```sh
cd /Users/harikrishnan/coding/personal/pi-packages/packages/pi-super-engineering-themes
npm test
```

Tests validate palette contrast, lifecycle and isolation logic with local fixtures. Extension-load smoke tests do not prove live terminal appearance. A screen recording or in-app check is still needed for host-rendering problems.

## Uninstall

Select another theme in Pi's `/settings` first, then remove this package:

```sh
pi remove /Users/harikrishnan/coding/personal/pi-packages/packages/pi-super-engineering-themes
```

Reload affected terminals. Generated user theme files remain available; no app settings, terminal palette, or other installed theme is deleted.
