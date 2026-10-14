// Ledger C of the Startup Coach website (its own payment ledger, tied to Razorpay A and the central ledger B): ids, every attempt, refunds, webhook,
// owner view and the monthly figures sent to B. Razorpay, the central service and the mail service are replaced by a stand-in. Run: bun test
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { onRequestPost as checkout } from "../functions/api/checkout.js";
import { onRequestPost as verify } from "../functions/api/verify.js";
import { onRequestPost as webhook } from "../functions/api/webhook.js";
import { onRequestGet as ownerGet, onRequest as ownerAny } from "../functions/api/owner/ledger.js";
import { monthKeyOf, monthRange, prevMonthKey, pushSummaries, monthSummaries, txnIdOf, SUMMARY_EVERY_MS, SUMMARY_RETRY_MS } from "../functions/api/_ledgerc.js";
import { makeD1 } from "./d1-sqlite.js";

const SECRET = "test_secret_value", WHSEC = "whsec_test_value", OWNER = "owner-key-for-tests-0123456789abcdef";
const ORIGIN = "https://coach.example";
const good = { name: "Asha Rao", startup: "FreshCart", email: "Asha@Example.com", phone: "+91 98765 43210", qty: 1, consent: { v: "2026-10-14", boxes: ["A", "B", "C"] }, t: 5000 };
const req = (path, body, headers = {}) => new Request(ORIGIN + path, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const sig = (o, p) => createHmac("sha256", SECRET).update(`${o}|${p}`).digest("hex");
const whsig = (raw, secret = WHSEC) => createHmac("sha256", secret).update(raw).digest("hex");

let env, raw, orders, payments, sent, calls, centralOrders, summaries, summaryStatus, centralUp;
const realFetch = globalThis.fetch;
beforeEach(() => {
  const d = makeD1(); raw = d.raw;
  orders = {}; payments = {}; sent = []; calls = []; centralOrders = []; summaries = []; summaryStatus = 200; centralUp = true;
  env = { DB: d.db, RAZORPAY_KEY_ID: "rzp_test_abc123", RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: WHSEC, OWNER_LEDGER_KEY: OWNER, RESEND_API_KEY: "re_test", OWNER_EMAIL: "owner@example.com", ACCESS_SECRET: "shared-secret-xyz", APP_URL: "https://app.example" };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); calls.push({ url: u, init });
    if (u === "https://central.test/api/pay/order") {
      if (!centralUp) throw new Error("down");
      const b = JSON.parse(init.body); centralOrders.push(b);
      const id = "order_CEN" + centralOrders.length + "abcdef"; orders[id] = { id, amount: b.amount_minor, currency: b.currency, receipt: b.payment_ref, notes: {} }; // the real service keeps only 15 notes: the stand-in keeps none, so the buyer's details must come from ledger C
      return Response.json({ ok: true, orderId: id, txn_id: txnIdOf(b.payment_ref) });
    }
    if (u === "https://central.test/api/pay/verify") return Response.json({ ok: true, fee_minor: 47200, tax_minor: 7200, method: "upi" });
    if (u === "https://central.test/api/pay/site-summary") { summaries.push({ key: init.headers["x-site-key"], ...JSON.parse(init.body) }); return Response.json({ ok: summaryStatus === 200 }, { status: summaryStatus }); }
    if (u.endsWith("/v1/orders") && init.method === "POST") { const b = JSON.parse(init.body); const id = "order_TEST" + Object.keys(orders).length + "abcdef"; orders[id] = { id, ...b }; return Response.json(orders[id]); }
    let m = u.match(/\/v1\/orders\/(order_\w+)$/); if (m) return orders[m[1]] ? Response.json(orders[m[1]]) : new Response("{}", { status: 404 });
    m = u.match(/\/v1\/payments\/(pay_\w+)\/capture$/); if (m) { payments[m[1]].status = "captured"; return Response.json(payments[m[1]]); }
    m = u.match(/\/v1\/payments\/(pay_\w+)$/); if (m) return payments[m[1]] ? Response.json(payments[m[1]]) : new Response("{}", { status: 404 });
    if (u.includes("api.resend.com")) { sent.push(JSON.parse(init.body)); return Response.json({ id: "m1" }); }
    throw new Error("unexpected fetch " + u);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });
const central = () => { env.PAY_SERVICE_KEY = "psk_coach"; env.PAY_SERVICE_URL = "https://central.test"; };

const book = async (extra = {}) => { const r = await checkout({ request: req("/api/checkout", { ...good, ...extra }), env }); const j = await r.json(); return { r, j, orderId: j.razorpay?.orderId, txnId: j.txnId, id: j.txnId?.replace("COA-", "") }; };
const pay = (orderId, payId, extra = {}) => { payments[payId] = { id: payId, order_id: orderId, amount: orders[orderId].amount, currency: "INR", status: "captured", method: "upi", fee: 47200, tax: 7200, vpa: "asha.rao@okbank", acquirer_data: { rrn: "412345678901" }, ...extra }; return payments[payId]; };
const doVerify = (orderId, payId) => verify({ request: req("/api/verify", { razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: sig(orderId, payId) }), env });
const NOW = Math.floor(Date.now() / 1000);
const hook = (ev, eventId, secret = WHSEC) => { const body = JSON.stringify(ev); return webhook({ request: new Request(ORIGIN + "/api/webhook", { method: "POST", headers: { "x-razorpay-signature": whsig(body, secret), ...(eventId ? { "x-razorpay-event-id": eventId } : {}) }, body }), env }); };
const ent = (orderId, id, extra = {}, amount) => ({ id, order_id: orderId, amount: amount ?? orders[orderId].amount, currency: "INR", ...extra });
const evPay = (event, orderId, id, extra = {}, at = NOW) => ({ event, created_at: at, payload: { payment: { entity: ent(orderId, id, extra) } } });
const attempts = () => raw.query("SELECT * FROM payment_attempt ORDER BY rzp_payment_id").all();
const row = (id) => raw.query("SELECT * FROM payment WHERE id=?").get(id);
const owner = (qs = "") => ownerGet({ request: new Request(ORIGIN + "/api/owner/ledger" + qs, { headers: { authorization: "Bearer " + OWNER } }), env });

describe("the id that ties A, B and C together", () => {
  test("txn_id = COA- + the website's own payment id; it is stored in C and put in the Razorpay order notes and receipt", async () => {
    const { r, j, id, txnId, orderId } = await book();
    expect(r.status).toBe(200);
    expect(id).toMatch(/^sc_[0-9a-f]{16}$/); expect(txnId).toBe(`COA-${id}`);
    const p = row(id);
    expect(p).toMatchObject({ txn_id: txnId, rzp_order_id: orderId, amount_minor: 1999900, status: "created", plan: "startups_1", startups: 1, org: "FreshCart" });
    expect(orders[orderId].notes.txn_id).toBe(txnId); expect(orders[orderId].notes.payment_ref).toBe(id); expect(orders[orderId].receipt).toBe(id);
    expect(Object.keys(orders[orderId].notes).length).toBeLessThanOrEqual(15); // Razorpay refuses more
  });
  test("through the central service the same payment id is sent as payment_ref (B builds the same txn_id) and the buyer's details come first", async () => {
    central();
    const { id, txnId } = await book({ qty: 2 });
    expect(centralOrders[0].payment_ref).toBe(id); expect(txnIdOf(centralOrders[0].payment_ref)).toBe(txnId);
    const keys = Object.keys(centralOrders[0].extra_notes);
    expect(keys.slice(0, 7)).toEqual(["consent", "startup", "startups", "name", "email", "mobile", "brand"]); // the central service keeps only the first 9
    expect(row(id)).toMatchObject({ plan: "startups_2", startups: 2, amount_minor: 3999800 });
  });
  test("a payment whose order could not be opened is kept as void, never as an open payment", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: {} }), { status: 400 });
    const r = await checkout({ request: req("/api/checkout", good), env }); expect(r.status).toBe(502);
    expect(raw.query("SELECT status FROM payment").all()).toEqual([{ status: "void" }]);
  });
  test("the booking works with no database at all", async () => {
    delete env.DB; const { r, j } = await book(); expect(r.status).toBe(200); expect(j.txnId).toMatch(/^COA-sc_/);
  });
});

describe("verify writes ledger C", () => {
  test("a captured payment: attempt, paid booking, fee, tax, method and bank reference; the UPI id is stored masked", async () => {
    const { id, orderId } = await book(); pay(orderId, "pay_ABC123456");
    const r = await doVerify(orderId, "pay_ABC123456"); expect(r.status).toBe(200);
    expect(row(id)).toMatchObject({ status: "paid", rzp_payment_id: "pay_ABC123456", fee_minor: 47200, tax_minor: 7200, method: "upi", rrn: "412345678901" });
    expect(row(id).paid_ms).toBeGreaterThan(0);
    const a = attempts(); expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ rzp_payment_id: "pay_ABC123456", payment_id: id, txn_id: `COA-${id}`, status: "captured", amount_minor: 1999900, vpa_masked: "as***@okbank", rrn: "412345678901", fee_minor: 47200 });
    expect(JSON.stringify(a)).not.toContain("asha.rao@okbank");
  });
  test("verifying the same payment twice leaves one attempt and one sale", async () => {
    const { id, orderId } = await book(); pay(orderId, "pay_ABC123456");
    await doVerify(orderId, "pay_ABC123456"); const first = row(id).paid_ms; await doVerify(orderId, "pay_ABC123456");
    expect(attempts()).toHaveLength(1); expect(row(id).paid_ms).toBe(first);
    expect((await monthSummaries(env.DB, "s", monthKeyOf(Date.now())))[0].paid_count).toBe(1);
  });
  test("a failed try is kept with Razorpay's reason and does not mark the booking paid; the next try that pays does, under the same txn_id", async () => {
    const { id, orderId } = await book();
    pay(orderId, "pay_FAIL00001", { status: "failed", error_code: "BAD_REQUEST_ERROR", error_description: "Payment failed because of insufficient balance", error_reason: "insufficient_funds" });
    expect((await doVerify(orderId, "pay_FAIL00001")).status).toBe(402);
    expect(row(id).status).toBe("created");
    expect(attempts()[0]).toMatchObject({ status: "failed", error_code: "BAD_REQUEST_ERROR", error_reason: "insufficient_funds" });
    pay(orderId, "pay_PAID00002"); expect((await doVerify(orderId, "pay_PAID00002")).status).toBe(200);
    expect(row(id)).toMatchObject({ status: "paid", rzp_payment_id: "pay_PAID00002" });
    expect(attempts().map((a) => [a.rzp_payment_id, a.status, a.txn_id])).toEqual([["pay_FAIL00001", "failed", `COA-${id}`], ["pay_PAID00002", "captured", `COA-${id}`]]);
    const s = (await monthSummaries(env.DB, "s", monthKeyOf(Date.now())))[0]; expect(s.paid_count).toBe(1); expect(s.failed_count).toBe(1);
  });
  test("an authorized payment is captured first, then recorded as captured", async () => {
    const { id, orderId } = await book(); pay(orderId, "pay_AUTH00001", { status: "authorized" });
    expect((await doVerify(orderId, "pay_AUTH00001")).status).toBe(200);
    expect(calls.some((c) => c.url.endsWith("/capture"))).toBe(true); expect(row(id).status).toBe("paid"); expect(attempts()[0].status).toBe("captured");
  });
  test("the buyer's e-mail and name come from ledger C when the Razorpay order lost them (central orders keep only some notes)", async () => {
    central(); const { orderId } = await book(); pay(orderId, "pay_CEN0000001");
    const j = await (await doVerify(orderId, "pay_CEN0000001")).json();
    expect(j).toMatchObject({ ok: true, startup: "FreshCart", name: "Asha Rao", email: "asha@example.com", startups: 1, mailed: true });
    expect(sent.map((m) => m.to[0]).sort()).toEqual(["asha@example.com", "owner@example.com"]);
  });
  test("the central ledger's fee is used when Razorpay's own answer lacks it", async () => {
    central(); const { id, orderId } = await book(); pay(orderId, "pay_NOFEE00001", { fee: undefined, tax: undefined });
    await doVerify(orderId, "pay_NOFEE00001"); expect(row(id)).toMatchObject({ fee_minor: 47200, tax_minor: 7200 });
  });
  test("a ledger that fails never stops the buyer's confirmation", async () => {
    const { orderId } = await book(); pay(orderId, "pay_ABC123456"); raw.run("DROP TABLE payment_attempt");
    const r = await doVerify(orderId, "pay_ABC123456"); expect(r.status).toBe(200); expect((await r.json()).ok).toBe(true);
  });
});

describe("the Razorpay webhook (A -> C)", () => {
  test("a message with the wrong signature, or no secret on the site, is refused; the call is logged", async () => {
    const { orderId } = await book();
    expect((await hook(evPay("payment.captured", orderId, "pay_X0000001"), "evt_1", "other-secret")).status).toBe(400);
    expect(raw.query("SELECT signature_ok, outcome FROM webhook_log").all()).toEqual([{ signature_ok: 0, outcome: "bad signature" }]);
    expect(attempts()).toHaveLength(0);
    delete env.RAZORPAY_WEBHOOK_SECRET; expect((await hook(evPay("payment.captured", orderId, "pay_X0000001"), "evt_2")).status).toBe(503);
  });
  test("a captured message marks the booking paid and keeps the attempt (the buyer closed the tab before /api/verify)", async () => {
    const { id, orderId } = await book();
    const r = await hook(evPay("payment.captured", orderId, "pay_WH000001", { status: "captured", method: "card", card: { network: "Visa", type: "credit", last4: "1111" }, fee: 47200, tax: 7200 }), "evt_c1");
    expect(r.status).toBe(200);
    expect(row(id)).toMatchObject({ status: "paid", rzp_payment_id: "pay_WH000001", method: "card", card_network: "Visa", fee_minor: 47200 });
    expect(attempts()[0]).toMatchObject({ status: "captured", card_last4: "1111", captured_ms: NOW * 1000 });
    expect(raw.query("SELECT signature_ok, outcome FROM webhook_log").all()).toEqual([{ signature_ok: 1, outcome: "attempt recorded: captured" }]);
  });
  test("the same delivery twice (same event id) is processed once", async () => {
    const { id, orderId } = await book(); const ev = evPay("payment.captured", orderId, "pay_WH000001", { status: "captured" });
    await hook(ev, "evt_dup"); raw.run("UPDATE payment SET status='created', paid_ms=NULL, rzp_payment_id=NULL WHERE id=?", [id]); // if it were processed again this would be paid again
    const r2 = await hook(ev, "evt_dup"); expect((await r2.json()).duplicate).toBe("evt_dup"); expect(row(id).status).toBe("created");
    expect(raw.query("SELECT COUNT(*) AS n FROM event_seen").get().n).toBe(1);
  });
  test("with no event-id header the same message is still recognised from its own content", async () => {
    const { orderId } = await book(); const ev = evPay("payment.failed", orderId, "pay_WH000002", { status: "failed", error_code: "E1" });
    expect((await (await hook(ev)).json()).ok).toBe(true); expect((await (await hook(ev)).json()).duplicate).toMatch(/^d:payment\.failed:pay_WH000002:/);
  });
  test("an attempt's status never moves backwards: a late 'failed' or 'authorized' never undoes a capture", async () => {
    const { orderId } = await book();
    await hook(evPay("payment.captured", orderId, "pay_WH000003", { status: "captured" }), "e1");
    await hook(evPay("payment.failed", orderId, "pay_WH000003", { status: "failed", error_code: "LATE", error_reason: "late_failure" }, NOW + 5), "e2");
    await hook(evPay("payment.authorized", orderId, "pay_WH000003", { status: "authorized" }, NOW - 5), "e3");
    expect(attempts()).toHaveLength(1); expect(attempts()[0].status).toBe("captured");
  });
  test("failed then captured for the same Razorpay payment (late UPI): ends captured and counts as a sale, not a failure", async () => {
    const { id, orderId } = await book();
    await hook(evPay("payment.failed", orderId, "pay_WH000004", { status: "failed", error_code: "TIMEOUT" }, NOW - 30), "e1");
    expect(row(id).status).toBe("created");
    await hook(evPay("payment.captured", orderId, "pay_WH000004", { status: "captured" }), "e2");
    expect(row(id).status).toBe("paid"); expect(attempts()[0]).toMatchObject({ status: "captured", error_code: "TIMEOUT" });
    const s = (await monthSummaries(env.DB, "s", monthKeyOf(Date.now())))[0]; expect(s.paid_count).toBe(1); expect(s.failed_count).toBe(0);
  });
  test("a capture for a different amount is kept as an attempt but the booking is not marked paid", async () => {
    const { id, orderId } = await book();
    await hook({ event: "payment.captured", created_at: NOW, payload: { payment: { entity: ent(orderId, "pay_WH000005", { status: "captured" }, 100) } } }, "e1");
    expect(row(id).status).toBe("created"); expect(attempts()).toHaveLength(1);
  });
  test("a message about an order this website never opened is acknowledged and ignored", async () => {
    orders.order_OTHER0001 = { id: "order_OTHER0001", amount: 100 };
    const r = await hook(evPay("payment.captured", "order_OTHER0001", "pay_WH000006", { status: "captured" }), "e1"); expect((await r.json()).ignored).toBe("unknown order");
    expect(attempts()).toHaveLength(0);
  });
  test("refunds: one row each, processed beats pending, and a later 'pending' does not undo it", async () => {
    const { id, orderId } = await book(); pay(orderId, "pay_REF000001"); await doVerify(orderId, "pay_REF000001");
    const rf = (event, status, at) => ({ event, created_at: at, payload: { refund: { entity: { id: "rfnd_000001", payment_id: "pay_REF000001", amount: 1999900, currency: "INR", status, created_at: NOW } } } });
    await hook(rf("refund.created", "pending", NOW), "r1"); await hook(rf("refund.processed", "processed", NOW + 60), "r2"); await hook(rf("refund.created", "pending", NOW + 120), "r3");
    const rows = raw.query("SELECT * FROM payment_refund").all(); expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rzp_refund_id: "rfnd_000001", payment_id: id, txn_id: `COA-${id}`, amount_minor: 1999900, status: "processed" });
    expect((await monthSummaries(env.DB, "s", monthKeyOf(Date.now())))[0].refunded_minor).toBe(1999900);
  });
});

describe("the owner's view", () => {
  test("anybody but the owner gets the same 404 as an address that does not exist", async () => {
    for (const h of [{}, { authorization: "Bearer wrong" }, { authorization: "Bearer " + OWNER + "x" }, { authorization: OWNER }]) {
      const r = await ownerGet({ request: new Request(ORIGIN + "/api/owner/ledger", { headers: h }), env }); expect(r.status).toBe(404); expect(await r.json()).toEqual({ error: "Not found." });
    }
    expect((await ownerAny({ request: new Request(ORIGIN + "/api/owner/ledger", { method: "POST", headers: { authorization: "Bearer " + OWNER } }), env })).status).toBe(404);
    delete env.OWNER_LEDGER_KEY; expect((await ownerGet({ request: new Request(ORIGIN + "/api/owner/ledger", { headers: { authorization: "Bearer undefined" } }), env })).status).toBe(404);
  });
  test("the owner sees the month: payments with attempts, refunds and the summary; no payer name, e-mail or phone", async () => {
    const { id, orderId } = await book(); pay(orderId, "pay_FAIL00001", { status: "failed", error_code: "E1", error_reason: "insufficient_funds" }); await doVerify(orderId, "pay_FAIL00001");
    pay(orderId, "pay_PAID00002"); await doVerify(orderId, "pay_PAID00002");
    const r = await owner(); expect(r.status).toBe(200); const text = await r.text(); const j = JSON.parse(text);
    expect(j.site).toBe("rajat-agarwal-startup-coach.pages.dev"); expect(j.month).toBe(monthKeyOf(Date.now()));
    expect(j.summary).toMatchObject({ paid_count: 1, failed_count: 1, revenue_minor: 1999900, fee_minor: 47200, tax_minor: 7200 });
    expect(j.payments).toHaveLength(1);
    expect(j.payments[0]).toMatchObject({ txn_id: `COA-${id}`, status: "paid", org: "FreshCart", captured_attempts: 1, net_minor: 1999900 - 47200, plan: "startups_1" });
    expect(j.payments[0].attempts.map((a) => a.status)).toEqual(["failed", "captured"]);
    for (const secret of ["asha@example.com", "Asha Rao", "9876543210", "asha.rao@okbank"]) expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
  });
  test("a month with nothing in it is empty; a bad month is refused; csv is a download without personal data", async () => {
    const { orderId } = await book(); pay(orderId, "pay_PAID00002"); await doVerify(orderId, "pay_PAID00002");
    expect((await (await owner("?month=2020-01")).json()).payments).toEqual([]);
    expect((await owner("?month=2026-13")).status).toBe(400);
    const c = await owner(`?month=${monthKeyOf(Date.now())}&format=csv`); const text = await c.text();
    expect(c.headers.get("content-type")).toContain("text/csv"); expect(text.split("\r\n")[0]).toContain("txn_id,payment_id,rzp_order_id,rzp_payment_id"); expect(text).toContain("pay_PAID00002"); expect(text.toLowerCase()).not.toContain("asha");
  });
  test("a startup name that looks like a spreadsheet formula is neutralised in the csv", async () => {
    const { orderId } = await book({ startup: "=HYPERLINK(1)" }); pay(orderId, "pay_PAID00002"); await doVerify(orderId, "pay_PAID00002");
    expect(await (await owner(`?month=${monthKeyOf(Date.now())}&format=csv`)).text()).toContain("'=HYPERLINK(1)");
  });
});

describe("the month goes to the central ledger", () => {
  test("after a payment the current and the previous month are sent (INR), with the site key", async () => {
    central(); const { orderId } = await book(); pay(orderId, "pay_PAID00001"); await doVerify(orderId, "pay_PAID00001");
    const cur = monthKeyOf(Date.now()); expect(summaries.map((s) => s.period_key)).toEqual([cur, prevMonthKey(cur)]);
    expect(summaries[0]).toMatchObject({ key: "psk_coach", site: "rajat-agarwal-startup-coach.pages.dev", currency: "INR", paid_count: 1, failed_count: 0, revenue_minor: 1999900, fee_minor: 47200, tax_minor: 7200, refunded_minor: 0, commission_accrued_minor: 0, commission_paid_minor: 0 });
    expect(summaries[1]).toMatchObject({ paid_count: 0, revenue_minor: 0 });
  });
  test("at most every 30 minutes: a later change waits, and is sent once the time is up", async () => {
    central(); const t0 = Date.now();
    const a = await book(); pay(a.orderId, "pay_PAID00001"); await doVerify(a.orderId, "pay_PAID00001"); expect(summaries).toHaveLength(2);
    const b = await book({ email: "b@example.com" }); pay(b.orderId, "pay_PAID00002"); await doVerify(b.orderId, "pay_PAID00002"); expect(summaries).toHaveLength(2); // inside the 30 minutes: kept, not sent
    expect(await pushSummaries(env, t0 + SUMMARY_EVERY_MS - 60_000)).toMatchObject({ skipped: "pushed less than 30 minutes ago" });
    const out = await pushSummaries(env, Date.now() + SUMMARY_EVERY_MS + 1000); expect(out.pushed).toBe(2);
    expect(summaries.at(-2)).toMatchObject({ paid_count: 2, revenue_minor: 3999800 });
    expect(await pushSummaries(env, Date.now() + SUMMARY_EVERY_MS * 2)).toMatchObject({ skipped: "nothing changed" });
  });
  test("a send that B refused is repeated after 5 minutes, not before, and the change is not lost", async () => {
    central(); summaryStatus = 500; const { orderId } = await book(); pay(orderId, "pay_PAID00001"); await doVerify(orderId, "pay_PAID00001");
    const n = summaries.length; expect(n).toBeGreaterThan(0);
    expect(await pushSummaries(env, Date.now() + SUMMARY_RETRY_MS - 60_000)).toMatchObject({ skipped: "a try failed less than 5 minutes ago" });
    summaryStatus = 200; const out = await pushSummaries(env, Date.now() + SUMMARY_RETRY_MS + 1000); expect(out.pushed).toBe(2);
  });
  test("with no central key nothing is sent and nothing breaks", async () => {
    const { orderId } = await book(); pay(orderId, "pay_PAID00001"); expect((await doVerify(orderId, "pay_PAID00001")).status).toBe(200); expect(summaries).toHaveLength(0);
  });
  test("months are Indian months: 00:30 IST on the 1st belongs to the new month", () => {
    const t = Date.UTC(2026, 9, 31, 19, 0, 0); // 2026-11-01 00:30 IST
    expect(monthKeyOf(t)).toBe("2026-11"); expect(monthKeyOf(t - 3_600_000)).toBe("2026-10"); expect(prevMonthKey("2026-01")).toBe("2025-12");
    expect(monthRange("2026-11").from).toBe(Date.UTC(2026, 10, 1) - 19_800_000);
  });
});
