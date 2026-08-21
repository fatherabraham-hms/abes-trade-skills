/**
 * Discover an existing notification channel on the host.
 *
 * Preference order (locked):
 *   1. Explicit WATCHTRENDS_NOTIFY_CMD already set
 *   2. OpenClaw Telegram ready
 *   3. Hermes messaging channel ready
 *   4. Shared TELEGRAM_BOT_TOKEN + known chat id (reuse notify-telegram, no BotFather)
 *   5. Desktop notify-send / terminal-notifier
 *   6. Spool only
 *
 * Never prints secret values. Chat ids and channel names are public identifiers.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SKILL_ROOT } from "./config.mjs";

function which(bin) {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, bin);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function envSet(name) {
  const v = process.env[name];
  return Boolean(v && String(v).trim());
}

function envVal(name) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : null;
}

/** Infer which agent UI is likely hosting this skill, without reading secrets. */
export function detectRuntimeHint() {
  if (process.env.OPENCLAW_HOME || process.env.OPENCLAW_GATEWAY || which("openclaw")) {
    if (process.env.OPENCLAW_HOME || process.cwd().includes("openclaw")) return "openclaw";
  }
  if (process.env.HERMES_HOME || process.env.HERMES_ASSISTANT_ROOT || which("hermes")) {
    if (process.env.HERMES_HOME || process.env.HERMES_ASSISTANT_ROOT || process.cwd().includes("hermes")) {
      return "hermes";
    }
  }
  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE || process.env.CLAUDE_PROJECT_DIR) return "claude";
  if (process.env.CODEX_HOME || process.env.CODEX_SHELL) return "codex";
  if (process.env.CURSOR_TRACE_ID || process.env.CURSOR_AGENT || process.cwd().includes(".cursor")) return "cursor";
  if (which("openclaw") && !which("hermes")) return "openclaw";
  if (which("hermes") && !which("openclaw")) return "hermes";
  return "unknown";
}

function openclawConfigPath() {
  const home = process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw");
  return path.join(home, "openclaw.json");
}

function readOpenclawTelegram() {
  const result = {
    binary: which("openclaw"),
    config_path: openclawConfigPath(),
    enabled: false,
    bot_token_env: envSet("TELEGRAM_BOT_TOKEN"),
    allow_from: [],
    target: null,
  };
  try {
    const raw = fs.readFileSync(result.config_path, "utf8");
    const cfg = JSON.parse(raw);
    const tg = cfg?.channels?.telegram;
    result.enabled = Boolean(tg?.enabled);
    const allow =
      tg?.accounts?.default?.allowFrom ||
      tg?.allowFrom ||
      cfg?.commands?.ownerAllowFrom ||
      [];
    const list = Array.isArray(allow) ? allow : [allow];
    result.allow_from = list
      .map((entry) => String(entry).replace(/^telegram:/i, "").trim())
      .filter(Boolean);
  } catch {
    /* missing or unreadable config is fine */
  }

  result.target =
    envVal("WATCHTRENDS_NOTIFY_TARGET") ||
    envVal("TELEGRAM_CONTEXT_ALERT_CHAT_ID") ||
    envVal("TELEGRAM_CHAT_ID") ||
    envVal("TELEGRAM_HOME_CHANNEL") ||
    result.allow_from[0] ||
    null;

  result.ready = Boolean(
    result.binary && (result.enabled || result.bot_token_env) && result.target
  );
  return result;
}

function hermesHome() {
  return (
    process.env.HERMES_HOME ||
    process.env.HERMES_ASSISTANT_DATA ||
    path.join(os.homedir(), ".hermes")
  );
}

function parseHermesList(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const channels = [];
  for (const line of lines) {
    // Typical: "telegram", "telegram:123", "discord:#ops"
    const m = line.match(/^([a-z0-9_-]+)(?::(\S+))?/i);
    if (m) channels.push({ platform: m[1].toLowerCase(), target: m[2] || m[1].toLowerCase(), raw: line });
  }
  return channels;
}

function readHermes() {
  const result = {
    binary: which("hermes") || which("hermes-assistant-cli.sh"),
    hermes_home: hermesHome(),
    list_ok: false,
    channels: [],
    token_env: envSet("TELEGRAM_BOT_TOKEN") || envSet("HERMES_TELEGRAM_TOKEN"),
    home_channel:
      envVal("WATCHTRENDS_NOTIFY_TARGET") ||
      envVal("TELEGRAM_HOME_CHANNEL") ||
      envVal("HERMES_TELEGRAM_USER") ||
      envVal("DISCORD_HOME_CHANNEL") ||
      envVal("SLACK_HOME_CHANNEL") ||
      null,
  };

  if (result.binary && path.basename(result.binary) === "hermes") {
    try {
      const proc = spawnSync(result.binary, ["send", "--list"], {
        encoding: "utf8",
        timeout: 8_000,
        env: process.env,
      });
      result.list_ok = proc.status === 0;
      if (proc.stdout) result.channels = parseHermesList(proc.stdout);
    } catch {
      /* list unavailable */
    }
  }

  // Prefer an explicit home channel; else first listed telegram; else first channel.
  const telegramListed = result.channels.find((c) => c.platform === "telegram");
  if (!result.home_channel && telegramListed) {
    result.home_channel = telegramListed.target.startsWith("telegram")
      ? telegramListed.target
      : `telegram:${telegramListed.target}`;
  } else if (!result.home_channel && result.channels[0]) {
    const c = result.channels[0];
    result.home_channel = c.target.includes(":") ? c.target : `${c.platform}:${c.target}`;
  }

  // Normalize bare chat ids to telegram:ID for hermes send --to
  if (result.home_channel && /^\d+$|^-\d+$/.test(result.home_channel)) {
    result.home_channel = `telegram:${result.home_channel}`;
  }
  if (result.home_channel && !result.home_channel.includes(":") && result.token_env) {
    result.home_channel = `telegram:${result.home_channel}`;
  }

  result.ready = Boolean(
    result.binary &&
      result.home_channel &&
      (result.list_ok || result.token_env || result.channels.length)
  );
  return result;
}

function knownTelegramChatId() {
  return (
    envVal("WATCHTRENDS_NOTIFY_TARGET") ||
    envVal("TELEGRAM_CHAT_ID") ||
    envVal("TELEGRAM_CONTEXT_ALERT_CHAT_ID") ||
    envVal("TELEGRAM_HOME_CHANNEL") ||
    envVal("HERMES_TELEGRAM_USER") ||
    null
  );
}

function readSharedTelegram() {
  const chatId = knownTelegramChatId();
  // Strip telegram: prefix if present for the Bot API chat_id field.
  const bare = chatId ? String(chatId).replace(/^telegram:/i, "") : null;
  return {
    bot_token_set: envSet("TELEGRAM_BOT_TOKEN") || envSet("HERMES_TELEGRAM_TOKEN"),
    chat_id: bare,
    ready: Boolean((envSet("TELEGRAM_BOT_TOKEN") || envSet("HERMES_TELEGRAM_TOKEN")) && bare),
  };
}

function readDesktop() {
  const notifySend = which("notify-send");
  const terminalNotifier = which("terminal-notifier");
  return {
    notify_send: notifySend,
    terminal_notifier: terminalNotifier,
    ready: Boolean(notifySend || terminalNotifier),
    kind: notifySend ? "notify-send" : terminalNotifier ? "terminal-notifier" : null,
  };
}

function candidate({ kind, command, target, evidence, confidence, apply }) {
  return { kind, command, target: target ?? null, evidence, confidence, apply };
}

/**
 * Build the ordered candidate list and recommendation.
 */
export function detectNotifyChannels() {
  const runtime_hint = detectRuntimeHint();
  const candidates = [];

  const explicit = envVal("WATCHTRENDS_NOTIFY_CMD");
  if (explicit) {
    candidates.push(
      candidate({
        kind: "explicit",
        command: explicit,
        target: envVal("WATCHTRENDS_NOTIFY_TARGET"),
        evidence: ["WATCHTRENDS_NOTIFY_CMD is already set"],
        confidence: "high",
        apply: null,
      })
    );
  }

  const oc = readOpenclawTelegram();
  if (oc.ready) {
    candidates.push(
      candidate({
        kind: "openclaw",
        command: "scripts/notify-openclaw.sh",
        target: oc.target,
        evidence: [
          oc.binary ? "openclaw on PATH" : null,
          oc.enabled ? "channels.telegram.enabled" : null,
          oc.bot_token_env ? "TELEGRAM_BOT_TOKEN present" : null,
          oc.target ? `target ${oc.target}` : null,
        ].filter(Boolean),
        confidence: "high",
        apply: {
          WATCHTRENDS_NOTIFY_CMD: "scripts/notify-openclaw.sh",
          WATCHTRENDS_NOTIFY_TARGET: oc.target,
        },
      })
    );
  }

  const he = readHermes();
  if (he.ready) {
    candidates.push(
      candidate({
        kind: "hermes",
        command: "scripts/notify-hermes.sh",
        target: he.home_channel,
        evidence: [
          he.binary ? `${path.basename(he.binary)} on PATH` : null,
          he.list_ok ? "hermes send --list ok" : null,
          he.token_env ? "Hermes/Telegram token env present" : null,
          he.home_channel ? `target ${he.home_channel}` : null,
        ].filter(Boolean),
        confidence: he.list_ok ? "high" : "medium",
        apply: {
          WATCHTRENDS_NOTIFY_CMD: "scripts/notify-hermes.sh",
          WATCHTRENDS_NOTIFY_TARGET: he.home_channel,
        },
      })
    );
  }

  const tg = readSharedTelegram();
  if (tg.ready) {
    candidates.push(
      candidate({
        kind: "telegram_existing",
        command: "scripts/notify-telegram.sh",
        target: tg.chat_id,
        evidence: [
          "TELEGRAM_BOT_TOKEN (or HERMES_TELEGRAM_TOKEN) present",
          `chat id ${tg.chat_id}`,
          "reuses existing bot — no BotFather",
        ],
        confidence: "high",
        apply: {
          WATCHTRENDS_NOTIFY_CMD: "scripts/notify-telegram.sh",
          WATCHTRENDS_NOTIFY_TARGET: tg.chat_id,
        },
      })
    );
  }

  const desk = readDesktop();
  if (desk.ready) {
    const command =
      desk.kind === "notify-send"
        ? "scripts/notify-desktop.sh"
        : "scripts/notify-desktop.sh";
    candidates.push(
      candidate({
        kind: "desktop",
        command,
        target: null,
        evidence: [`${desk.kind} on PATH`],
        confidence: "medium",
        apply: {
          WATCHTRENDS_NOTIFY_CMD: command,
        },
      })
    );
  }

  // Prefer explicit, then openclaw, hermes, shared telegram, desktop.
  const order = ["explicit", "openclaw", "hermes", "telegram_existing", "desktop"];
  const ranked = [...candidates].sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)
  );
  const recommended = ranked.find((c) => c.kind !== "explicit") || ranked[0] || null;
  // If explicit exists, that is recommended for keep-as-is.
  const keepExplicit = ranked.find((c) => c.kind === "explicit");
  const pick = keepExplicit || recommended;

  let next_action;
  if (keepExplicit) {
    next_action =
      "WATCHTRENDS_NOTIFY_CMD is already set. Run doctor.mjs --notify to verify it; do not ask the user to create a bot.";
  } else if (pick && pick.kind !== "desktop") {
    next_action =
      `Confirm with the user: use existing ${pick.kind} channel` +
      (pick.target ? ` to ${pick.target}` : "") +
      `. On yes, run: node scripts/detect-notify.mjs --apply. Never ask them to create a Telegram bot.`;
  } else if (pick && pick.kind === "desktop") {
    next_action =
      "No chat channel found. Offer desktop notifications (notify-send/terminal-notifier), or proceed with spool-only. BotFather is last resort only if they explicitly want a new push channel.";
  } else {
    next_action =
      "No existing notification channel found. Proceed with spool-only: signals are saved locally and shown when the user next asks the agent. Do not walk them through BotFather unless they explicitly ask for a new push channel.";
  }

  return {
    stage: "detect_notify",
    ok: true,
    code: pick ? "notify_channel_detected" : "notify_not_configured",
    runtime_hint,
    candidates: ranked,
    recommended: pick,
    discovery: {
      openclaw: {
        binary: Boolean(oc.binary),
        enabled: oc.enabled,
        target: oc.target,
        ready: oc.ready,
      },
      hermes: {
        binary: Boolean(he.binary),
        list_ok: he.list_ok,
        target: he.home_channel,
        ready: he.ready,
      },
      telegram_existing: {
        bot_token_set: tg.bot_token_set,
        chat_id_set: Boolean(tg.chat_id),
        ready: tg.ready,
      },
      desktop: {
        kind: desk.kind,
        ready: desk.ready,
      },
    },
    next_action,
  };
}

/**
 * Write non-secret notify keys into config.public (or create it from example).
 * Never writes bot tokens.
 */
export function applyNotifyCandidate(candidate, { configPath } = {}) {
  if (!candidate?.apply) {
    throw new Error("Candidate has nothing to apply (explicit or spool-only).");
  }
  const targetPath = configPath || path.join(SKILL_ROOT, "config.public");
  const examplePath = path.join(SKILL_ROOT, "config.public.example");

  let body = "";
  try {
    body = fs.readFileSync(targetPath, "utf8");
  } catch {
    try {
      body = fs.readFileSync(examplePath, "utf8");
    } catch {
      body = "# watch-trends public config\n";
    }
  }

  const updates = { ...candidate.apply };
  // TELEGRAM_CHAT_ID is a public chat id when reused; still useful in config.public.
  // Do not write TELEGRAM_BOT_TOKEN ever.
  delete updates.TELEGRAM_BOT_TOKEN;
  delete updates.HERMES_TELEGRAM_TOKEN;

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === null) continue;
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(body)) body = body.replace(re, line);
    else body = `${body.trimEnd()}\n${line}\n`;
  }

  // Comment out a stale default telegram cmd only if we're replacing notify cmd
  if (updates.WATCHTRENDS_NOTIFY_CMD) {
    body = body.replace(
      /^#?\s*WATCHTRENDS_NOTIFY_CMD=scripts\/notify-telegram\.sh$/m,
      `# auto-wired; previous default commented\nWATCHTRENDS_NOTIFY_CMD=${updates.WATCHTRENDS_NOTIFY_CMD}`
    );
  }

  fs.writeFileSync(targetPath, body.endsWith("\n") ? body : `${body}\n`, { mode: 0o600 });
  return { path: targetPath, applied: updates };
}
