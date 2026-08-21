#!/usr/bin/env node
/**
 * OpenClaw notify hook. Reads the message from STDIN and sends it through the
 * user's already-configured OpenClaw channel (usually Telegram).
 *
 * Requires:
 *   WATCHTRENDS_NOTIFY_TARGET  — chat id / @user / channel target
 *   openclaw on PATH with Telegram (or another channel) already set up
 *
 * Optional:
 *   WATCHTRENDS_NOTIFY_CHANNEL — defaults to telegram
 */

import { spawn } from "node:child_process";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

async function main() {
  const target = process.env.WATCHTRENDS_NOTIFY_TARGET || process.env.TELEGRAM_CHAT_ID;
  const channel = process.env.WATCHTRENDS_NOTIFY_CHANNEL || "telegram";
  if (!target) {
    fail(
      "WATCHTRENDS_NOTIFY_TARGET is not set. Run node scripts/detect-notify.mjs and confirm the existing OpenClaw channel.",
      2
    );
  }

  const message = (await readStdin()).trim();
  if (!message) fail("Nothing arrived on stdin, so there was no message to send.", 2);

  const child = spawn(
    "openclaw",
    ["message", "send", "--channel", channel, "--target", String(target), "--message", message],
    { stdio: ["ignore", "pipe", "pipe"], env: process.env }
  );

  let stderr = "";
  child.stderr.on("data", (c) => {
    if (stderr.length < 2000) stderr += c.toString();
  });
  child.stdout.on("data", () => {});

  const code = await new Promise((resolve) => {
    child.on("error", (err) => {
      fail(`Could not run openclaw: ${err.message}. Is openclaw on PATH?`, 2);
    });
    child.on("close", resolve);
  });

  if (code !== 0) {
    fail(`openclaw message send exited ${code}${stderr ? `: ${stderr.trim().slice(0, 300)}` : ""}`);
  }
  process.stdout.write(JSON.stringify({ ok: true, delivered: true, via: "openclaw", target }) + "\n");
}

main().catch((err) => fail(err?.message || String(err)));
