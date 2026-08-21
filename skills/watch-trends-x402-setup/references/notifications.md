# Getting notified when a signal fires

## Three layers, and why

The socket lives in a **detached background process**, not in your chat session. By the
time a trend fires, the conversation that started the supervisor has long ended. So
"the agent tells you" was never implementable — the last hop has to be something the
supervisor itself can run.

**Layer 1 — the spool (always on, nothing to configure).** Every validated signal is
appended to `${WATCHTRENDS_STATE_DIR}/signals.jsonl` before anything else is attempted,
mode `0600`, deduplicated by event id so gap-recovery replays never double-report. This
is not a notification; it is the guarantee that a misconfigured notifier can never turn
a signal you paid for into a lost one. Read it back with:

```bash
node scripts/status.mjs --signals --limit 20
```

**Layer 2 — the notify hook (the actual push).** `WATCHTRENDS_NOTIFY_CMD` names a
command the supervisor runs once per new signal, with the message on **stdin**.

**Layer 3 — reuse an existing channel.** Prefer the messaging channel the user already
has (OpenClaw, Hermes, or a shared Telegram bot token). **Never lead with BotFather.**

## Default path: detect first

```bash
node scripts/detect-notify.mjs
```

This prints JSON with:

- `runtime_hint` — openclaw / hermes / claude / codex / cursor / unknown
- `candidates[]` — existing channels on this host
- `recommended` — best match
- `next_action` — what the agent should tell the user

Then confirm with the user (“I’ll send alerts on your existing OpenClaw Telegram”) and:

```bash
node scripts/detect-notify.mjs --apply
node scripts/doctor.mjs --notify
```

`--apply` writes only **non-secret** keys into `config.public`
(`WATCHTRENDS_NOTIFY_CMD`, `WATCHTRENDS_NOTIFY_TARGET`). It never writes bot tokens.

### Preference order

1. `WATCHTRENDS_NOTIFY_CMD` already set — keep it
2. OpenClaw Telegram ready → `scripts/notify-openclaw.sh`
3. Hermes messaging ready → `scripts/notify-hermes.sh`
4. Existing `TELEGRAM_BOT_TOKEN` + known chat id → `scripts/notify-telegram.sh` (same bot, no BotFather)
5. Desktop `notify-send` / `terminal-notifier` → `scripts/notify-desktop.sh`
6. Spool only — signals appear when the user next asks the agent

### Per runtime

| Runtime | What to expect |
|---|---|
| **OpenClaw** | Reuse `openclaw message send` and the bot already in `~/.openclaw/openclaw.json` |
| **Hermes** | Reuse `hermes send --to …` and credentials already in Hermes env / home channel |
| **Claude Code / Codex / Cursor** | If OpenClaw or Hermes is installed on the host, reuse those. Otherwise desktop notify or spool-only. These UIs have no Telegram send API of their own |

## Message shape

```
watch-trends: BTC up 5.2% (threshold 5) at 65000
time: 2026-08-02T17:26:37.928Z

Informational only. Not investment advice.
```

One actionable line, then the service-provided disclosure **verbatim**.

## Why the message goes on stdin, not argv

Signal content is remote-controlled data. Interpolating it into a command line would
both expose it to anyone running `ps` and hand an attacker a shell-injection surface.
Only the command string *you wrote* is ever seen by the shell; the payload only ever
arrives on stdin. (OpenClaw’s CLI requires `--message`; the wrapper is the only place
that crosses that boundary.)

## When the notifier breaks

Failures are contained. A hook that exits non-zero, hangs, or is missing gets retried
three times with backoff, then the signal is marked `notified:false` in the spool and
logged as `notify_command_failed`. The supervisor keeps running and the socket stays
open — **a broken notifier must never cost you the paid session or the watch lease.**

```bash
node scripts/status.mjs --signals
```

## What is deliberately NOT pushed

Only trend signals go to your notification channel. Money and health events stay in
the supervisor log and `status.mjs`.

## Appendix: create a new Telegram bot (last resort)

Only if detection found nothing, the user **explicitly** wants a new push channel, and
they decline desktop/spool-only:

1. Message [@BotFather](https://t.me/BotFather) → `/newbot`
2. Save the token as `TELEGRAM_BOT_TOKEN` in the secret store (never in chat)
3. Message the bot, then get your chat id (e.g. via @userinfobot)
4. Set `WATCHTRENDS_NOTIFY_TARGET` / `TELEGRAM_CHAT_ID` and
   `WATCHTRENDS_NOTIFY_CMD=scripts/notify-telegram.sh`
5. Reload the environment (source profile / new terminal) and restart the agent
6. `node scripts/doctor.mjs --notify`

This path is for advanced users. Normal setup must not start here.

## Other manual hooks

| Channel | Command |
|---|---|
| ntfy.sh | `curl -sf -d @- https://ntfy.sh/your-secret-topic` |
| Slack / Discord webhook | your own small script that wraps stdin |
| Anything | any executable that reads stdin |

```bash
export WATCHTRENDS_NOTIFY_FORMAT=json
```

stdin then carries `{event_id, ticker, received_at, payload, disclosure}`.
