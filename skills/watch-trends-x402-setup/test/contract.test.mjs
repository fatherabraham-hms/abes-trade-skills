import assert from "node:assert/strict";
import test from "node:test";

import { apiPath } from "../scripts/lib/config.mjs";
import {
  CONTRACT,
  CLOSE_CODE_ACTIONS,
} from "../scripts/lib/constants.mjs";
import {
  findResource,
  parsePaymentRequired,
  validateContract,
} from "../scripts/lib/contract.mjs";
import { validateRequirement } from "../scripts/lib/x402.mjs";

const prefix = "/services/watch-trends/v1";
const root = {
  socket: {
    path: `${prefix}/ws/signals`,
    query: "token",
    session_ttl_minutes: 30,
    ping_interval_sec: 25,
    pong_timeout_sec: 10,
    one_connection_per_payer: true,
    client_must_pong: true,
  },
  lease_window_minutes: 30,
  paid_routes: [`POST ${prefix}/watches`],
};
const discovery = {
  version: "2",
  x402Version: 2,
  resources: [
    {
      method: "POST",
      resource: `${prefix}/socket/session`,
      x402: { scheme: "exact", amount: "10000" },
    },
    {
      method: "POST",
      resource: `${prefix}/watches`,
      x402: { scheme: "exact", amount: "10000" },
      inputSchema: {
        required: ["ticker", "segment", "threshold", "start_price"],
      },
    },
    {
      method: "GET",
      resource: `${prefix}/watches/{ticker}/events`,
      x402: { scheme: "exact", amount: "10000" },
    },
  ],
};

test("builds namespaced service paths", () => {
  assert.equal(apiPath({ servicePrefix: prefix }, "/socket/session"), `${prefix}/socket/session`);
});

test("accepts the v2 prefixed service contract", () => {
  assert.deepEqual(validateContract(root, discovery), []);
  assert.equal(findResource(discovery, "POST", `${prefix}/socket/session`).resource, `${prefix}/socket/session`);
});

test("parses outer v2 resource URL and amount", () => {
  const header = Buffer.from(JSON.stringify({
    x402Version: 2,
    resource: { url: `https://agents.smarterway.tech${prefix}/socket/session` },
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "0x7f985b1764f79faa42a4622bb605b23c8eb5abea",
      amount: "10000",
      maxTimeoutSeconds: 60,
    }],
  })).toString("base64");
  const parsed = parsePaymentRequired(header);
  assert.equal(parsed.version, 2);
  assert.equal(parsed.resource, `https://agents.smarterway.tech${prefix}/socket/session`);
  assert.equal(parsed.requirement.amount, "10000");
});

test("normalizes legacy Base network aliases without weakening asset checks", () => {
  const result = validateRequirement({
    scheme: "exact",
    network: "base",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo: "0x7f985b1764f79faa42a4622bb605b23c8eb5abea",
    amount: "10000",
    maxTimeoutSeconds: 60,
  }, {
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo: "0x7f985b1764f79faa42a4622bb605b23c8eb5abea",
    maxAmountAtomic: 10000n,
  }, `https://agents.smarterway.tech${prefix}/socket/session`,
  `https://agents.smarterway.tech${prefix}/socket/session`);
  assert.deepEqual(result.mismatches, []);
});

test("uses origin WebSocket close-code semantics", () => {
  assert.equal(CLOSE_CODE_ACTIONS[4002].action, "rebuy");
  assert.equal(CLOSE_CODE_ACTIONS[1013].action, "backoff");
  assert.equal(CLOSE_CODE_ACTIONS[4401].action, "terminal");
  assert.equal(CONTRACT.socketPath, `${prefix}/ws/signals`);
});
