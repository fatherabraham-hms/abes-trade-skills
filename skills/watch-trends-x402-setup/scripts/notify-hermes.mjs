#!/usr/bin/env node
/**
 * Hermes notify hook. Reads the message from STDIN and pipes it to
 * `hermes send --to <target>`, reusing the user's existing Hermes messaging
 * credentials. No new bot is created.
 *
 * Requires:
 *   WATCHTRENDS_NOTIFY_TARGET  — e.g. telegram, telegram:123, discord:#ops
 *   hermes on PATH
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
  const target =
    process.env.WATCHTRENDS_NOTIFY_TARGET ||
    process.env.TELEGRAM_HOME_CHANNEL ||
    process.env.HERMES_TELEGRAM_USER;
  if (!target) {
    fail(
      "WATCHTRENDS_NOTIFY_TARGET is not set. Run node scripts/detect-notify.mjs and confirm the existing Hermes channel.",
      2
    );
  }

  const message = (await readStdin()).trim();
  if (!message) fail("Nothing arrived on stdin, so there was no message to send.", 2);

  const to = String(target).includes(":") || /^(telegram|discord|slack)$/i.test(String(target))
    ? String(target)
    : `telegram:${target}`;

  const child = spawn("hermes", ["send", "--to", to], {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  let stderr = "";
  child.stderr.on("data", (c) => {
    if (stderr.length < 2000) stderr += c.toString();
  });
  child.stdout.on("data", () => {});

  child.stdin.on("error", () => {});
  child.stdin.end(message);

  const code = await new Promise((resolve) => {
    child.on("error", (err) => {
      fail(`Could not run hermes: ${err.message}. Is hermes on PATH?`, 2);
    });
    child.on("close", resolve);
  });

  if (code !== 0) {
    fail(`hermes send exited ${code}${stderr ? `: ${stderr.trim().slice(0, 300)}` : ""}`);
  }
  process.stdout.write(JSON.stringify({ ok: true, delivered: true, via: "hermes", target: to }) + "\n");
}

main().catch((err) => fail(err?.message || String(err)));
