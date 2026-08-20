# Installing and running the supervisor per host

## Install (every runtime)

```bash
cd skills/watch-trends-x402-setup
npm ci
node scripts/preflight.mjs
```

`npm ci` installs the exact versions in the committed `package-lock.json`. The skill
deliberately does not fall back to a parent workspace's `node_modules`: the code that
signs payments must run the audited versions, so a missing install is reported as
`deps_not_installed` rather than silently resolved elsewhere.

Requires Node 22 or newer. No `bash`, `jq`, or GNU coreutils dependency — the three
`.sh` files are one-line wrappers around the Node scripts.

## Where the skill goes, by runtime

| Runtime | Location |
|---|---|
| Cursor (project) | `.cursor/skills/watch-trends-x402-setup/` |
| Cursor (personal) | `~/.cursor/skills/watch-trends-x402-setup/` |
| Claude Code | `.claude/skills/watch-trends-x402-setup/` |
| OpenClaw / Hermes | the workspace skills directory the runtime already scans |
| Any OpenAI-compatible agent | anywhere the agent can run local commands; point it at `SKILL.md` |

The skill is a directory of Markdown plus Node scripts. Any agent that can execute a
local command and read an environment variable can run it.

## Running the supervisor detached

The supervisor must outlive the chat turn that started it. **Closing the laptop stops
the stream** — there is no cloud component holding the socket for you.

### Linux — user systemd unit (recommended)

`~/.config/systemd/user/watch-trends.service`:

```ini
[Unit]
Description=watch-trends signal supervisor
After=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/path/to/skills/watch-trends-x402-setup
EnvironmentFile=%h/.config/watch-trends/env
ExecStart=/usr/bin/node scripts/watch-session.mjs --ticker BTC --hours 24
Restart=on-failure
RestartSec=30
StandardOutput=append:%h/.watch-trends/supervisor.log
StandardError=append:%h/.watch-trends/supervisor.log

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now watch-trends
loginctl enable-linger "$USER"   # keeps it running after you log out
```

`Restart=on-failure` with a 30-second delay is deliberate. A tighter restart loop would
be capped by the paid-session limiter anyway, but 30 seconds keeps the logs readable.
Note that a restart cannot recover the previous session's token, so it will report
`session_token_lost` and stop until you re-run with `--accept-session-loss`. That is
intentional: an automatic restart that silently re-buys is how a runaway starts.

### macOS — launchd

`~/Library/LaunchAgents/tech.smarterway.watch-trends.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>tech.smarterway.watch-trends</string>
  <key>WorkingDirectory</key><string>/Users/YOU/path/to/skills/watch-trends-x402-setup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>scripts/watch-session.mjs</string>
    <string>--ticker</string><string>BTC</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/Users/YOU/.watch-trends/supervisor.log</string>
  <key>StandardErrorPath</key><string>/Users/YOU/.watch-trends/supervisor.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/tech.smarterway.watch-trends.plist
```

launchd does not read your shell profile, so set the CDP variables with
`launchctl setenv` or add an `EnvironmentVariables` dict that reads from Keychain via a
wrapper script.

### Windows

Use Task Scheduler with "Run whether user is logged on or not", action
`node scripts\watch-session.mjs --ticker BTC`, started in the skill directory. Set the
credentials as **user** environment variables first so the task inherits them.

### OpenClaw and Hermes

Use the runtime's own background-process facility. This skill does not ship a daemon
manager and will not invent one. The requirement is only that the process keeps
running after the chat turn ends and that its stdout is captured somewhere readable.

### Quick and dirty (testing only)

```bash
nohup node scripts/watch-session.mjs --ticker BTC > ~/.watch-trends/supervisor.log 2>&1 &
```

This dies with the terminal session on some systems. Fine for a 30-minute test, not for
an overnight run.

## Reading supervisor output

The supervisor writes JSON Lines, one event per line:

```bash
tail -f ~/.watch-trends/supervisor.log
```

Event types worth watching: `session_purchased`, `socket_ready`, `signal`, `renewed`,
`gap_detected`, `status`, `warning`, `terminal`, `stopped`, `shutdown`.

For a summary instead of a stream, use `node scripts/status.mjs`, which reads the same
state without touching the network.

## Stopping

```bash
systemctl --user stop watch-trends     # or: kill -TERM <pid>
```

SIGTERM closes the socket, drains pending notifications, releases the single-instance
lock, and writes a final `shutdown` event. It does **not** stop your watches — those
keep running until their leases expire. Use `scripts/stop-watch.sh <ticker>` for paid
teardown, or let the lease lapse for free.
