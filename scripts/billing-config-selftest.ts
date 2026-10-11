/* Offline checks for lib/billing/config.ts: the markup gate as every money path reads it, and the
 * fee/charge-day fallback for clients with no billing row. config.ts is server-only, so this runs
 * with react-server conditions (`npm run test:billing-config`); it never touches the database. */
import assert from "node:assert/strict";
import { chargeTerms, rowToClientBilling, type BillingSettings } from "../lib/billing/config";

const settings: BillingSettings = {
  markupBps: 2000,
  feeCents: 30000,
  anchorDay: 3,
  currency: "usd",
  alertEmail: null,
  updatedAt: null,
};
const row = { olivia_client_id: "c1", enabled: true, markup_bps: 1500, fee_cents: null, anchor_day: null };

// ---- markup unreleased (flag unset): whatever is stored, the client is charged usage at cost ----
delete process.env.BILLING_MARKUP_ENABLED;
assert.equal(rowToClientBilling(row, settings).effective.markupBps, 0, "a stored override is not charged");
assert.equal(rowToClientBilling({ ...row, markup_bps: null }, settings).effective.markupBps, 0, "the default is not charged");
assert.equal(rowToClientBilling(row, settings).overrides.markupBps, 1500, "the stored override is kept for later");

// ---- released: the override wins, else the platform default ----
process.env.BILLING_MARKUP_ENABLED = "true";
assert.equal(rowToClientBilling(row, settings).effective.markupBps, 1500);
assert.equal(rowToClientBilling({ ...row, markup_bps: null }, settings).effective.markupBps, 2000);
delete process.env.BILLING_MARKUP_ENABLED;

// ---- chargeTerms: the client's effective values, or the platform defaults before it has a row ----
assert.deepEqual(chargeTerms(null, settings), { feeCents: 30000, anchorDay: 3 });
assert.deepEqual(
  chargeTerms(rowToClientBilling({ ...row, fee_cents: 50000, anchor_day: 10 }, settings), settings),
  { feeCents: 50000, anchorDay: 10 },
);

console.log("billing-config-selftest: OK");
