# @hk-vk/pi-skill-router

Reduce Pi context usage by loading skills on demand instead of injecting the full catalog.

## Install

```bash
pi install npm:@hk-vk/pi-skill-router
```

Commands:

```text
/skill-router-status
/skill-router-hide
/skill-router-restore
```

The extension keeps `/skill:name` available while exposing `skill_search` and `skill_read` for on-demand discovery.
