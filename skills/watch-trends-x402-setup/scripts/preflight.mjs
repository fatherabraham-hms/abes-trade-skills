#!/usr/bin/env node
/**
 * Host preflight. Spends nothing and touches no network.
 *
 * Reports which credential NAMES are set. It never reads a value back, so the
 * agent can confirm setup without a secret ever entering the transcript.
 *
 * Usage: node scripts/preflight.mjs
 */

import fs from "node:fs";

import { cdpCredentialStatus, ensureStateDir, loadConfig, missingCdpCredentials } from "./lib/config.mjs";
import { dependenciesInstalled, installedVersions } from "./lib/cdp.mjs";
import { emit, run } from "./lib/output.mjs";

const STAGE = "preflight";
const MIN_NODE_MAJOR = 22;

run(STAGE, async () => {
  const problems = [];
  const warnings = [];

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (nodeMajor < MIN_NODE_MAJOR) {
    problems.push({
      code: "node_runtime_missing",
      message: `Node ${MIN_NODE_MAJOR}+ is required; this host has ${process.versions.node}.`,
    });
  }

  const deps = dependenciesInstalled();
  if (!deps.ok) {
    problems.push({
      code: "deps_not_installed",
      message: `Missing pinned dependencies: ${deps.missing.join(", ")}. Run "npm ci" inside the skill directory.`,
    });
  }

  const config = loadConfig();

  let stateDirWritable = false;
  try {
    ensureStateDir();
    const probe = `${config.stateDir}/.write-probe`;
    fs.writeFileSync(probe, "ok", { mode: 0o600 });
    fs.unlinkSync(probe);
    stateDirWritable = true;
  } catch (err) {
    problems.push({
      code: "state_dir_unwritable",
      message: `Cannot write to ${config.stateDir}: ${err.message}. Set WATCHTRENDS_STATE_DIR to a writable path.`,
    });
  }

  const credentials = cdpCredentialStatus();
  const missing = missingCdpCredentials();
  if (missing.length) {
    problems.push({
      code: "cdp_credentials_missing",
      message:
        `These CDP variables are not set: ${missing.join(", ")}. ` +
        "Follow https://docs.cdp.coinbase.com/x402/buyer/quickstart to create them in the CDP portal, " +
        "export CDP_API_KEY_ID / CDP_API_KEY_SECRET / CDP_WALLET_SECRET, then reload " +
        "(Linux/macOS: source ~/.bashrc or ~/.zshrc and restart the agent; " +
        "Windows: close all terminals, open a new one, restart the agent). " +
        "Legacy CB_AGENT_KIT_* names still work. Do not paste values into chat.",
    });
  }

  if (config.rejectedSecretsInConfigFile.length) {
    problems.push({
      code: "secret_in_public_config",
      message:
        `${config.configFile} contains secret keys (${config.rejectedSecretsInConfigFile.join(", ")}). ` +
        "They were ignored, not loaded. Remove them from that file and set them in your secret store instead.",
    });
  }

  if (!config.notifyCmd) {
    warnings.push({
      code: "notify_not_configured",
      message:
        "No WATCHTRENDS_NOTIFY_CMD is set. Signals will still be spooled locally, but you will only see them when you next ask the agent.",
    });
  }

  const ok = problems.length === 0;
  emit({
    ok,
    stage: STAGE,
    code: ok ? "ok" : problems[0].code,
    node_version: process.versions.node,
    platform: `${process.platform}/${process.arch}`,
    dependencies: installedVersions(),
    state_dir: config.stateDir,
    state_dir_writable: stateDirWritable,
    config_file: config.configFile,
    credentials_present: credentials.map((c) => ({ name: c.name, set: c.set })),
    api_base_url: config.apiBaseUrl,
    cdp_account_name: config.accountName,
    problems,
    warnings,
    next_action: ok
      ? "Host looks ready. Run scripts/budget-plan.mjs to see projected cost, then scripts/doctor.mjs."
      : problems[0].message,
  });
});
