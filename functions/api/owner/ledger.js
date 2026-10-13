// GET /api/owner/ledger?month=YYYY-MM[&format=csv]: this website's own payment ledger (C) for one Indian month. OWNER ONLY (Authorization: Bearer <OWNER_LEDGER_KEY>).
// Anybody else, and any other method, gets the same 404 as an address that does not exist. No payer name, e-mail or phone is returned: the startup's name only.
import { isOwner, ownerLedger, later, pushSummaries } from "../_ledgerc.js";
const gone = () => new Response(JSON.stringify({ error: "Not found." }), { status: 404, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  if (!env.DB || !isOwner(request, env)) return gone();
  await later(ctx, () => pushSummaries(env, Date.now())); // a change that waited inside the 30-minute window goes now
  return ownerLedger(env, new URL(request.url), Date.now());
}
export const onRequest = () => gone();
