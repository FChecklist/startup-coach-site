// Razorpay's webhook for this website (A -> C). Razorpay calls the central service first; the central service records the payment in B and passes the message
// on here with Razorpay's own signature. The signature is checked with this website's copy of the webhook secret (RAZORPAY_WEBHOOK_SECRET) before anything is read.
// What it does: keeps every attempt (authorized, captured, failed, with the reason), marks the booking paid on a capture, keeps refunds. It never sends e-mails
// (that stays with /api/verify, once per payment) and it never moves a status backwards. A repeated delivery (same x-razorpay-event-id, or the same message) is answered and ignored.
import { attemptStatusOf, derivedEventKey, eventSeen, hmacHex, later, logWebhook, markDirty, markEventSeen, markPaid, paymentByOrder, pushSummaries, recordAttempt, recordRefund, same } from "./_ledgerc.js";
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function onRequestPost(ctx) {
  const { request, env } = ctx, db = env.DB, now = Date.now();
  const raw = await request.text();
  const eventId = request.headers.get("x-razorpay-event-id");
  const log = async (res, outcome, f = {}) => { if (db) await logWebhook(db, now, { eventId, signatureOk: true, outcome, status: res.status, ...f }); return res; };
  if (!db) return json({ error: "Ledger is not set up." }, 503);
  if (!env.RAZORPAY_WEBHOOK_SECRET) return json({ error: "Webhook secret is not set." }, 503);
  if (raw.length > 100_000 || !same(await hmacHex(env.RAZORPAY_WEBHOOK_SECRET, raw), request.headers.get("x-razorpay-signature") ?? "")) return log(json({ error: "Bad signature." }, 400), "bad signature", { signatureOk: false });
  let ev; try { ev = JSON.parse(raw); } catch { return log(json({ error: "Bad body." }, 400), "bad body"); }
  const ent = ev?.payload?.payment?.entity, ord = ev?.payload?.order?.entity, orderId = ent?.order_id ?? ord?.id ?? null;
  const seen = { event: typeof ev?.event === "string" ? ev.event.slice(0, 60) : null, orderId, rzpPaymentId: ent?.id ?? null };
  const dedupe = eventId ?? derivedEventKey(ev);
  if (dedupe && (await eventSeen(db, dedupe))) return log(json({ ok: true, duplicate: dedupe }), "duplicate event ignored", seen);
  const evMs = Number(ev?.created_at) > 0 ? Number(ev.created_at) * 1000 : now; // the gateway's own time of the event (capture time is not on the payment itself)
  const answer = async () => {
    const rf = ev?.payload?.refund?.entity;
    if (typeof ev?.event === "string" && ev.event.startsWith("refund.") && rf) {
      try { await recordRefund(db, ev.event, rf, now); await markDirty(db); } catch { return log(json({ error: "Could not record the refund." }, 500), "refund failed", seen); } // 500: Razorpay delivers again
      return log(json({ ok: true, refund: rf.id ?? null }), `refund recorded: ${ev.event}`, seen);
    }
    const status = typeof ev?.event === "string" ? attemptStatusOf(ev.event) : null;
    if (!status || !ent?.id || !orderId) return log(json({ ok: true, ignored: ev?.event ?? null }), "ignored: not a payment event", seen);
    const row = await paymentByOrder(db, orderId);
    if (!row) return log(json({ ok: true, ignored: "unknown order" }), "ignored: unknown order", seen);
    try {
      await recordAttempt(db, ent, status, evMs, now, row.id);
      if (status === "captured" && Number(ent.amount) === Number(row.amount_minor)) await markPaid(db, row.id, ent, null, now); // never mark paid an order that was paid a different amount
      await markDirty(db);
    } catch { return log(json({ error: "Could not record the payment." }, 500), "attempt failed", { ...seen, paymentId: row.id }); }
    if (status === "captured" && Number(ent.amount) !== Number(row.amount_minor)) return log(json({ ok: true, ignored: "amount mismatch" }), "attempt kept, not marked paid: amount mismatch", { ...seen, paymentId: row.id });
    return log(json({ ok: true, attempt: status }), `attempt recorded: ${status}`, { ...seen, paymentId: row.id });
  };
  const res = await answer();
  if (dedupe && res.status < 300) await markEventSeen(db, dedupe, seen.event, now);
  await later(ctx, () => pushSummaries(env, Date.now()));
  return res;
}
export const onRequest = () => json({ error: "Not found." }, 404);
