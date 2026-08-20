# Pi packages

A collection of Pi coding-agent extensions and packages, maintained in a pnpm monorepo.

Each package is independently versioned and published under the `@hk-vk` npm scope.

## Packages

| Package | Description | Install |
| --- | --- | --- |
| `@hk-vk/pi-package-search` | Browse, inspect, and install packages from the official Pi catalog. | `pi install npm:@hk-vk/pi-package-search` |
| `@hk-vk/pi-skill-shortcut` | Codex-style `$skill-name` autocomplete and explicit skill invocation for Pi. | `pi install npm:@hk-vk/pi-skill-shortcut` |
| `@hk-vk/pi-edit-footer` | Configure Pi footer and status-bar items in realtime. | `pi install npm:@hk-vk/pi-edit-footer` |
| `@hk-vk/pi-skill-router` | Reduce Pi context usage by loading skills on demand instead of injecting the full catalog. | `pi install npm:@hk-vk/pi-skill-router` |
| `@hk-vk/pi-sudo-auth` | Authenticate macOS sudo commands with a masked native Pi prompt. | `pi install npm:@hk-vk/pi-sudo-auth` |

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
