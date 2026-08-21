#!/usr/bin/env node
/**
 * Desktop notify hook for Claude Code / Codex / Cursor hosts with no chat
 * channel. Reads STDIN and shows a local notification.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

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

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

async function main() {
  const message = (await readStdin()).trim();
  if (!message) fail("Nothing arrived on stdin, so there was no message to send.", 2);

  const headline = message.split("\n")[0].slice(0, 200);
  const body = message.slice(0, 1000);

  const notifySend = which("notify-send");
  const terminalNotifier = which("terminal-notifier");

  let child;
  if (notifySend) {
    child = spawn(notifySend, ["watch-trends", body], { stdio: ["ignore", "ignore", "pipe"] });
  } else if (terminalNotifier) {
    child = spawn(
      terminalNotifier,
      ["-title", "watch-trends", "-message", headline],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
  } else {
    fail("Neither notify-send nor terminal-notifier is on PATH.", 2);
  }

  let stderr = "";
  child.stderr.on("data", (c) => {
    if (stderr.length < 1000) stderr += c.toString();
  });

  const code = await new Promise((resolve) => {
    child.on("error", (err) => fail(`Desktop notify failed: ${err.message}`, 2));
    child.on("close", resolve);
  });

  if (code !== 0) fail(`Desktop notify exited ${code}${stderr ? `: ${stderr.trim()}` : ""}`);
  process.stdout.write(JSON.stringify({ ok: true, delivered: true, via: "desktop" }) + "\n");
}

main().catch((err) => fail(err?.message || String(err)));
