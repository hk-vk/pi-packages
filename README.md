# Pi packages

A scoped monorepo for Pi coding-agent extensions.

Repository: https://github.com/hk-vk/pi-packages

## Packages

| Package | Description | Pi resource | Status |
| --- | --- | --- | --- |
| `@hk-vk/pi-package-search` | Browse, inspect, and install packages from the official Pi catalog. | `./index.ts` | Ready locally |
| `@hk-vk/pi-skill-shortcut` | Codex-style `$skill-name` autocomplete and explicit skill invocation for Pi. | `./index.ts` | Ready locally |
| `@hk-vk/pi-edit-footer` | Configure Pi footer and status-bar items in realtime. | `./index.ts` | Ready locally |
| `@hk-vk/pi-skill-router` | Reduce Pi context usage by loading skills on demand instead of injecting the full catalog. | `./extensions` | Ready locally |
| `@hk-vk/pi-sudo-auth` | Authenticate macOS sudo commands with a masked native Pi prompt. | `./extensions/sudo-auth.ts` | Ready locally |

Every package has a `pi` manifest, the `pi-package` keyword, public scoped npm publishing metadata, a README, and a license.

## Development

```bash
pnpm install
pnpm check
pnpm test
pnpm pack
```

`pnpm publish:dry` validates the recursive public publish without uploading anything. Publish only after logging into npm and reviewing the package tarballs:

```bash
pnpm publish
```
