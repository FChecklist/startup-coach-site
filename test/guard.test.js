// The booking form's guards and the consent proof (data audit items 11 and 25): three boxes recorded with version, time and text hash; a bot check; a per-visitor,
// per-e-mail and overall rate limit; and the confirmation e-mail that repeats what was accepted. Razorpay and Resend are replaced by a stand-in. Run: bun test
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { onRequestPost as checkout } from "../functions/api/checkout.js";
import { onRequestPost as verify } from "../functions/api/verify.js";
import { CONSENT_TEXTS, CONSENT_VERSION, sha256Hex, consentOk } from "../functions/api/_consent.js";
import { LIMITS, humanTime } from "../functions/api/_limit.js";
import { makeD1 } from "./d1-sqlite.js";

const SECRET = "test_secret_value", ORIGIN = "https://coach.example";
const good = { name: "Asha Rao", startup: "FreshCart", email: "Asha@Example.com", phone: "+91 98765 43210", qty: 1, consent: { v: CONSENT_VERSION, boxes: ["A", "B", "C"] }, t: 5000 };
const req = (body, ip = "203.0.113.7") => new Request(ORIGIN + "/api/checkout", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": ip }, body: JSON.stringify(body) });
let env, raw, orders, payments, sent;
const realFetch = globalThis.fetch;
beforeEach(() => {
  const d = makeD1(); raw = d.raw; orders = {}; payments = {}; sent = [];
  env = { DB: d.db, RAZORPAY_KEY_ID: "rzp_test_abc123", RAZORPAY_KEY_SECRET: SECRET, RESEND_API_KEY: "re_test", OWNER_EMAIL: "owner@example.com" };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith("/v1/orders") && init.method === "POST") { const b = JSON.parse(init.body); const id = "order_G" + Object.keys(orders).length + "abcdef"; orders[id] = { id, ...b }; return Response.json(orders[id]); }
    let m = u.match(/\/v1\/orders\/(order_\w+)$/); if (m) return Response.json(orders[m[1]]);
    m = u.match(/\/v1\/payments\/(pay_\w+)$/); if (m) return Response.json(payments[m[1]]);
    if (u.includes("api.resend.com")) { sent.push(JSON.parse(init.body)); return Response.json({ id: "m" }); }
    throw new Error("unexpected fetch " + u);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });
const rows = (sql, ...a) => raw.query(sql).all(...a);

describe("consent proof", () => {
  test("all three boxes are written to the Coach database with version, time and the SHA-256 of the exact words", async () => {
    const r = await checkout({ request: req(good), env }); expect(r.status).toBe(200);
    const id = rows("SELECT id FROM payment")[0].id;
    const c = rows("SELECT * FROM consent_record WHERE payment_id=? ORDER BY box", id);
    expect(c.map((x) => x.box)).toEqual(["A", "B", "C"]);
    for (const x of c) { expect(x.version).toBe(CONSENT_VERSION); expect(x.text).toBe(CONSENT_TEXTS[x.box]); expect(x.text_sha256).toBe(await sha256Hex(CONSENT_TEXTS[x.box])); expect(x.text_sha256).toMatch(/^[0-9a-f]{64}$/); expect(Math.abs(x.accepted_ms - Date.now())).toBeLessThan(10_000); }
    expect(Object.values(orders)[0].notes.consent).toMatch(/^K7\|2026-10-14\|ABC\|[0-9a-f]{16}\|/);
  });
  test("a booking refused for missing boxes leaves no proof and no payment", async () => {
    for (const boxes of [[], ["A"], ["A", "B"], ["B", "C"]]) expect((await checkout({ request: req({ ...good, consent: { v: CONSENT_VERSION, boxes } }), env })).status).toBe(400);
    expect(rows("SELECT * FROM consent_record").length).toBe(0); expect(rows("SELECT * FROM payment").length).toBe(0);
    expect(consentOk({ v: CONSENT_VERSION, boxes: ["A", "B", "C"] })).toBe(true);
  });
  test("the confirmation e-mail repeats what the buyer accepted and how to withdraw", async () => {
    const c = await (await checkout({ request: req(good), env })).json(); const orderId = c.razorpay.orderId, payId = "pay_CONSENT1";
    payments[payId] = { id: payId, order_id: orderId, amount: orders[orderId].amount, currency: "INR", status: "captured", method: "upi" };
    const res = await verify({ request: new Request(ORIGIN + "/api/verify", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: createHmac("sha256", SECRET).update(`${orderId}|${payId}`).digest("hex") }) }), env });
    expect(res.status).toBe(200);
    const buyer = sent.find((m) => m.to[0] === "asha@example.com");
    expect(buyer.text).toContain("WHAT YOU ACCEPTED (version 2026-10-14");
    for (const t of Object.values(CONSENT_TEXTS)) expect(buyer.text).toContain(t);
    expect(buyer.text).toContain("Withdraw consent"); expect(buyer.html).toContain("What you accepted");
  });
});

describe("bot check", () => {
  test("a call that is too fast, has no timer, or an absurd one is refused before anything is stored", async () => {
    for (const t of [undefined, null, "5000", 0, 800, LIMITS.min_fill_ms - 1, LIMITS.max_fill_ms + 1, NaN]) { const r = await checkout({ request: req({ ...good, t }), env }); expect(r.status).toBe(400); expect((await r.json()).code).toBe("too-fast"); }
    expect(rows("SELECT * FROM payment").length).toBe(0); expect(Object.keys(orders).length).toBe(0);
    expect(humanTime(LIMITS.min_fill_ms)).toBe(true);
  });
  test("the honeypot still stops a filled hidden field", async () => { expect((await checkout({ request: req({ ...good, website: "x" }), env })).status).toBe(400); });
});

describe("rate limit", () => {
  const uniq = (i) => ({ ...good, email: `buyer${i}@example.com` });
  test("one visitor may start 6 bookings an hour; the 7th is told to wait, and no order is opened for it", async () => {
    for (let i = 0; i < LIMITS.per_visitor_hour; i++) expect((await checkout({ request: req(uniq(i)), env })).status).toBe(200);
    const r = await checkout({ request: req(uniq(99)), env }); expect(r.status).toBe(429); expect((await r.json()).code).toBe("slow-down");
    expect(Object.keys(orders).length).toBe(LIMITS.per_visitor_hour);
    expect((await checkout({ request: req(uniq(100), "198.51.100.9"), env })).status).toBe(200); // another visitor is not affected
  });
  test("one e-mail address may start 4 bookings an hour, from any address", async () => {
    for (let i = 0; i < LIMITS.per_email_hour; i++) expect((await checkout({ request: req(good, "198.51.100." + i), env })).status).toBe(200);
    expect((await checkout({ request: req(good, "198.51.100.200"), env })).status).toBe(429);
  });
  test("the counters hold a keyed hash, never the address or the e-mail", async () => {
    await checkout({ request: req(good), env });
    const text = JSON.stringify(rows("SELECT * FROM checkout_hit"));
    expect(text).not.toMatch(/203\.0\.113|asha|example/i); expect(rows("SELECT who FROM checkout_hit").map((r) => r.who.split(":")[0]).sort()).toEqual(["all", "e", "v"]);
  });
  test("invalid input is not counted, and a booking without a database is not blocked", async () => {
    for (let i = 0; i < 10; i++) await checkout({ request: req({ ...good, phone: "123" }), env });
    expect(rows("SELECT * FROM checkout_hit").length).toBe(0);
    expect((await checkout({ request: req(good), env: { ...env, DB: undefined } })).status).toBe(200);
  });
});
