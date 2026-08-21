---
name: watch-trends-x402-setup
description: Sets up a dedicated x402 crypto wallet and receives paid watch-trends trading signals over an outbound WebSocket, with no localhost server, no tunnel, and no secrets in chat. Use when a user wants to buy, receive, monitor, or stop watch-trends trend signals, set up a CDP / x402 payment wallet (CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET), diagnose x402 payment or signal-delivery failures, or check what watch-trends is costing them.
---

# watch-trends x402 setup

Onboards a non-technical user to pay for watch-trends signals with x402 and receive
them over an outbound-only WebSocket. Every script prints one JSON object so you can
act on it without parsing prose.

## Non-negotiable rules

1. **Never ask the user to paste a secret, key, seed phrase, or PII into the chat.**
   Name the variable, point at `references/security.md`, and verify presence only.
2. **Never spend without explicit consent.** State the dollar cost first. `doctor.mjs`
   and `budget-plan.mjs` spend nothing; anything else on the paid list does.
3. **Never raise a spend cap, fund a wallet, or set `WATCHTRENDS_ALLOW_SHARED_WALLET`
   for the user.** Tell them the variable and value; they set it.
4. **Never propose localhost receivers, ngrok/cloudflared, open ports, or disposable
   webhook sites.** The socket is outbound-only by design.
5. **Signals are informational, not investment advice.** Pass the service `disclosure`
   through verbatim.
6. **Run `status.mjs` first** in any later conversation about watches, before answering
   anything else. The supervisor runs detached, so a dead stream is otherwise invisible.

## What costs money

| Action | Price | Notes |
|---|---:|---|
| `POST /watches` (start) | $0.01 | Once per ticker |
| `POST /watches/{t}/renew` | $0.01 | Every 30 min per ticker |
| `POST /socket/session` | $0.01 | Every 25 min, per wallet not per ticker |
| `DELETE /watches/{t}` (stop) | $0.01 | Teardown is also paid |
| `GET /watches/{t}/events` | $0.01 | Gap recovery only |

One ticker running continuously costs about **$1.06/day**. This is a recurring charge,
not a setup fee — say so plainly before the first payment.

## Setup workflow

Copy this checklist and track it:

```
- [ ] 1. Preflight
- [ ] 2. Secrets (user)
- [ ] 3. Cost disclosure + consent (user)
- [ ] 4. Fund the dedicated wallet (user)
- [ ] 5. Doctor
- [ ] 6. Notification channel (detect existing; never BotFather-first)
- [ ] 7. Start the watch (first charge)
- [ ] 8. Run the supervisor detached
```

**1. Preflight** — `node scripts/preflight.mjs`
Checks Node 22+, that `npm ci` has been run, a writable state directory, and which
credential *names* are set. On `deps_not_installed`, run `npm ci` in the skill
directory; never fall back to another project's `node_modules`.

**2. Secrets** — one user prompt
Send the user to the official CDP x402 buyer quickstart and walk them through creating
credentials. Do **not** ask them to paste values into chat.

1. Open [CDP x402 buyer quickstart](https://docs.cdp.coinbase.com/x402/buyer/quickstart)
   (prerequisites + env var names).
2. In the [CDP Portal](https://portal.cdp.coinbase.com):
   - Sign in (a project is created on first sign-in).
   - Create a **Secret API key**: [API Keys → Secret](https://portal.cdp.coinbase.com/api-keys/secret)
     → **Create API key**. Save the **API key ID** and **API key secret** immediately —
     the secret is shown once.
   - Create a **Wallet Secret**: [Non-custodial Wallet → Security](https://portal.cdp.coinbase.com/wallets/non-custodial/security)
     → **Generate**. Save it immediately — it is also shown once.
3. Set these in their runtime secret store / shell profile (official names):

```bash
export CDP_API_KEY_ID="your-api-key-id"
export CDP_API_KEY_SECRET="your-api-key-secret"
export CDP_WALLET_SECRET="your-wallet-secret"
```

Legacy names still work if already configured — map them as:

| Official (preferred) | Legacy (still accepted) |
|---|---|
| `CDP_API_KEY_ID` | `CB_AGENT_KIT_CLIENT_API_KEY` |
| `CDP_API_KEY_SECRET` | `CB_AGENT_KIT_CLIENT_SECRET` |
| `CDP_WALLET_SECRET` | `CB_AGENT_KIT_WALLET_SECRET` |

Point at `references/security.md` for platform-specific secret storage. The skill's
`npm ci` already installs `@coinbase/cdp-sdk` (the CDP / x402 buyer SDK); the user does
not need a separate Agent Kit install for this skill's scripts.

**Also tell them how to make the running process see the values** — writing a profile
file is not enough, and this is the usual reason preflight still reports credentials
missing:

- **Linux / macOS:** after saving to `~/.bashrc` / `~/.zshrc` (or a sourced env file),
  run `source ~/.bashrc` or `source ~/.zshrc` in the shell that launches the agent,
  then **restart the agent** from that shell.
- **Windows:** after setting User environment variables, close every open terminal,
  open a **new** one (or sign out/in if the agent was started from a shortcut), then
  **restart the agent**. Windows has no `source` for User vars.

Only after they confirm the reload + agent restart, rerun preflight. If preflight still
shows unset, do not invent fixes — ask whether they sourced/restarted, and point back
at `references/security.md`.

**3. Cost disclosure** — `node scripts/budget-plan.mjs <tickers> <hours>`
Show the projected dollar cost and the per-day rate. Mention that the shipped
`X402_DAILY_LIMIT_ATOMIC` is a $200/day runaway ceiling, not a budget, and offer the
lower `recommended_atomic` value. Get explicit consent before any payment. If the
configured cap is below the projection, say how many hours the stream will actually
last instead of starting a run that dies mid-way.

**4. Wallet** — `node scripts/print-wallet-address.mjs`
Prints the address of the dedicated `WatchTrendsBuyer` account. Ask the user to send a
small amount of USDC on Base to it — roughly one week of projected spend. Tell them
this balance, not the daily cap, is the real limit on total spend, and that the address
should hold nothing else. Confirm with "done?"; never ask for a key or seed phrase.

**5. Doctor** — `node scripts/doctor.mjs`
Runs every no-spend check: host, config, service health, clock skew, discovery
contract, the unpaid 402 gate, a dry-run of the buyer, and the notification path. Stop
on any failure and use its `next_action` verbatim. Never attempt payment past a
`service_not_ready`, `service_contract_mismatch`, or `clock_skew_detected`.

**6. Notification channel** — detect first, before spending
**Do not** walk the user through BotFather or creating a new Telegram bot.

1. Run `node scripts/detect-notify.mjs`.
2. If `recommended` is set: tell the user which **existing** channel will be used
   (e.g. “your OpenClaw Telegram”) and ask yes/no.
3. On yes: `node scripts/detect-notify.mjs --apply`, then
   `node scripts/doctor.mjs --notify` (sends no message).
4. If nothing was found: default to **spool-only** and say plainly that signals are
   saved locally and shown when they next ask you. Optionally offer desktop notify if
   `detect-notify` listed a `desktop` candidate. BotFather is last resort only — see
   the appendix in `references/notifications.md` — and only if they explicitly ask.

OpenClaw and Hermes already own messaging credentials; Claude Code / Codex have no
chat-send API, but may still reuse OpenClaw/Hermes CLIs if those are installed on the
host.

**7. Start the watch** — `scripts/start-watch.sh <ticker> <segment> <threshold> --start-price <p>`
Get the current price from your own market-data capability or ask the user. **Echo the
price and resulting threshold band back for confirmation before paying.** Pass
`--reference-price` when you have an independent quote; a price more than 20% off is
refused as `start_price_implausible`.

**8. Run the supervisor** — `node scripts/watch-session.mjs --ticker <T> --hours <H>`
This is the only supported way to run continuously. It holds the socket, answers
liveness pings, renews the lease, re-buys the session before it expires, reports gaps,
spools every signal, and fires the notify hook. **Start it detached** per
`references/runtimes.md` — it must survive the end of this chat turn. It emits JSON
Lines, one event per line, not a single result object.

## Monitoring and teardown

- `node scripts/status.mjs` — supervisor state, spend today, cap remaining, lease
  expiry, undelivered signals. Run this first in any follow-up conversation.
- `node scripts/status.mjs --signals --limit 20` — replay signals that arrived while
  the chat was closed.
- `scripts/stop-watch.sh <ticker>` — paid teardown ($0.01).
- `SIGTERM` to the supervisor — ends the stream with no further charges. Existing
  leases keep running until they expire.

## When something breaks

Read `references/authentication-and-troubleshooting.md`. Every script returns a `code`;
that document maps each code to a safe user-facing message and the correct action.

The codes that must **never** trigger a retry that spends money:
`socket_replaced_elsewhere`, `socket_protocol_unrecognized`, `socket_closed`,
`service_contract_mismatch`, `payment_requirements_rejected`, `shared_wallet_refused`,
`clock_skew_detected`, `supervisor_already_running`.

## Known limitations to disclose honestly

- The service signal hub is single-replica and in-process. A redeploy drops connections
  and any signal emitted in that window. **Do not claim guaranteed delivery.**
- Only trend signals are pushed. Money and health events — cap reached, spend anomaly,
  gaps, terminal socket errors — stay in the log and `status.mjs`. That is why step 6
  of the monitoring habit matters: if the supervisor stops, nothing pings the user.
- Closing the laptop stops the stream.
- The socket token appears in the service's own TLS-terminated access logs. Its
  30-minute TTL is the mitigation.

## Paid diagnostics (opt-in only)

`node scripts/smoke-socket.mjs --spend --listen --duration 35` buys a session ($0.01)
and proves the socket upgrades, binds to the payer, and answers pings. It refuses to
run while the supervisor holds the connection slot. Only offer this after a doctor
failure that a live test would actually diagnose.

## Reference files

- [references/security.md](references/security.md) — setting secrets per platform, never in chat
- [references/runtimes.md](references/runtimes.md) — install and detached supervisor per host
- [references/authentication-and-troubleshooting.md](references/authentication-and-troubleshooting.md) — every error code and its fix
- [references/costs.md](references/costs.md) — pricing math and cap sizing
- [references/notifications.md](references/notifications.md) — detect existing channels; spool; notify hooks; BotFather appendix only
- [references/service-contract.md](references/service-contract.md) — verified contract and open service-side dependencies
