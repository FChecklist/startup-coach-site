// POST /api/owner/retention[?apply=1]  (Authorization: Bearer <OWNER_LEDGER_KEY>). OWNER ONLY; anybody else gets the same 404 as an address that does not exist.
// Removes bookings that were started and never paid, after 30 days (functions/api/_retention.js). Billing data is never removed. It only COUNTS unless ?apply=1 is given AND the secret RETENTION_LIVE is "1". Not scheduled.
import { isOwner } from "../_ledgerc.js";
import { runRetention, RETENTION } from "../_retention.js";
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export async function onRequestPost({ request, env }) {
  if (!env.DB || !isOwner(request, env)) return J({ error: "Not found." }, 404);
  const live = env.RETENTION_LIVE === "1", apply = live && new URL(request.url).searchParams.get("apply") === "1";
  try { return J({ ok: true, live, applied: apply, dry_run: !apply, periods: RETENTION, result: await runRetention(env, { apply }) }); }
  catch (e) { return J({ error: String(e.message ?? e).slice(0, 200) }, 500); }
}
export const onRequest = () => J({ error: "Not found." }, 404);
