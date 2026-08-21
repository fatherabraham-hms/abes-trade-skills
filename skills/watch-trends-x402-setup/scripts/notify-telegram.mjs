#!/usr/bin/env node
/**
 * Telegram notifier. Reads the message from STDIN and posts it to the user's
 * own bot. Costs nothing and never touches the wallet.
 *
 * The bot token belongs to the user and is read from their environment. It is
 * never printed, never placed in argv, and is masked out of every error path —
 * including the request URL, which embeds the token and must therefore never
 * be echoed on a 401.
 *
 * Usage (as a notify hook, not usually run by hand):
 *   WATCHTRENDS_NOTIFY_CMD=scripts/notify-telegram.sh
 */

const TELEGRAM_MAX_CHARS = 4096;

function fail(message, code = 1) {
  process.stderr.write(`${maskToken(message)}\n`);
  process.exit(code);
}

/** Strip the bot token from anything on its way to a log. */
function maskToken(text) {
  let out = String(text);
  for (const name of ["TELEGRAM_BOT_TOKEN", "HERMES_TELEGRAM_TOKEN"]) {
    const token = process.env[name];
    if (token && token.length >= 8) out = out.split(token).join("[redacted-token]");
  }
  return out.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[redacted-token]");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Fit the message into Telegram's limit without dropping the disclosure.
 *
 * The disclosure is the final paragraph and is legally load-bearing, so the
 * headline is what gets shortened, never the tail.
 */
function fit(message) {
  if (message.length <= TELEGRAM_MAX_CHARS) return message;

  const separator = message.lastIndexOf("\n\n");
  if (separator === -1) return `${message.slice(0, TELEGRAM_MAX_CHARS - 3)}...`;

  const head = message.slice(0, separator);
  const tail = message.slice(separator);
  const room = TELEGRAM_MAX_CHARS - tail.length - 4;
  if (room <= 0) return tail.trim().slice(0, TELEGRAM_MAX_CHARS);
  return `${head.slice(0, room)}...${tail}`;
}

async function main() {
  // Prefer the official token; accept Hermes isolated-assistant naming.
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.HERMES_TELEGRAM_TOKEN;
  // Chat id may come from detect-notify wiring or existing OpenClaw/Hermes env.
  const chatId = (
    process.env.WATCHTRENDS_NOTIFY_TARGET ||
    process.env.TELEGRAM_CHAT_ID ||
    process.env.TELEGRAM_CONTEXT_ALERT_CHAT_ID ||
    process.env.TELEGRAM_HOME_CHANNEL ||
    process.env.HERMES_TELEGRAM_USER ||
    ""
  ).replace(/^telegram:/i, "");

  if (!token) {
    fail(
      "TELEGRAM_BOT_TOKEN is not set. Reuse your existing OpenClaw/Hermes bot token — do not create a new bot. See references/notifications.md.",
      2
    );
  }
  if (!chatId) {
    fail(
      "No chat id found (WATCHTRENDS_NOTIFY_TARGET / TELEGRAM_CHAT_ID / TELEGRAM_CONTEXT_ALERT_CHAT_ID). Run node scripts/detect-notify.mjs first.",
      2
    );
  }

  const message = (await readStdin()).trim();
  if (!message) fail("Nothing arrived on stdin, so there was no message to send.", 2);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);

  let response;
  let body;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // No parse_mode: ticker names and payload text are remote data and must
      // not be interpreted as Markdown or HTML entities.
      body: JSON.stringify({
        chat_id: chatId,
        text: fit(message),
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    body = await response.json().catch(() => ({}));
  } catch (err) {
    fail(`Could not reach Telegram: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok || body?.ok !== true) {
    const detail = body?.description || `HTTP ${response.status}`;
    fail(`Telegram rejected the message: ${detail}`);
  }

  process.stdout.write(JSON.stringify({ ok: true, delivered: true }) + "\n");
}

main().catch((err) => fail(err?.message || String(err)));
