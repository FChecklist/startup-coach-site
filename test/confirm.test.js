// Confirmation e-mails exactly once per payment: /api/verify (the buyer's browser) and /api/webhook (Razorpay) share one sender, guarded by an atomic claim on the
// payment row (migration 0002). Razorpay, the central service and Resend are replaced by a stand-in. Run: bun test
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { onRequestPost as checkout } from "../functions/api/checkout.js";
import { onRequestPost as verify } from "../functions/api/verify.js";
import { onRequestPost as webhook } from "../functions/api/webhook.js";
import { makeD1 } from "./d1-sqlite.js";

const SECRET = "test_secret_value", WHSEC = "whsec_test_value", ORIGIN = "https://coach.example", OWNER_MAIL = "owner@example.com";
const good = { name: "Asha Rao", startup: "FreshCart", email: "Asha@Example.com", phone: "+91 98765 43210", qty: 1, consent: { v: "2026-10-13", boxes: ["A"] } };
const req = (path, body) => new Request(ORIGIN + path, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) });
const sig = (o, p) => createHmac("sha256", SECRET).update(`${o}|${p}`).digest("hex");

let env, raw, orders, payments, resend, mode;
const realFetch = globalThis.fetch;
beforeEach(() => {
  const d = makeD1(); raw = d.raw; orders = {}; payments = {}; resend = []; mode = "ok";
  env = { DB: d.db, RAZORPAY_KEY_ID: "rzp_test_abc123", RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: WHSEC, RESEND_API_KEY: "re_test", OWNER_EMAIL: OWNER_MAIL, ACCESS_SECRET: "shared-secret-xyz", APP_URL: "https://app.example" };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith("/v1/orders") && init.method === "POST") { const b = JSON.parse(init.body); const id = "order_TEST" + Object.keys(orders).length + "abcdef"; orders[id] = { id, ...b }; return Response.json(orders[id]); }
    let m = u.match(/\/v1\/orders\/(order_\w+)$/); if (m) return orders[m[1]] ? Response.json(orders[m[1]]) : new Response("{}", { status: 404 });
    m = u.match(/\/v1\/payments\/(pay_\w+)\/capture$/); if (m) { payments[m[1]].status = "captured"; return Response.json(payments[m[1]]); }
    m = u.match(/\/v1\/payments\/(pay_\w+)$/); if (m) return payments[m[1]] ? Response.json(payments[m[1]]) : new Response("{}", { status: 404 });
    if (u.includes("api.resend.com")) {
      const body = JSON.parse(init.body); const to = body.to[0];
      const fails = mode === "fail" || (mode === "failOwner" && to === OWNER_MAIL) || (mode === "failBuyer" && to !== OWNER_MAIL);
      if (mode === "throw") throw new Error("network down");
      resend.push({ to, ok: !fails, body });
      if (mode === "dup409") return new Response("{}", { status: 409 });
      return fails ? new Response(JSON.stringify({ message: "boom" }), { status: 500 }) : Response.json({ id: "m1" });
    }
    throw new Error("unexpected fetch " + u);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const NOW = Math.floor(Date.now() / 1000);
const book = async () => { const j = await (await checkout({ request: req("/api/checkout", good), env })).json(); return { orderId: j.razorpay.orderId, id: j.txnId.replace("COA-", "") }; };
const pay = (orderId, payId, extra = {}) => { payments[payId] = { id: payId, order_id: orderId, amount: orders[orderId].amount, currency: "INR", status: "captured", method: "upi", fee: 47200, tax: 7200, ...extra }; };
const doVerify = (orderId, payId) => verify({ request: req("/api/verify", { razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: sig(orderId, payId) }), env });
const hook = (ev, eventId) => { const body = JSON.stringify(ev); return webhook({ request: new Request(ORIGIN + "/api/webhook", { method: "POST", headers: { "x-razorpay-signature": createHmac("sha256", WHSEC).update(body).digest("hex"), ...(eventId ? { "x-razorpay-event-id": eventId } : {}) }, body }), env }); };
const captured = (orderId, payId, amount, event = "payment.captured") => ({ event, created_at: NOW, payload: { payment: { entity: { id: payId, order_id: orderId, amount: amount ?? orders[orderId].amount, currency: "INR", status: "captured", method: "upi" } } } });
const row = (id) => raw.query("SELECT * FROM payment WHERE id=?").get(id);
const okMails = () => resend.filter((m) => m.ok);
const buyerMails = () => okMails().filter((m) => m.to === "asha@example.com");
const ownerMails = () => okMails().filter((m) => m.to === OWNER_MAIL);

describe("one set of confirmation mails per payment", () => {
  test("verify then webhook: the buyer and the owner are mailed once; the later webhook sends nothing", async () => {
    const { id, orderId } = await book(); pay(orderId, "pay_ONCE000001");
    const v = await (await doVerify(orderId, "pay_ONCE000001")).json();
    expect(v).toMatchObject({ ok: true, mailed: true, ownerMailed: true });
    expect(buyerMails()).toHaveLength(1); expect(ownerMails()).toHaveLength(1);
    const r = await hook(captured(orderId, "pay_ONCE000001"), "evt_1"); expect(r.status).toBe(200);
    expect(buyerMails()).toHaveLength(1); expect(ownerMails()).toHaveLength(1);
    expect(row(id).mailed_ms).toBeGreaterThan(0); expect(row(id).owner_mailed_ms).toBeGreaterThan(0);
  });
  test("webhook then verify (the buyer closed the tab, then came back): mailed once, by the webhook, with the private link and the buyer's address from the ledger", async () => {
    const { id, orderId } = await book(); pay(orderId, "pay_ONCE000002");
    const r = await hook(captured(orderId, "pay_ONCE000002"), "evt_2"); expect(r.status).toBe(200); expect((await r.json()).mailed).toBe(true);
    expect(buyerMails()).toHaveLength(1); expect(ownerMails()).toHaveLength(1);
    const m = buyerMails()[0].body;
    expect(m.text).toContain("https://app.example/#access="); expect(m.text).toContain("Thank you, Asha Rao"); expect(m.text).toContain("Razorpay payment ID: pay_ONCE000002"); expect(m.text).toContain("Amount paid: Rs 19,999");
    expect(ownerMails()[0].body.subject).toContain("FreshCart");
    expect(row(id).status).toBe("paid");
    const v = await (await doVerify(orderId, "pay_ONCE000002")).json();
    expect(v).toMatchObject({ ok: true, mailed: true, ownerMailed: true }); expect(typeof v.accessLink).toBe("string"); // the page still gets its link
    expect(buyerMails()).toHaveLength(1); expect(ownerMails()).toHaveLength(1);
  });
  test("verify and webhook at the same moment: still one set", async () => {
    for (let i = 0; i < 5; i++) {
      resend = [];
      const { orderId } = await book(); const p = "pay_RACE00000" + i; pay(orderId, p);
      await Promise.all([doVerify(orderId, p), hook(captured(orderId, p), "evt_race" + i), doVerify(orderId, p), hook(captured(orderId, p), "evt_race_b" + i)]);
      expect(buyerMails()).toHaveLength(1); expect(ownerMails()).toHaveLength(1);
    }
  });
  test("the same webhook delivered again, and verify pressed twice: nothing more is sent", async () => {
    const { orderId } = await book(); pay(orderId, "pay_ONCE000003");
    await hook(captured(orderId, "pay_ONCE000003"), "evt_3"); await hook(captured(orderId, "pay_ONCE000003"), "evt_3"); await hook(captured(orderId, "pay_ONCE000003"), "evt_3b");
    await doVerify(orderId, "pay_ONCE000003"); await doVerify(orderId, "pay_ONCE000003");
    expect(buyerMails()).toHaveLength(1); expect(ownerMails()).toHaveLength(1);
  });
  test("the 'order.paid' event is a capture too and mails once", async () => {
    const { orderId } = await book(); pay(orderId, "pay_ONCE000004");
    await hook(captured(orderId, "pay_ONCE000004", undefined, "order.paid"), "evt_4"); await hook(captured(orderId, "pay_ONCE000004"), "evt_4b");
    expect(buyerMails()).toHaveLength(1); expect(ownerMails()).toHaveLength(1);
  });
});

describe("a failed send gives the claim back so it can be tried again", () => {
  test("Resend down when the webhook arrives: nothing claimed, the webhook answers 500 (Razorpay delivers again), the redelivery mails once", async () => {
    const { id, orderId } = await book(); pay(orderId, "pay_FAIL000001"); mode = "fail";
    const r = await hook(captured(orderId, "pay_FAIL000001"), "evt_f1"); expect(r.status).toBe(500);
    expect(row(id)).toMatchObject({ status: "paid", mailed_ms: null, owner_mailed_ms: null }); // the money is recorded, the claims are free
    expect(okMails()).toHaveLength(0);
    expect(raw.query("SELECT COUNT(*) AS n FROM event_seen").get().n).toBe(0); // not marked seen: the redelivery is processed
    mode = "ok";
    const r2 = await hook(captured(orderId, "pay_FAIL000001"), "evt_f1"); expect(r2.status).toBe(200);
    expect(buyerMails()).toHaveLength(1); expect(ownerMails()).toHaveLength(1);
    expect(row(id).mailed_ms).toBeGreaterThan(0);
  });
  test("Resend down when the buyer verifies: the page still says paid, mailed is false, and a later webhook sends the mails", async () => {
    const { id, orderId } = await book(); pay(orderId, "pay_FAIL000002"); mode = "fail";
    const v = await (await doVerify(orderId, "pay_FAIL000002")).json();
    expect(v).toMatchObject({ ok: true, mailed: false, ownerMailed: false }); expect(row(id).mailed_ms).toBeNull();
    mode = "ok"; await hook(captured(orderId, "pay_FAIL000002"), "evt_f2");
    expect(buyerMails()).toHaveLength(1); expect(ownerMails()).toHaveLength(1);
  });
  test("the network throwing counts as a failed send too", async () => {
    const { id, orderId } = await book(); pay(orderId, "pay_FAIL000003"); mode = "throw";
    expect((await hook(captured(orderId, "pay_FAIL000003"), "evt_f3")).status).toBe(500); expect(row(id).mailed_ms).toBeNull();
    mode = "ok"; expect((await doVerify(orderId, "pay_FAIL000003")).status).toBe(200); expect(buyerMails()).toHaveLength(1);
  });
  test("only the owner's mail failed: a retry sends the owner's mail alone, the buyer is not mailed twice, and the webhook is not failed for it", async () => {
    const { id, orderId } = await book(); pay(orderId, "pay_FAIL000004"); mode = "failOwner";
    const r = await hook(captured(orderId, "pay_FAIL000004"), "evt_f4"); expect(r.status).toBe(200);
    expect(row(id).mailed_ms).toBeGreaterThan(0); expect(row(id).owner_mailed_ms).toBeNull(); expect(buyerMails()).toHaveLength(1);
    mode = "ok"; await doVerify(orderId, "pay_FAIL000004");
    expect(buyerMails()).toHaveLength(1); expect(ownerMails()).toHaveLength(1);
  });
  test("only the buyer's mail failed: the owner is told once, the buyer's mail is retried", async () => {
    const { orderId } = await book(); pay(orderId, "pay_FAIL000005"); mode = "failBuyer";
    expect((await hook(captured(orderId, "pay_FAIL000005"), "evt_f5")).status).toBe(500); expect(ownerMails()).toHaveLength(1);
    mode = "ok"; expect((await hook(captured(orderId, "pay_FAIL000005"), "evt_f5")).status).toBe(200);
    expect(buyerMails()).toHaveLength(1); expect(ownerMails()).toHaveLength(1);
  });
  test("Resend answering 409 (this mail's idempotency key was already used) counts as sent", async () => {
    const { id, orderId } = await book(); pay(orderId, "pay_FAIL000006"); mode = "dup409";
    expect((await hook(captured(orderId, "pay_FAIL000006"), "evt_f6")).status).toBe(200); expect(row(id).mailed_ms).toBeGreaterThan(0);
  });
});

describe("nothing is mailed unless the booking really is paid", () => {
  test("authorized and failed messages send nothing", async () => {
    const { id, orderId } = await book();
    await hook({ ...captured(orderId, "pay_NOPE000001"), event: "payment.authorized" }, "e1");
    await hook({ ...captured(orderId, "pay_NOPE000002"), event: "payment.failed" }, "e2");
    expect(resend).toHaveLength(0); expect(row(id).status).toBe("created");
  });
  test("a capture for a different amount, and a capture for an order this site never opened, send nothing", async () => {
    const { id, orderId } = await book();
    await hook(captured(orderId, "pay_NOPE000003", 100), "e3");
    orders.order_OTHER0001 = { id: "order_OTHER0001", amount: 100 };
    await hook(captured("order_OTHER0001", "pay_NOPE000004", 100), "e4");
    expect(resend).toHaveLength(0); expect(row(id).status).toBe("created");
  });
  test("a bad signature sends nothing", async () => {
    const { orderId } = await book(); const body = JSON.stringify(captured(orderId, "pay_NOPE000005"));
    const r = await webhook({ request: new Request(ORIGIN + "/api/webhook", { method: "POST", headers: { "x-razorpay-signature": "0".repeat(64) }, body }), env });
    expect(r.status).toBe(400); expect(resend).toHaveLength(0);
  });
  test("no mail service key on the site: the webhook still records and answers 200 (no endless redelivery), nothing is claimed", async () => {
    delete env.RESEND_API_KEY; const { id, orderId } = await book(); pay(orderId, "pay_NOPE000006");
    expect((await hook(captured(orderId, "pay_NOPE000006"), "e6")).status).toBe(200);
    expect(row(id)).toMatchObject({ status: "paid", mailed_ms: null, owner_mailed_ms: null }); expect(resend).toHaveLength(0);
  });
});

describe("the guard never leaves a buyer without a confirmation", () => {
  test("a database that cannot claim (column missing) still sends, as before the guard existed", async () => {
    const { orderId } = await book(); pay(orderId, "pay_OPEN000001"); raw.run("ALTER TABLE payment DROP COLUMN mailed_ms"); raw.run("ALTER TABLE payment DROP COLUMN owner_mailed_ms");
    const v = await (await doVerify(orderId, "pay_OPEN000001")).json(); expect(v).toMatchObject({ ok: true, mailed: true, ownerMailed: true });
    expect(buyerMails()).toHaveLength(1); expect(ownerMails()).toHaveLength(1);
  });
  test("a booking with no database at all is mailed by verify, as before", async () => {
    const { orderId } = await book(); pay(orderId, "pay_OPEN000002"); orders[orderId].notes = { startup: "FreshCart", name: "Asha Rao", email: "asha@example.com", mobile: "+919876543210", startups: "1" }; delete env.DB;
    const v = await (await doVerify(orderId, "pay_OPEN000002")).json(); expect(v).toMatchObject({ ok: true, mailed: true, ownerMailed: true }); expect(buyerMails()).toHaveLength(1);
  });
});

describe("migration 0002", () => {
  test("payments already paid before the column existed are marked as mailed, so a late webhook never mails them again", () => {
    const db = new Database(":memory:"); const dir = join(import.meta.dir, "..", "migrations");
    db.exec(readFileSync(join(dir, "0001_ledger_c.sql"), "utf8"));
    db.run("INSERT INTO payment(id,txn_id,amount_minor,status,created_ms,paid_ms,updated_ms) VALUES('sc_old','COA-sc_old',1999900,'paid',1,5000,1),('sc_new','COA-sc_new',1999900,'created',1,NULL,1)");
    db.exec(readFileSync(join(dir, "0002_confirmation_mail_claim.sql"), "utf8"));
    expect(db.query("SELECT id, mailed_ms, owner_mailed_ms FROM payment ORDER BY id").all()).toEqual([{ id: "sc_new", mailed_ms: null, owner_mailed_ms: null }, { id: "sc_old", mailed_ms: 5000, owner_mailed_ms: 5000 }]);
  });
});
