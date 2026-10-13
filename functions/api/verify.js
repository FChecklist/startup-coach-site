// Confirms a payment. The browser only REPORTS the result; this function checks Razorpay's signature (HMAC with the account secret),
// then asks Razorpay itself what happened (the order's own amount, the payment's own status) before saying "paid" and sending e-mails.
// Every confirmed try is also written to this website's own ledger (C, _ledgerc.js): the attempt (success or failure), the payment's fee, tax, method and bank
// reference. The buyer's details come from that ledger row (the Razorpay order notes can lose some when the order is opened through the central service).
// The confirmation e-mails are sent by _confirm.js, shared with /api/webhook: whichever of the two arrives first sends them, the other sends nothing (once per payment).
import { later, markDirty, markPaid, paymentByOrder, pushSummaries, recordAttempt } from "./_ledgerc.js";
import { sendConfirmation } from "./_confirm.js";
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
async function hmac(secret, msg) { const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return hex(await crypto.subtle.sign("HMAC", k, enc.encode(msg))); }
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

async function rzp(env, path, init = {}) {
  const r = await fetch((env.RAZORPAY_BASE_URL || "https://api.razorpay.com") + path, { ...init, headers: { authorization: "Basic " + btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`), "content-type": "application/json" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.description || "Razorpay error");
  return j;
}

// Tell the central ledger (IT Services) about a verified payment. Best effort: it never blocks or fails the buyer; the central webhook records it too.
async function reportToCentral(env, orderId, payId, sig) {
  if (!env.PAY_SERVICE_KEY) return null;
  try { const r = await fetch((env.PAY_SERVICE_URL || "https://itservices-rajat-agarwal.pages.dev").replace(/\/+$/, "") + "/api/pay/verify", { method: "POST", headers: { "content-type": "application/json", "x-site-key": env.PAY_SERVICE_KEY }, signal: AbortSignal.timeout(4000), body: JSON.stringify({ site: "rajat-agarwal-startup-coach.pages.dev", razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: sig }) }); return r.ok ? await r.json().catch(() => null) : null; } catch { return null; /* the webhook records it */ }
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ error: "Not allowed." }, 403);
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return json({ error: "Online payment is not switched on." }, 503);
  const raw = await request.text();
  if (raw.length > 2048) return json({ error: "Request too large." }, 413);
  let b; try { b = JSON.parse(raw); } catch { return json({ error: "Bad request." }, 400); }
  const orderId = String(b?.razorpay_order_id ?? ""), payId = String(b?.razorpay_payment_id ?? ""), sig = String(b?.razorpay_signature ?? "");
  if (!/^order_\w{6,40}$/.test(orderId) || !/^pay_\w{6,40}$/.test(payId) || !/^[0-9a-f]{64}$/.test(sig)) return json({ error: "We could not match this payment." }, 400);
  if (!same(await hmac(env.RAZORPAY_KEY_SECRET, `${orderId}|${payId}`), sig)) return json({ error: "The payment could not be verified. If money was taken, write to rajatsiroffice@gmail.com with your payment ID." }, 400);
  let order, pay;
  try { [order, pay] = await Promise.all([rzp(env, `/v1/orders/${orderId}`), rzp(env, `/v1/payments/${payId}`)]); }
  catch { return json({ error: "We could not reach the payment service to confirm. Your payment is safe; please check again in a minute." }, 502); }
  if (pay.order_id !== orderId || Number(pay.amount) !== Number(order.amount) || pay.currency !== "INR") return json({ error: "The payment details did not match the order." }, 400);
  const db = env.DB, now = Date.now();
  const row = db ? await paymentByOrder(db, orderId) : null; // this website's own record of the booking (ledger C)
  if (row && Number(row.amount_minor) !== Number(order.amount)) return json({ error: "The payment details did not match the order." }, 400);
  const note = async (ent, status) => { if (!db) return; try { await recordAttempt(db, ent, status, now, now, row?.id ?? null); await markDirty(db); } catch { /* a ledger line must never undo a paid booking */ } };
  if (pay.status === "created") return json({ confirming: true, message: "Confirming your payment..." }, 202);
  if (pay.status === "authorized") {
    try { pay = await rzp(env, `/v1/payments/${payId}/capture`, { method: "POST", body: JSON.stringify({ amount: order.amount, currency: "INR" }) }); }
    catch { try { pay = await rzp(env, `/v1/payments/${payId}`); } catch { /* auto-capture or an earlier capture may have finished it */ } }
  } else if (pay.status !== "captured") { if (pay.status === "failed") await note(pay, "failed"); await later(ctx, () => pushSummaries(env, Date.now())); return json({ error: `The payment is ${pay.status}. Nothing was charged to your order.` }, 402); }
  const central = await reportToCentral(env, orderId, payId, sig);
  if (db) {
    try {
      if (pay.status === "captured") { await recordAttempt(db, pay, "captured", now, now, row?.id ?? null); if (row) await markPaid(db, row.id, pay, central, now); }
      else await recordAttempt(db, pay, "authorized", now, now, row?.id ?? null); // capture not confirmed yet: Razorpay's webhook completes it
      await markDirty(db);
    } catch { /* a ledger line must never undo a paid booking */ }
    await later(ctx, () => pushSummaries(env, Date.now()));
  }
  const c = await sendConfirmation(env, { db, row, orderId, payId, order, now });
  const n = c.n;
  return json({ ok: true, accessLink: c.accessLink, paymentId: payId, orderId, total: c.total, startups: c.startups, startup: n.startup, name: n.name, email: n.email, mailed: c.sent, ownerMailed: c.ownerSent });
}
export const onRequest = () => json({ error: "Not found." }, 404);
