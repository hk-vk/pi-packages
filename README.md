# Pi packages

A collection of Pi coding-agent extensions and packages, maintained in a pnpm monorepo.

Each package is independently versioned and published under the `@hk-vk` npm scope.

## Packages

| Package | Description |
| --- | --- |
| `@hk-vk/pi-package-search` | Browse, inspect, and install packages from the official Pi catalog. |
| `@hk-vk/pi-skill-shortcut` | Codex-style `$skill-name` autocomplete and explicit skill invocation for Pi. |
| `@hk-vk/pi-edit-footer` | Configure Pi footer and status-bar items in realtime. |
| `@hk-vk/pi-skill-router` | Reduce Pi context usage by loading skills on demand instead of injecting the full catalog. |
| `@hk-vk/pi-sudo-auth` | Authenticate macOS sudo commands with a masked native Pi prompt. |

## Development

```bash
pnpm install
pnpm check
pnpm test
pnpm run pack
```

To verify the npm release without uploading packages:

```bash
pnpm run publish:dry
```

After reviewing the package tarballs and logging in to npm:

```bash
pnpm run publish
```
