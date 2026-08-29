# watch-trends x402 setup

Agent skill for setting up a dedicated Coinbase CDP buyer wallet, paying for
watch-trends subscriptions with x402, and receiving trading signals over an
outbound-only WebSocket. It does not require localhost, an inbound port, a tunnel,
or a disposable webhook endpoint.

## Supported runtimes

- Cursor project or personal skills
- Claude Code project skills
- OpenClaw and Hermes workspace skills
- OpenAI-compatible agents that can read Markdown, run Node.js, and access environment variables

## Coinbase CDP credentials

The `CDP_*` variables are Coinbase Developer Platform (CDP) credentials. They
come from the user's Coinbase CDP Portal, not from this GitHub repository and not
from the watch-trends service:

1. Open the [Coinbase CDP x402 buyer quickstart](https://docs.cdp.coinbase.com/x402/buyer/quickstart).
2. Sign in to the [CDP Portal](https://portal.cdp.coinbase.com) and select or create a project.
3. Create a Secret API key under **API Keys → Secret**. Save its **API key ID** and
   one-time **API key secret**.
4. Generate a Wallet Secret under **Non-custodial Wallet → Security**. Save it
   immediately because it may be shown only once.
5. Store these values in the runtime's secret store or environment:

```bash
export CDP_API_KEY_ID="your-api-key-id"
export CDP_API_KEY_SECRET="your-api-key-secret"
export CDP_WALLET_SECRET="your-wallet-secret"
```

Never paste these values into chat, GitHub, Markdown, `config.public`, or command
arguments. The skill accepts older `CB_AGENT_KIT_*` aliases, but new installations
should use the official `CDP_*` names.

## Install

From the repository root:

```bash
cp -R skills/watch-trends-x402-setup /path/to/runtime/skills/
cd /path/to/runtime/skills/watch-trends-x402-setup
npm ci
node scripts/preflight.mjs
```

Runtime destinations:

| Runtime | Destination |
|---|---|
| Cursor project | `.cursor/skills/watch-trends-x402-setup/` |
| Cursor personal | `~/.cursor/skills/watch-trends-x402-setup/` |
| Claude Code | `.claude/skills/watch-trends-x402-setup/` |
| OpenClaw/Hermes | The workspace skills directory already scanned by the runtime |
| Other agents | Any local directory the agent can read and execute |

Do not place secrets in this repository or under `~/.openclaw/workspace-*`.

## Use and verify

After installation, load [`SKILL.md`](SKILL.md) as the agent's instructions. The
skill guides the agent through:

1. Preflight and dependency checks
2. Secure CDP credential setup without pasting secrets into chat
3. Cost planning and explicit payment consent
4. Funding a dedicated buyer wallet with Base USDC
5. No-spend service discovery and x402 v2 verification
6. Existing-channel notification detection
7. Starting a watch and running the detached session supervisor

Before any paid command, run both no-spend checks:

```bash
node scripts/preflight.mjs
node scripts/doctor.mjs
```

`preflight.mjs` checks Node.js, dependencies, writable state, configuration, and
credential presence without revealing credential values. `doctor.mjs` then checks
the live origin health, clock skew, namespaced x402 v2 discovery, payment terms,
wallet configuration, and notification path. It does not sign or send a payment.
For a fresh contract check, use:

```bash
node scripts/doctor.mjs --discovery --force
```

Do not continue when Doctor reports a failure. Use its `next_action` and consult
[`references/authentication-and-troubleshooting.md`](references/authentication-and-troubleshooting.md).
That guide covers missing credentials, environment reloads, wallet funding,
payment rejection, service capacity, WebSocket close codes, lost signals, and
notification failures. Signals and supervisor events remain available locally
through `node scripts/status.mjs` and the protected state directory.

The production service is discovered at `https://agents.smarterway.tech` and uses
the namespaced watch-trends API under `/services/watch-trends/v1`.

## Required host capabilities

- Node.js 22 or newer
- Network access to the production x402 origin
- A writable local state directory
- CDP credentials supplied through the runtime's secret store or environment:
  `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and `CDP_WALLET_SECRET`

The agent must run:

```bash
node scripts/preflight.mjs
node scripts/doctor.mjs
```

before any paid command. `doctor.mjs` performs no payment. Paid actions always
require explicit user consent and are limited by the local ledger.

## Security

Never put CDP credentials, wallet secrets, Telegram tokens, seed phrases, or PII in
GitHub issues, Markdown, chat, `config.public`, command arguments, or committed files.
Read [`references/security.md`](references/security.md) for platform-specific secret
storage and environment reload instructions.

## Source files

- [`SKILL.md`](SKILL.md) — canonical agent instructions
- [`references/authentication-and-troubleshooting.md`](references/authentication-and-troubleshooting.md) — Doctor failures, error handling, and recovery
- [`references/service-contract.md`](references/service-contract.md) — current public API contract
- [`references/runtimes.md`](references/runtimes.md) — detached process setup
- [`config.public.example`](config.public.example) — non-secret configuration template
