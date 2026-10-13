// LEDGER C of the Startup Coach website: its own payment ledger, connected to Razorpay (A) and to the central ledger B (IT Services by Rajat Agarwal).
// Rule since 2026-10-13: every payment, expense, revenue and commission is tracked at A, B and C with the same ids, nothing twice, nothing unclear.
// Same design as the five games' ledgerc.ts (spec: PAYMENT_LEDGER_ABC_SPEC_2026-10-13.md sections 2, 3, 5), written for this site's plain Pages Functions.
//
// THE IDS (each has exactly one meaning)
//   id / txn_id    id is this website's own payment id (sc_ + 16 hex), made when the buyer starts paying. txn_id = "COA-" + id. The same text is in
//                  Razorpay's order notes (A), in the central ledger (B, which builds it from payment_ref) and in payment.txn_id here (C).
//   rzp_order_id   Razorpay's order. One website payment has one order.
//   rzp_payment_id Razorpay's payment. One per ATTEMPT: a failed try and the paying try are two rows of payment_attempt under the one txn_id.
//   rzp_refund_id  Razorpay's refund, one row of payment_refund.
//
// WHAT IS KEPT PER ATTEMPT (success AND failure): amount, currency, status, method, bank, card network and type, the LAST FOUR digits of a card, a masked UPI id
// (ab***@bank), the bank reference (rrn), Razorpay's error code / description / reason, fee and GST on the fee, and the times of authorisation, capture and
// failure. A full card number or a full UPI id is never stored: this code never copies them out of Razorpay's message.
//
// ZERO DUPLICATION (enforced by the database, not by hope)
//   payment_attempt.rzp_payment_id PRIMARY KEY   an attempt is one row however many events arrive (INSERT .. ON CONFLICT DO UPDATE).
//   event_seen.rzp_event_id PRIMARY KEY          Razorpay's header x-razorpay-event-id (or a key made from the message); a repeated delivery is answered and ignored.
//   payment_refund.rzp_refund_id PRIMARY KEY     a refund is one row.   payment.txn_id UNIQUE   one website payment is one row.
//   An attempt's status only moves forward (failed -> authorized -> captured): a late "failed" message never undoes a capture. A failed attempt never marks
//   the payment paid; a later captured attempt of the same payment still does (a buyer may fail once and pay on the second try).
//
// HOW C IS COMPARED WITH B (the owner report puts them side by side; the known, honest differences)
//   1. Month and time: both use the INDIAN month (IST). B places a sale at its captured time; C at paid_ms, the moment THIS website confirmed it (seconds later).
//   2. A sale in C is a payment that is PAID and has a Razorpay payment id (money really moved).
//   3. fee_minor is Razorpay's fee INCLUDING the GST on it; tax_minor is that GST.
//   4. Refunds: B counts every refund row it holds; C counts refunds that are not "failed".
//   5. This site has no commission: the commission figures sent to B are 0.
//   6. Failed: C counts attempts that failed (by failure time); an attempt that failed and then captured (same Razorpay payment id) is a sale, not a failure.
//
// SENDING THE MONTH TO B: after any payment change the figures of this month and last month go to POST /api/pay/site-summary, at most once every 30 minutes
// (a failed try is repeated after 5 minutes). A change that arrives inside the 30 minutes is kept (ledger_state.dirty) and sent by the next request of any kind
// (a visitor starting to pay, a Razorpay message, the owner opening the ledger): a static site has no clock of its own.

export const SITE_CODE = "COA";
export const SITE_HOST = "rajat-agarwal-startup-coach.pages.dev";
export const SITE_PRODUCT = "startup_coach";
export const txnIdOf = (paymentId) => `${SITE_CODE}-${String(paymentId).slice(0, 60)}`;
export const planOf = (startups) => `startups_${startups}`;

const IST = 19_800_000;
const enc = new TextEncoder();
const num = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const str = (v, max = 300) => (v === null || v === undefined || v === "" ? null : String(v).slice(0, max));
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export const hmacHex = async (secret, msg) => { const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg))), (b) => b.toString(16).padStart(2, "0")).join(""); };
export const same = (a, b) => { a = String(a ?? ""); b = String(b ?? ""); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
/** A UPI id is kept masked (ab***@bank): enough to recognise, never enough to use. */
export const maskVpa = (v) => { const s = str(v, 120); if (!s) return null; const i = s.indexOf("@"); return i > 0 ? s.slice(0, Math.min(2, i)) + "***" + s.slice(i) : s.slice(0, 2) + "***"; };

/** The central service this website reports to; null when this website has no key for it (tests, local runs). */
export const centralOf = (env) => (env.PAY_SERVICE_KEY ? { url: (env.PAY_SERVICE_URL || "https://itservices-rajat-agarwal.pages.dev").replace(/\/+$/, ""), key: env.PAY_SERVICE_KEY, site: SITE_HOST } : null);
/** Runs a task after the answer was sent when the platform allows it (Pages `waitUntil`), else right away (tests). Never throws. */
export const later = (ctx, task) => { const p = Promise.resolve().then(task).catch(() => {}); if (ctx && typeof ctx.waitUntil === "function") { ctx.waitUntil(p); return Promise.resolve(); } return p; };

// ---------------------------------------------------------------- the website payment (C)
/** Writes the payment the moment the buyer starts paying (status "created"). Returns its txn_id. */
export async function openPayment(db, p, now) {
  const txn = txnIdOf(p.id);
  await db.prepare("INSERT INTO payment(id,txn_id,amount_minor,currency,plan,startups,org,payer_name,payer_email,payer_phone,status,created_ms,updated_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(p.id, txn, p.amountMinor, "INR", planOf(p.startups), p.startups, p.org, p.name, p.email, p.phone, "created", now, now).run();
  return txn;
}
export async function attachOrder(db, id, orderId, now) { await db.prepare("UPDATE payment SET rzp_order_id=?, updated_ms=? WHERE id=?").bind(orderId, now, id).run(); }
/** The order could not be opened: the row stays as a record but is not an open payment. */
export async function voidPayment(db, id, now) { await db.prepare("UPDATE payment SET status='void', updated_ms=? WHERE id=? AND status='created'").bind(now, id).run(); }
export async function paymentByOrder(db, orderId) { try { return (await db.prepare("SELECT * FROM payment WHERE rzp_order_id=?").bind(orderId).first()) ?? null; } catch { return null; } }

/** A confirmed capture: the payment becomes paid (once; the first captured attempt stays on the row), with fee, tax, method and bank reference. `central` is B's verify answer, used when Razorpay's own message lacks the fee. Returns true when this call made it paid. */
export async function markPaid(db, paymentId, ent, central, now) {
  const a = ent?.acquirer_data && typeof ent.acquirer_data === "object" ? ent.acquirer_data : null;
  const before = await db.prepare("SELECT status FROM payment WHERE id=?").bind(paymentId).first();
  await db.prepare(`UPDATE payment SET status=CASE WHEN status='created' THEN 'paid' ELSE status END, paid_ms=CASE WHEN status='created' THEN ? ELSE paid_ms END, rzp_payment_id=COALESCE(rzp_payment_id,?),
      fee_minor=COALESCE(fee_minor,?), tax_minor=COALESCE(tax_minor,?), method=COALESCE(method,?), bank=COALESCE(bank,?), card_network=COALESCE(card_network,?), card_type=COALESCE(card_type,?), rrn=COALESCE(rrn,?), updated_ms=? WHERE id=?`)
    .bind(now, str(ent?.id, 60), num(ent?.fee) ?? num(central?.fee_minor), num(ent?.tax) ?? num(central?.tax_minor), str(ent?.method ?? central?.method, 20), str(ent?.bank, 20), str(ent?.card?.network, 30), str(ent?.card?.type, 20), str(a?.rrn, 60), now, paymentId).run();
  return before?.status === "created";
}

// ---------------------------------------------------------------- attempts (A -> C)
/** Which attempt status a Razorpay event stands for; null for events that are not about a payment attempt. */
export function attemptStatusOf(event) {
  if (event === "payment.captured" || event === "order.paid") return "captured";
  if (event === "payment.authorized") return "authorized";
  if (event === "payment.failed") return "failed";
  return null;
}
const RANK = (col) => `(CASE ${col} WHEN 'captured' THEN 3 WHEN 'authorized' THEN 2 ELSE 1 END)`;

/** One Razorpay payment attempt (pay_...), from a webhook message or from a payment Razorpay returned. Idempotent; the status only moves forward. */
export async function recordAttempt(db, ent, status, evMs, now, paymentId) {
  const id = str(ent?.id, 60); if (!id) return;
  const a = ent.acquirer_data && typeof ent.acquirer_data === "object" ? ent.acquirer_data : null;
  const t = (s) => (status === s ? evMs : null);
  await db.prepare(`INSERT INTO payment_attempt(rzp_payment_id,payment_id,rzp_order_id,txn_id,status,currency,amount_minor,method,bank,card_network,card_type,card_last4,vpa_masked,rrn,error_code,error_description,error_reason,fee_minor,tax_minor,authorized_ms,captured_ms,failed_ms,event_ms,created_ms,updated_ms)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(rzp_payment_id) DO UPDATE SET
      status=CASE WHEN ${RANK("excluded.status")} >= ${RANK("payment_attempt.status")} THEN excluded.status ELSE payment_attempt.status END,
      payment_id=COALESCE(payment_attempt.payment_id,excluded.payment_id), rzp_order_id=COALESCE(payment_attempt.rzp_order_id,excluded.rzp_order_id), txn_id=COALESCE(payment_attempt.txn_id,excluded.txn_id),
      currency=COALESCE(excluded.currency,payment_attempt.currency), amount_minor=COALESCE(excluded.amount_minor,payment_attempt.amount_minor),
      method=COALESCE(excluded.method,payment_attempt.method), bank=COALESCE(excluded.bank,payment_attempt.bank), card_network=COALESCE(excluded.card_network,payment_attempt.card_network), card_type=COALESCE(excluded.card_type,payment_attempt.card_type),
      card_last4=COALESCE(excluded.card_last4,payment_attempt.card_last4), vpa_masked=COALESCE(excluded.vpa_masked,payment_attempt.vpa_masked), rrn=COALESCE(excluded.rrn,payment_attempt.rrn),
      error_code=COALESCE(payment_attempt.error_code,excluded.error_code), error_description=COALESCE(payment_attempt.error_description,excluded.error_description), error_reason=COALESCE(payment_attempt.error_reason,excluded.error_reason),
      fee_minor=COALESCE(excluded.fee_minor,payment_attempt.fee_minor), tax_minor=COALESCE(excluded.tax_minor,payment_attempt.tax_minor),
      authorized_ms=COALESCE(payment_attempt.authorized_ms,excluded.authorized_ms), captured_ms=COALESCE(payment_attempt.captured_ms,excluded.captured_ms), failed_ms=COALESCE(payment_attempt.failed_ms,excluded.failed_ms),
      event_ms=MAX(COALESCE(payment_attempt.event_ms,0),COALESCE(excluded.event_ms,0)), updated_ms=excluded.updated_ms`)
    .bind(id, paymentId, str(ent.order_id, 60), paymentId ? txnIdOf(paymentId) : null, status, str(ent.currency, 3), num(ent.amount), str(ent.method, 20), str(ent.bank, 20), str(ent.card?.network, 30), str(ent.card?.type, 20),
      ent.card?.last4 != null ? String(ent.card.last4).replace(/\D/g, "").slice(-4) || null : null, maskVpa(ent.vpa), str(a?.rrn, 60),
      status === "failed" ? str(ent.error_code, 80) : null, status === "failed" ? str(ent.error_description, 300) : null, status === "failed" ? str(ent.error_reason, 80) : null,
      num(ent.fee), num(ent.tax), t("authorized"), t("captured"), t("failed"), evMs, num(ent.created_at) ? Number(ent.created_at) * 1000 : null, now).run();
}

// ---------------------------------------------------------------- events (A -> C)
/** When the x-razorpay-event-id header did not arrive (the central service may pass the message on without it), the same event is still recognised: its name, the payment / refund / order it is about, and Razorpay's own time of it. */
export function derivedEventKey(ev) {
  const name = str(ev?.event, 60), id = str(ev?.payload?.payment?.entity?.id ?? ev?.payload?.refund?.entity?.id ?? ev?.payload?.order?.entity?.id, 80), at = num(ev?.created_at);
  return name && id && at ? `d:${name}:${id}:${at}` : null;
}
export async function eventSeen(db, eventId) { try { return !!(await db.prepare("SELECT 1 AS x FROM event_seen WHERE rzp_event_id=?").bind(eventId).first()); } catch { return false; } }
export async function markEventSeen(db, eventId, event, now) { try { await db.prepare("INSERT OR IGNORE INTO event_seen(rzp_event_id,event,seen_ms) VALUES(?,?,?)").bind(String(eventId).slice(0, 80), event ? String(event).slice(0, 60) : null, now).run(); } catch { /* the rows themselves are idempotent */ } }
export async function logWebhook(db, now, f) {
  try { await db.prepare("INSERT INTO webhook_log(at_ms,rzp_event_id,event,signature_ok,outcome,status,rzp_order_id,rzp_payment_id,payment_id) VALUES(?,?,?,?,?,?,?,?,?)").bind(now, str(f.eventId, 80), str(f.event, 60), f.signatureOk ? 1 : 0, str(f.outcome, 120), f.status ?? null, str(f.orderId, 60), str(f.rzpPaymentId, 60), str(f.paymentId, 60)).run(); } catch { /* a log line must never fail the answer */ }
}

const REFUND_RANK = (col) => `(CASE ${col} WHEN 'processed' THEN 2 WHEN 'failed' THEN 2 ELSE 1 END)`;
/** One Razorpay refund (rfnd_...) from refund.created / refund.processed / refund.failed. The same refund seen twice is one row. */
export async function recordRefund(db, event, r, now) {
  const id = str(r?.id, 60), pay = str(r?.payment_id, 60); if (!id || !pay) return false;
  const status = event === "refund.processed" ? "processed" : event === "refund.failed" ? "failed" : (str(r.status, 20) ?? "pending");
  const row = (await db.prepare("SELECT id FROM payment WHERE rzp_payment_id=?").bind(pay).first()) ?? (await db.prepare("SELECT payment_id AS id FROM payment_attempt WHERE rzp_payment_id=?").bind(pay).first());
  const pid = row?.id ?? null;
  await db.prepare(`INSERT INTO payment_refund(rzp_refund_id,rzp_payment_id,payment_id,txn_id,currency,amount_minor,status,created_ms,updated_ms) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(rzp_refund_id) DO UPDATE SET status=CASE WHEN ${REFUND_RANK("excluded.status")} >= ${REFUND_RANK("payment_refund.status")} THEN excluded.status ELSE payment_refund.status END, payment_id=COALESCE(payment_refund.payment_id,excluded.payment_id), txn_id=COALESCE(payment_refund.txn_id,excluded.txn_id), updated_ms=excluded.updated_ms`)
    .bind(id, pay, pid, pid ? txnIdOf(pid) : null, str(r.currency, 3), Math.max(0, Math.round(num(r.amount) ?? 0)), status, num(r.created_at) ? Number(r.created_at) * 1000 : now, now).run();
  return true;
}

// ---------------------------------------------------------------- monthly figures (C -> B)
export const monthKeyOf = (ms) => { const d = new Date(ms + IST); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
export const prevMonthKey = (key) => { const [y, m] = key.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };
/** [from, to) in UTC ms of one INDIAN month. */
export const monthRange = (key) => { const [y, m] = key.split("-").map(Number); return { from: Date.UTC(y, m - 1, 1) - IST, to: Date.UTC(y, m, 1) - IST }; };

/** The figures of one month, one object per currency (INR is always present), in the shape POST /api/pay/site-summary takes. */
export async function monthSummaries(db, site, key) {
  const { from, to } = monthRange(key), by = new Map();
  const get = (cur) => { let s = by.get(cur); if (!s) { s = { site, period_key: key, currency: cur, paid_count: 0, failed_count: 0, revenue_minor: 0, fee_minor: 0, tax_minor: 0, refunded_minor: 0, commission_accrued_minor: 0, commission_paid_minor: 0 }; by.set(cur, s); } return s; };
  get("INR");
  for (const r of (await db.prepare("SELECT currency AS cur, COUNT(*) AS n, COALESCE(SUM(amount_minor),0) AS rev, COALESCE(SUM(fee_minor),0) AS fee, COALESCE(SUM(tax_minor),0) AS tax FROM payment WHERE status='paid' AND rzp_payment_id IS NOT NULL AND paid_ms>=? AND paid_ms<? GROUP BY currency").bind(from, to).all()).results ?? []) { const s = get(r.cur); s.paid_count = r.n; s.revenue_minor = r.rev; s.fee_minor = r.fee; s.tax_minor = r.tax; }
  for (const r of (await db.prepare("SELECT COALESCE(a.currency,p.currency) AS cur, COUNT(*) AS n FROM payment_attempt a JOIN payment p ON p.id=a.payment_id WHERE a.status='failed' AND a.failed_ms>=? AND a.failed_ms<? GROUP BY 1").bind(from, to).all()).results ?? []) get(r.cur).failed_count = r.n;
  for (const r of (await db.prepare("SELECT COALESCE(r.currency,p.currency) AS cur, COALESCE(SUM(r.amount_minor),0) AS amt FROM payment_refund r JOIN payment p ON p.id=r.payment_id WHERE r.status IS NOT 'failed' AND p.rzp_payment_id IS NOT NULL AND r.created_ms>=? AND r.created_ms<? GROUP BY 1").bind(from, to).all()).results ?? []) get(r.cur).refunded_minor = r.amt;
  return [...by.values()];
}

const STATE_PUSH = "last_push_ms", STATE_TRY = "last_try_ms", STATE_DIRTY = "dirty";
export const SUMMARY_EVERY_MS = 30 * 60_000, SUMMARY_RETRY_MS = 5 * 60_000;
async function stateGet(db, k) { try { return Number((await db.prepare("SELECT v FROM ledger_state WHERE k=?").bind(k).first())?.v ?? 0) || 0; } catch { return 0; } }
async function stateSet(db, k, v) { await db.prepare("INSERT INTO ledger_state(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, String(v)).run(); }
/** Something in the ledger changed: the figures must reach B at the next allowed moment. */
export async function markDirty(db) { try { await stateSet(db, STATE_DIRTY, 1); } catch { /* the next change marks it again */ } }

/** Sends the current and the previous Indian month to B when something changed and the last send was 30+ minutes ago (a failed try is repeated after 5 minutes). Never throws. */
export async function pushSummaries(env, now, force = false) {
  try {
    const c = centralOf(env); if (!c || !env.DB) return { pushed: 0, skipped: "no central key" };
    const db = env.DB;
    if (!force) {
      if (!(await stateGet(db, STATE_DIRTY))) return { pushed: 0, skipped: "nothing changed" };
      if (now - (await stateGet(db, STATE_PUSH)) < SUMMARY_EVERY_MS) return { pushed: 0, skipped: "pushed less than 30 minutes ago" };
      if (now - (await stateGet(db, STATE_TRY)) < SUMMARY_RETRY_MS) return { pushed: 0, skipped: "a try failed less than 5 minutes ago" };
    }
    await stateSet(db, STATE_TRY, now); await stateSet(db, STATE_DIRTY, 0);
    const cur = monthKeyOf(now); let sent = 0, bad = 0;
    for (const key of [cur, prevMonthKey(cur)]) {
      for (const s of await monthSummaries(db, c.site, key)) {
        try {
          const res = await fetch(`${c.url}/api/pay/site-summary`, { method: "POST", headers: { "content-type": "application/json", "x-site-key": c.key }, body: JSON.stringify(s), signal: AbortSignal.timeout(4000) });
          if (res.ok) sent++; else bad++;
        } catch { bad++; }
      }
    }
    if (bad === 0) await stateSet(db, STATE_PUSH, now); else await stateSet(db, STATE_DIRTY, 1); // not all arrived: it stays due
    return { pushed: sent, ...(bad ? { failed: bad } : {}) };
  } catch (e) { return { pushed: 0, skipped: "error: " + String(e).slice(0, 80) }; }
}

// ---------------------------------------------------------------- the owner's view of C
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const ist = (ms) => (ms ? new Date(ms + IST).toISOString().replace("T", " ").slice(0, 19) + " IST" : null);
const csvCell = (v) => { let s = v === null || v === undefined ? "" : String(v); if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** True only for the owner's key (header "Authorization: Bearer <OWNER_LEDGER_KEY>"). With no key set on the site nobody is the owner. */
export const isOwner = (request, env) => !!env.OWNER_LEDGER_KEY && String(env.OWNER_LEDGER_KEY).length >= 24 && same(request.headers.get("authorization") ?? "", "Bearer " + env.OWNER_LEDGER_KEY);

/** GET /api/owner/ledger?month=YYYY-MM[&format=csv]. The caller has already proved it is the owner. No payer name, e-mail or phone is returned: the startup's name only. */
export async function ownerLedger(env, url, now) {
  const db = env.DB, month = url.searchParams.get("month") ?? monthKeyOf(now);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({ error: "month must be YYYY-MM" }, 400);
  const { from, to } = monthRange(month), site = SITE_HOST;
  const inMonth = "((created_ms>=? AND created_ms<?) OR (paid_ms>=? AND paid_ms<?))", bindMonth = [from, to, from, to];
  const pays = (await db.prepare(`SELECT id, txn_id, rzp_order_id, rzp_payment_id, amount_minor, currency, status, method, bank, card_network, card_type, rrn, fee_minor, tax_minor, created_ms, paid_ms, plan, startups, org FROM payment WHERE ${inMonth} ORDER BY COALESCE(paid_ms,created_ms), id LIMIT 5000`).bind(...bindMonth).all()).results ?? [];
  const atts = (await db.prepare(`SELECT * FROM payment_attempt WHERE payment_id IN (SELECT id FROM payment WHERE ${inMonth}) ORDER BY COALESCE(event_ms,created_ms), rzp_payment_id`).bind(...bindMonth).all()).results ?? [];
  const byPay = new Map();
  for (const a of atts) { const o = { rzp_payment_id: a.rzp_payment_id, status: a.status, amount_minor: a.amount_minor, currency: a.currency, method: a.method, bank: a.bank, card_network: a.card_network, card_type: a.card_type, card_last4: a.card_last4, vpa_masked: a.vpa_masked, rrn: a.rrn, error_code: a.error_code, error_description: a.error_description, error_reason: a.error_reason, fee_minor: a.fee_minor, tax_minor: a.tax_minor, authorized_utc: iso(a.authorized_ms), captured_utc: iso(a.captured_ms), failed_utc: iso(a.failed_ms), event_utc: iso(a.event_ms), created_utc: iso(a.created_ms) }; (byPay.get(a.payment_id) ?? byPay.set(a.payment_id, []).get(a.payment_id)).push(o); }
  const payments = pays.map((p) => {
    const attempts = byPay.get(p.id) ?? [];
    return { txn_id: p.txn_id, payment_id: p.id, rzp_order_id: p.rzp_order_id, rzp_payment_id: p.rzp_payment_id, amount: p.amount_minor / 100, amount_minor: p.amount_minor, currency: p.currency, status: p.status, method: p.method, bank: p.bank, card_network: p.card_network, card_type: p.card_type, rrn: p.rrn,
      fee_minor: p.fee_minor, tax_minor: p.tax_minor, net_minor: p.fee_minor == null ? null : p.amount_minor - p.fee_minor, paid_utc: iso(p.paid_ms), paid_ist: ist(p.paid_ms), created_utc: iso(p.created_ms), org: p.org ?? null, startups: p.startups, product: SITE_PRODUCT, plan: p.plan,
      captured_attempts: attempts.filter((a) => a.status === "captured").length, attempts };
  });
  const refunds = (await db.prepare("SELECT rzp_refund_id, rzp_payment_id, payment_id, txn_id, currency, amount_minor, status, created_ms, updated_ms FROM payment_refund WHERE created_ms>=? AND created_ms<? ORDER BY created_ms, rzp_refund_id LIMIT 5000").bind(from, to).all()).results ?? [];
  const summaries = await monthSummaries(db, site, month);
  const body = { site, month, summary: summaries.find((s) => s.currency === "INR"), summaries, payments, refunds: refunds.map((r) => ({ ...r, created_utc: iso(r.created_ms), updated_utc: iso(r.updated_ms) })), commission: [] };
  if (url.searchParams.get("format") === "csv") {
    const head = ["txn_id", "payment_id", "rzp_order_id", "rzp_payment_id", "amount", "currency", "status", "method", "bank", "card_network", "card_type", "rrn", "fee_minor", "tax_minor", "net_minor", "paid_utc", "paid_ist", "org", "startups", "product", "plan", "attempts", "captured_attempts", "last_error_code", "last_error_reason"];
    const lines = [head.join(",")];
    for (const p of payments) { const bad = [...p.attempts].reverse().find((a) => a.error_code || a.error_reason); lines.push([p.txn_id, p.payment_id, p.rzp_order_id, p.rzp_payment_id, p.amount, p.currency, p.status, p.method, p.bank, p.card_network, p.card_type, p.rrn, p.fee_minor, p.tax_minor, p.net_minor, p.paid_utc, p.paid_ist, p.org, p.startups, p.product, p.plan, p.attempts.length, p.captured_attempts, bad?.error_code ?? "", bad?.error_reason ?? ""].map(csvCell).join(",")); }
    return new Response(lines.join("\r\n") + "\r\n", { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="ledger-c-${SITE_CODE}-${month}.csv"`, "cache-control": "no-store" } });
  }
  return json(body);
}
