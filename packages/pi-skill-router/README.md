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

The skill catalog loads once in the background at startup and stays cached until `/reload`. Prompt submission never waits for scanning. Search/read/status requests wait for the initial load if needed; `skill_read` reads only the selected file. After adding skills or using hide/restore, run `/reload` to refresh the catalog.

Run the cache regression tests with `node --test test/cache.test.mjs` from this package directory.
