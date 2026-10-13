// Starts a payment: validates the booking details and asks Razorpay (the account of IT Services by Rajat Agarwal) for an Order.
// The price is decided HERE, never by the browser. The browser opens Razorpay's window inside the registered website's pay frame (HOP_URL),
// then sends the signed result to /api/verify. The booking is written to this website's own ledger (C, see _ledgerc.js) the moment the buyer starts paying,
// with its txn_id (COA-<payment id>); the same txn_id travels in the Razorpay order notes (A) and the central ledger (B).
import { later, openPayment, attachOrder, voidPayment, pushSummaries, txnIdOf } from "./_ledgerc.js";
const PRICE_INR = 19999; // per startup, GST not charged (IT Services by Rajat Agarwal is not GST registered)
const MAX_STARTUPS = 5;
const TERMS_VERSION = "2026-10-13";
const K7_A = "I agree to the Terms, the Privacy Policy and the Refund Policy linked here. I understand there is no promise of funding or results."; // the exact wording of the box the buyer ticked (CONSENT K7, box A)
const sha16 = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
const HOP_URL = "https://itservices-rajat-agarwal.pages.dev/payframe/";
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
const clean = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
// Indian payers see UPI first (on a phone this opens their UPI app); cards, net banking and wallets stay one tap away.
const UPI_FIRST = { display: { blocks: { upi: { name: "Pay with UPI", instruments: [{ method: "upi" }] }, other: { name: "Cards, net banking, wallets", instruments: [{ method: "card" }, { method: "netbanking" }, { method: "wallet" }] } }, sequence: ["block.upi", "block.other"], preferences: { show_default_blocks: false } } };

// Central payments (2026-10-12): the order is opened through IT Services by Rajat Agarwal so it lands in the ONE Razorpay ledger as
// razorpay / IT Services / rajat-agarwal-startup-coach / sales / startups_N. Without PAY_SERVICE_KEY, or if the central service cannot be reached, it is opened directly as before.
const SITE = "rajat-agarwal-startup-coach.pages.dev";
async function centralOrder(env, o) {
  if (!env.PAY_SERVICE_KEY) return null;
  try {
    const r = await fetch((env.PAY_SERVICE_URL || "https://itservices-rajat-agarwal.pages.dev").replace(/\/+$/, "") + "/api/pay/order", {
      method: "POST", headers: { "content-type": "application/json", "x-site-key": env.PAY_SERVICE_KEY }, signal: AbortSignal.timeout(6000),
      body: JSON.stringify({ site: SITE, product: "startup_coach", plan: o.plan, amount_minor: o.amount, currency: "INR", payment_ref: o.receipt, payer_email: o.email, payer_phone: o.phone, extra_notes: o.notes }),
    });
    const d = await r.json().catch(() => ({}));
    return r.ok && d.orderId ? { id: d.orderId } : null;
  } catch { return null; }
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ error: "Not allowed." }, 403);
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return json({ error: "Online payment is being switched on. Please call or WhatsApp +91 96503 97480 to book your seat.", off: true }, 503);
  const raw = await request.text();
  if (raw.length > 4096) return json({ error: "Request too large." }, 413);
  let b; try { b = JSON.parse(raw); } catch { return json({ error: "Bad request." }, 400); }
  if (!b || typeof b !== "object") return json({ error: "Bad request." }, 400);
  if (b.website) return json({ error: "Not allowed." }, 400); // honeypot: real people never fill this field
  const cs = b.consent; // the box must be ticked AND the request must carry the current version of the Terms
  if (!cs || typeof cs !== "object" || cs.v !== TERMS_VERSION || !Array.isArray(cs.boxes) || !cs.boxes.includes("A")) return json({ error: "Please tick the box to continue.", code: "consent-required", kind: "K7", version: TERMS_VERSION }, 400);
  const name = clean(b.name, 80), startup = clean(b.startup, 100), email = clean(b.email, 120).toLowerCase();
  const digits = String(b.phone ?? "").replace(/\D/g, "").replace(/^(91|0)+(?=\d{10}$)/, "");
  const qty = Number(b.qty ?? 1);
  if (name.length < 2) return json({ error: "Please enter your name." }, 400);
  if (startup.length < 2) return json({ error: "Please enter your startup's name." }, 400);
  if (!EMAIL.test(email)) return json({ error: "Please enter a valid e-mail address." }, 400);
  if (!/^[6-9]\d{9}$/.test(digits)) return json({ error: "Please enter a valid 10-digit Indian mobile number." }, 400);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_STARTUPS) return json({ error: `You can book 1 to ${MAX_STARTUPS} startups at a time.` }, 400);
  const total = PRICE_INR * qty;
  const payId = "sc_" + rand(8), receipt = payId, txn = txnIdOf(payId), now = Date.now(), plan = `startups_${qty}`;
  // Razorpay allows 15 notes in all. Through the central service it adds site, stream, product, plan, variation, payment_ref and txn_id (7) and keeps only the first
  // 9 of ours, so the buyer's details come first; the title and the unit price are the two it can lose.
  const buyer = { consent: `K7|${TERMS_VERSION}|A|${await sha16(K7_A)}|${new Date().toISOString()}`, startup, startups: String(qty), name, email, mobile: "+91" + digits, brand: "Rajat Agarwal, Startup Coach" };
  const extra = { ...buyer, title: "Startup coaching program (12 steps)", per_startup_inr: String(PRICE_INR) };
  const notes = { product: "startup_coach", variation: plan, plan, site: SITE, stream: "sales", payment_ref: payId, txn_id: txn, ...buyer };
  const db = env.DB; let ledger = false;
  if (db) { try { await openPayment(db, { id: payId, amountMinor: total * 100, startups: qty, org: startup, name, email, phone: "+91" + digits }, now); ledger = true; } catch { /* the buyer is never stopped by the ledger */ } }
  let order = await centralOrder(env, { plan, amount: total * 100, receipt, email, phone: "+91" + digits, notes: extra });
  try {
    if (!order) { const r = await fetch((env.RAZORPAY_BASE_URL || "https://api.razorpay.com") + "/v1/orders", {
      method: "POST",
      headers: { authorization: "Basic " + btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`), "content-type": "application/json" },
      body: JSON.stringify({ amount: total * 100, currency: "INR", receipt, notes }),
    });
    order = await r.json();
    if (!r.ok || !order?.id) { if (ledger) await voidPayment(db, payId, Date.now()).catch(() => {}); return json({ error: "The payment service could not start your payment. Please try again, or call +91 96503 97480." }, 502); } }
  } catch {
    if (ledger) await voidPayment(db, payId, Date.now()).catch(() => {});
    return json({ error: "The payment service is not reachable right now. Please try again in a minute." }, 502);
  }
  if (ledger) { try { await attachOrder(db, payId, order.id, Date.now()); } catch { /* verify still finds the buyer's details in the order notes */ } }
  if (db) await later(ctx, () => pushSummaries(env, Date.now())); // a change that waited inside the 30-minute window goes now
  return json({
    hop: env.HOP_URL || HOP_URL,
    razorpay: {
      keyId: env.RAZORPAY_KEY_ID, orderId: order.id, amount: total * 100, currency: "INR",
      name: "Rajat Agarwal, Startup Coach", description: "Startup coaching program | IT Services by Rajat Agarwal",
      prefill: { name, email, contact: "+91" + digits }, notes: { startup, startups: String(qty) }, theme: { color: "#F5820A" }, config: UPI_FIRST,
    },
    total, txnId: txn,
  });
}
export const onRequest = () => json({ error: "Not found." }, 404);
