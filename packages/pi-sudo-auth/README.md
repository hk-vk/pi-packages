# @hk-vk/pi-sudo-auth

Authenticate macOS sudo commands with a masked native Pi prompt.

## Platform support

macOS only; this package is developed and tested on macOS.

## Install

```bash
pi install npm:@hk-vk/pi-sudo-auth
```

The extension intercepts sudo commands, validates the password with `sudo -v`, and never puts the password in the command, environment, session, logs, or tool output.
