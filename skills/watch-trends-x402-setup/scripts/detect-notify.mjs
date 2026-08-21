#!/usr/bin/env node
/**
 * Detect an existing notification channel and optionally wire it.
 *
 * Usage:
 *   node scripts/detect-notify.mjs
 *   node scripts/detect-notify.mjs --apply
 *   node scripts/detect-notify.mjs --apply --kind openclaw
 *
 * Never prints secrets. Never creates a Telegram bot.
 */

import { loadConfig } from "./lib/config.mjs";
import { applyNotifyCandidate, detectNotifyChannels } from "./lib/detect-notify.mjs";
import { fail, run, succeed } from "./lib/output.mjs";

run("detect_notify", async () => {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const kindFlag = args.indexOf("--kind");
  const kindFilter = kindFlag >= 0 ? args[kindFlag + 1] : null;

  // Ensure config.public is loaded so env overrides still win.
  loadConfig();

  const result = detectNotifyChannels();
  let pick = result.recommended;

  if (kindFilter) {
    pick = result.candidates.find((c) => c.kind === kindFilter) || null;
    if (!pick) {
      fail("detect_notify", "notify_not_configured",
        `No candidate of kind "${kindFilter}" was found.`,
        { ...result, next_action: "Re-run without --kind, or set up that runtime's channel first." });
    }
  }

  if (!apply) {
    succeed("detect_notify", {
      ...result,
      recommended: pick,
      code: pick ? "notify_channel_detected" : "notify_not_configured",
    });
  }

  if (!pick) {
    fail("detect_notify", "notify_not_configured",
      "Nothing to apply: no existing channel was detected.",
      {
        ...result,
        next_action:
          "Proceed with spool-only, or offer desktop notify if available. Do not walk the user through BotFather unless they explicitly ask.",
      });
  }

  if (pick.kind === "explicit") {
    succeed("detect_notify", {
      ...result,
      recommended: pick,
      code: "notify_channel_detected",
      message: "WATCHTRENDS_NOTIFY_CMD is already set; nothing written.",
      applied: null,
    });
  }

  if (!pick.apply) {
    fail("detect_notify", "notify_not_configured",
      `Candidate ${pick.kind} cannot be auto-wired.`,
      { recommended: pick, next_action: result.next_action });
  }

  const applied = applyNotifyCandidate(pick);
  // Also export into the current process so a follow-up doctor in the same
  // shell sees them if the agent sources config — config.public is the durable path.
  for (const [k, v] of Object.entries(applied.applied)) {
    if (v != null) process.env[k] = String(v);
  }

  succeed("detect_notify", {
    ...result,
    recommended: pick,
    code: "notify_channel_wired",
    message: `Wrote non-secret notify settings to ${applied.path}. Bot tokens were not written.`,
    applied: applied.applied,
    config_path: applied.path,
    next_action:
      "Run node scripts/doctor.mjs --notify to verify. Tell the user which existing channel will receive alerts; do not ask them to create a bot.",
  });
});
