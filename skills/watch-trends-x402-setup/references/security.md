# Setting secrets securely

The agent must never see these values. Set them yourself, in a place your agent
process can read as an environment variable, then tell the agent "done" — it
checks only that the *names* are set.

## What is secret and what is not

| Secret — secret store only | Public — fine in `config.public` |
|---|---|
| `CB_AGENT_KIT_CLIENT_API_KEY` | `WATCHTRENDS_API_BASE_URL` |
| `CB_AGENT_KIT_CLIENT_SECRET` | `WATCHTRENDS_EXPECTED_PAY_TO` |
| `CB_AGENT_KIT_WALLET_SECRET` | `WATCHTRENDS_EXPECTED_NETWORK` / `_ASSET` |
| `TELEGRAM_BOT_TOKEN` | `X402_MAX_AMOUNT_ATOMIC`, `X402_DAILY_LIMIT_ATOMIC` |
| `TELEGRAM_CHAT_ID` | `WATCHTRENDS_CDP_ACCOUNT_NAME`, `WATCHTRENDS_STATE_DIR` |

`config.public` actively refuses secret keys. If you paste one in, it is ignored
and preflight reports `secret_in_public_config` — the value is not silently loaded.

## Getting CDP Agent Kit credentials

1. Sign in at the Coinbase Developer Platform portal.
2. Create an API key. You get a **key ID** and a **key secret**; the secret is shown
   once, so save it straight into your password manager.
3. Create a **wallet secret** for server-side signing. Same rule: shown once.
4. Map them:
   - key ID → `CB_AGENT_KIT_CLIENT_API_KEY`
   - key secret → `CB_AGENT_KIT_CLIENT_SECRET`
   - wallet secret → `CB_AGENT_KIT_WALLET_SECRET`

You never enter a seed phrase or private key anywhere in this skill. The buyer wallet
is created and signed for through CDP using these three credentials.

## Setting them, by platform

### Linux and macOS — shell session

Add to `~/.bashrc`, `~/.zshrc`, or a file you `source` before starting the agent:

```bash
export CB_AGENT_KIT_CLIENT_API_KEY='...'
export CB_AGENT_KIT_CLIENT_SECRET='...'
export CB_AGENT_KIT_WALLET_SECRET='...'
```

Leading space before the command keeps it out of shell history in most shells, and
`chmod 600` the file. This is the simplest option, not the most secure one.

### macOS — Keychain (better)

Store once:

```bash
security add-generic-password -a "$USER" -s CB_AGENT_KIT_WALLET_SECRET -w
```

It prompts for the value instead of taking it from the command line, so it never
lands in your shell history. Read it back when launching the agent:

```bash
export CB_AGENT_KIT_WALLET_SECRET="$(security find-generic-password -a "$USER" -s CB_AGENT_KIT_WALLET_SECRET -w)"
```

### Linux — libsecret (better)

```bash
secret-tool store --label='CDP wallet secret' service watch-trends key wallet_secret
export CB_AGENT_KIT_WALLET_SECRET="$(secret-tool lookup service watch-trends key wallet_secret)"
```

### Linux — systemd user service

Put the values in `~/.config/watch-trends/env`, `chmod 600`, and reference it:

```ini
[Service]
EnvironmentFile=%h/.config/watch-trends/env
```

Never put secrets directly in a unit file; unit files are world-readable.

### Windows — user environment variables

```powershell
[Environment]::SetEnvironmentVariable('CB_AGENT_KIT_WALLET_SECRET', (Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText), 'User')
```

Then restart the terminal so the agent process inherits it.

### OpenClaw and Hermes

Use the runtime's own secrets configuration so the values are injected into the agent
process environment. Do not put them in a workspace file that gets committed.

### Claude Code, Cursor, and other local agents

These inherit the environment of the shell that launched them. Export the variables in
that shell before starting the agent, or use a launcher script that sources a
`chmod 600` env file.

### Railway or another host

Use the platform's Variables UI. Values set there are injected as environment
variables and are not written into your repository.

## Verifying without exposing anything

```bash
node scripts/preflight.mjs
```

It reports `{"name": "CB_AGENT_KIT_WALLET_SECRET", "set": true}` and nothing more. No
script in this skill prints a secret value, a payment signature, a payment response
header, or a socket token. Diagnostics carry masked prefixes only.

## If you think a credential leaked

1. Revoke the API key in the CDP portal immediately.
2. Move any remaining balance out of the buyer wallet address.
3. Create new credentials and a new buyer account name.

Because the buyer wallet is dedicated and holds roughly a week of spend, the blast
radius of a leak here is a few dollars — which is the entire reason the skill refuses
to pay from your main trading wallet.
