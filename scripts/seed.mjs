// Provisioning seed (run with the service role). Idempotent.
//   node --env-file=.env scripts/seed.mjs
//
// (a) Calls Olivia discovery and upserts olivia_clients.
// (b) Creates/updates one test Supabase user and maps it -> one Olivia client_id
//     via workspace_members.
//
// Configure via env (all optional):
//   SEED_USER_EMAIL     default demo@heyemma.io
//   SEED_USER_PASSWORD  default: a generated strong password (written to .seed-credentials.txt)
//   SEED_CLIENT_ID      default: the "000. Emma Test Funnel" client
//
// There is intentionally NO self-serve agency-admin UI in v1 — re-run this script to
// (re)provision. See DECISIONS.md.

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const {
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  OLIVIA_API_KEY,
  OLIVIA_API_BASE = "https://www.lunarolivia.com",
} = process.env;

const SEED_EMAIL = process.env.SEED_USER_EMAIL || "demo@heyemma.io";
const SEED_PASSWORD = process.env.SEED_USER_PASSWORD || `Emma-${randomBytes(9).toString("base64url")}`;
const SEED_CLIENT_ID = process.env.SEED_CLIENT_ID || "01b1fb8e-2b65-4330-8f0d-ed631afa03bf";
// "member" (default) or "platform_admin" (can switch across all agency clients).
const SEED_ROLE = process.env.SEED_USER_ROLE || "member";

function need(name, val) {
  if (!val) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
}
need("NEXT_PUBLIC_SUPABASE_URL", NEXT_PUBLIC_SUPABASE_URL);
need("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);
need("OLIVIA_API_KEY", OLIVIA_API_KEY);

const admin = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---- (a) discovery -> upsert olivia_clients ----
const res = await fetch(`${OLIVIA_API_BASE}/api/v1/external/clients?limit=100`, {
  headers: { "x-api-key": OLIVIA_API_KEY },
});
if (!res.ok) {
  console.error(`Olivia discovery failed: HTTP ${res.status}`);
  process.exit(1);
}
const { clients = [] } = await res.json();
const rows = clients.map((c) => ({
  olivia_client_id: c.id,
  name: c.name ?? null,
  slug: c.slug ?? null,
  status: c.status ?? null,
  industry: c.industry ?? null,
  timezone: c.timezone ?? null,
  synced_at: new Date().toISOString(),
}));
if (rows.length) {
  const { error } = await admin.from("olivia_clients").upsert(rows, {
    onConflict: "olivia_client_id",
  });
  if (error) {
    console.error("Upsert olivia_clients failed:", error.message);
    process.exit(1);
  }
}
console.log(`✓ Upserted ${rows.length} olivia_clients`);

if (!clients.some((c) => c.id === SEED_CLIENT_ID)) {
  console.error(`Target SEED_CLIENT_ID ${SEED_CLIENT_ID} is not in this agency's clients.`);
  process.exit(1);
}

// ---- (b) create/find the test user ----
let userId;
const created = await admin.auth.admin.createUser({
  email: SEED_EMAIL,
  password: SEED_PASSWORD,
  email_confirm: true,
});
if (created.error) {
  // Likely already exists — find and reset its password.
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) {
    console.error("createUser + listUsers both failed:", created.error.message, listErr.message);
    process.exit(1);
  }
  const existing = list.users.find((u) => u.email?.toLowerCase() === SEED_EMAIL.toLowerCase());
  if (!existing) {
    console.error("createUser failed and no existing user found:", created.error.message);
    process.exit(1);
  }
  userId = existing.id;
  await admin.auth.admin.updateUserById(userId, { password: SEED_PASSWORD, email_confirm: true });
  console.log(`✓ Reused existing user ${SEED_EMAIL}`);
} else {
  userId = created.data.user.id;
  console.log(`✓ Created user ${SEED_EMAIL}`);
}

// ---- map user -> client ----
const { error: mapErr } = await admin
  .from("workspace_members")
  .upsert(
    { user_id: userId, olivia_client_id: SEED_CLIENT_ID, role: SEED_ROLE },
    { onConflict: "user_id" },
  );
if (mapErr) {
  console.error("workspace_members mapping failed:", mapErr.message);
  process.exit(1);
}
console.log(`✓ Mapped ${SEED_EMAIL} -> client ${SEED_CLIENT_ID} (role: ${SEED_ROLE})`);

writeFileSync(
  ".seed-credentials.txt",
  `# Hey Emma seeded test credentials (gitignored). Change the password after first login.\nEMAIL=${SEED_EMAIL}\nPASSWORD=${SEED_PASSWORD}\nCLIENT_ID=${SEED_CLIENT_ID}\n`,
);
console.log("✓ Credentials written to .seed-credentials.txt (gitignored)");
