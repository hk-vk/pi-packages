# @hk-vk/pi-openai-fast

Enable Fast mode for models using Pi's `openai` and `openai-codex` providers.

Forked from the `openai-fast` extension in [hk-vk/pi-extensions](https://github.com/hk-vk/pi-extensions), itself forked from [Diego Petrucci's pi-extensions](https://github.com/diegopetrucci/pi-extensions).

## Features

- Toggle Fast mode for the current session with `/fast`.
- Show `fast` in the footer when the selected model is eligible and Fast mode is on.
- Check eligibility by provider and API, without a model-ID allowlist.
- Set the default and status indicator globally or per trusted project.

## Supported APIs

- `openai`: Responses and Completions
- `openai-codex`: Responses with ChatGPT OAuth

## Install

```bash
pi install /path/to/pi-packages/packages/pi-openai-fast
```

Run `/reload`, then `/fast` to enable it for the session. Fast mode is off by default.

## Configuration

Global config: `~/.pi/agent/extensions/openai-fast.json`

Project config: `<project>/.pi/openai-fast.json`

```json
{
  "enabled": false,
  "showStatus": true
}
```

Project config overrides global config in trusted projects.
