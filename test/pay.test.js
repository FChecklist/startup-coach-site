// Tests for the two payment functions, with Razorpay and Resend replaced by a stand-in. Run: bun test
import { describe, expect, test, beforeEach } from "bun:test";
import { createHmac } from "node:crypto";
import { onRequestPost as checkout } from "../functions/api/checkout.js";
import { onRequestPost as verify } from "../functions/api/verify.js";

const SECRET = "test_secret_value";
const env = { RAZORPAY_KEY_ID: "rzp_test_abc123", RAZORPAY_KEY_SECRET: SECRET, RESEND_API_KEY: "re_test", OWNER_EMAIL: "owner@example.com", ACCESS_SECRET: "shared-secret-xyz", APP_URL: "https://app.example" };
const ORIGIN = "https://coach.example";
const req = (path, body, headers = {}) => new Request(ORIGIN + path, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const good = { name: "Asha Rao", startup: "FreshCart", email: "Asha@Example.com", phone: "+91 98765 43210", qty: 1, consent: { v: "2026-10-14", boxes: ["A", "B", "C"] }, t: 5000 };
const sig = (o, p) => createHmac("sha256", SECRET).update(`${o}|${p}`).digest("hex");

let orders, payments, sent, calls;
const realFetch = globalThis.fetch;
beforeEach(() => {
  orders = {}; payments = {}; sent = []; calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); calls.push({ url: u, init });
    if (u.endsWith("/v1/orders") && init.method === "POST") { const b = JSON.parse(init.body); const id = "order_TEST" + Object.keys(orders).length + "abcdef"; orders[id] = { id, ...b }; return Response.json(orders[id]); }
    let m = u.match(/\/v1\/orders\/(order_\w+)$/); if (m) return orders[m[1]] ? Response.json(orders[m[1]]) : new Response("{}", { status: 404 });
    m = u.match(/\/v1\/payments\/(pay_\w+)\/capture$/); if (m) { payments[m[1]].status = "captured"; return Response.json(payments[m[1]]); }
    m = u.match(/\/v1\/payments\/(pay_\w+)$/); if (m) return payments[m[1]] ? Response.json(payments[m[1]]) : new Response("{}", { status: 404 });
    if (u.includes("api.resend.com")) { sent.push(JSON.parse(init.body)); return Response.json({ id: "m1" }); }
    throw new Error("unexpected fetch " + u);
  };
});
const restore = () => { globalThis.fetch = realFetch; };

describe("checkout", () => {
  test("creates a Razorpay order for the server-side price", async () => {
    const r = await checkout({ request: req("/api/checkout", good), env }); restore();
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.total).toBe(19999);
    const o = Object.values(orders)[0];
    expect(o.amount).toBe(1999900); expect(o.currency).toBe("INR");
    expect(o.notes.startup).toBe("FreshCart"); expect(o.notes.mobile).toBe("+919876543210"); expect(o.notes.email).toBe("asha@example.com");
    expect(j.razorpay.orderId).toBe(o.id); expect(j.razorpay.amount).toBe(1999900);
    expect(j.hop).toBe("https://itservices-rajat-agarwal.pages.dev/payframe/");
    expect(j.razorpay.description).toContain("IT Services by Rajat Agarwal");
    expect(JSON.stringify(j)).not.toContain(SECRET);
  });
  test("price multiplies by startups and cannot be set by the browser", async () => {
    const r = await checkout({ request: req("/api/checkout", { ...good, qty: 3, amount: 1, total: 1 }), env }); restore();
    expect((await r.json()).total).toBe(59997); expect(Object.values(orders)[0].amount).toBe(5999700);
  });
  test.each([[{ name: "A" }], [{ startup: "" }], [{ email: "nope" }], [{ phone: "12345" }], [{ phone: "5876543210" }], [{ qty: 0 }], [{ qty: 6 }], [{ qty: 1.5 }], [{ website: "bot" }]])("rejects bad input %p", async (bad) => {
    const r = await checkout({ request: req("/api/checkout", { ...good, ...bad }), env }); restore();
    expect(r.status).toBe(400); expect(Object.keys(orders).length).toBe(0);
  });
  test("refuses another website's origin", async () => {
    const r = await checkout({ request: req("/api/checkout", good, { origin: "https://evil.example" }), env }); restore();
    expect(r.status).toBe(403);
  });
  test("says payment is being switched on when keys are missing", async () => {
    const r = await checkout({ request: req("/api/checkout", good), env: {} }); restore();
    expect(r.status).toBe(503); expect((await r.json()).off).toBe(true);
  });
  test("accepts +91 and leading-zero mobile forms", async () => {
    for (const p of ["09876543210", "919876543210", "9876543210"]) { const r = await checkout({ request: req("/api/checkout", { ...good, phone: p }), env }); expect(r.status).toBe(200); }
    restore(); expect(Object.values(orders).every((o) => o.notes.mobile === "+919876543210")).toBe(true);
  });
});

async function makeOrder() { const r = await checkout({ request: req("/api/checkout", good), env }); return (await r.json()).razorpay.orderId; }
describe("verify", () => {
  test("a correctly signed, captured payment confirms and sends both e-mails once", async () => {
    const oid = await makeOrder(); payments.pay_ABC123456 = { id: "pay_ABC123456", order_id: oid, amount: 1999900, currency: "INR", status: "captured" };
    const r = await verify({ request: req("/api/verify", { razorpay_order_id: oid, razorpay_payment_id: "pay_ABC123456", razorpay_signature: sig(oid, "pay_ABC123456") }), env }); restore();
    const j = await r.json(); expect(r.status).toBe(200); expect(j.ok).toBe(true); expect(j.total).toBe(19999); expect(j.startup).toBe("FreshCart"); expect(j.mailed).toBe(true);
    expect(sent.map((m) => m.to[0]).sort()).toEqual(["asha@example.com", "owner@example.com"]);
    expect(sent.find((m) => m.to[0] === "owner@example.com").text).toContain("+919876543210");
  });
  test("a forged signature is refused and sends nothing", async () => {
    const oid = await makeOrder(); payments.pay_ABC123456 = { id: "pay_ABC123456", order_id: oid, amount: 1999900, currency: "INR", status: "captured" };
    const r = await verify({ request: req("/api/verify", { razorpay_order_id: oid, razorpay_payment_id: "pay_ABC123456", razorpay_signature: "0".repeat(64) }), env }); restore();
    expect(r.status).toBe(400); expect(sent.length).toBe(0);
  });
  test("a payment for a different amount than the order is refused", async () => {
    const oid = await makeOrder(); payments.pay_ABC123456 = { id: "pay_ABC123456", order_id: oid, amount: 100, currency: "INR", status: "captured" };
    const r = await verify({ request: req("/api/verify", { razorpay_order_id: oid, razorpay_payment_id: "pay_ABC123456", razorpay_signature: sig(oid, "pay_ABC123456") }), env }); restore();
    expect(r.status).toBe(400); expect(sent.length).toBe(0);
  });
  test("a failed payment is never marked paid", async () => {
    const oid = await makeOrder(); payments.pay_ABC123456 = { id: "pay_ABC123456", order_id: oid, amount: 1999900, currency: "INR", status: "failed" };
    const r = await verify({ request: req("/api/verify", { razorpay_order_id: oid, razorpay_payment_id: "pay_ABC123456", razorpay_signature: sig(oid, "pay_ABC123456") }), env }); restore();
    expect(r.status).toBe(402); expect(sent.length).toBe(0);
  });
  test("a payment still being created answers 'confirming' (202)", async () => {
    const oid = await makeOrder(); payments.pay_ABC123456 = { id: "pay_ABC123456", order_id: oid, amount: 1999900, currency: "INR", status: "created" };
    const r = await verify({ request: req("/api/verify", { razorpay_order_id: oid, razorpay_payment_id: "pay_ABC123456", razorpay_signature: sig(oid, "pay_ABC123456") }), env }); restore();
    expect(r.status).toBe(202); expect((await r.json()).confirming).toBe(true); expect(sent.length).toBe(0);
  });
  test("an authorized payment is captured first", async () => {
    const oid = await makeOrder(); payments.pay_ABC123456 = { id: "pay_ABC123456", order_id: oid, amount: 1999900, currency: "INR", status: "authorized" };
    const r = await verify({ request: req("/api/verify", { razorpay_order_id: oid, razorpay_payment_id: "pay_ABC123456", razorpay_signature: sig(oid, "pay_ABC123456") }), env }); restore();
    expect(r.status).toBe(200); expect(calls.some((c) => c.url.endsWith("/capture"))).toBe(true);
  });
  test("works without a mail key: confirms, reports not mailed", async () => {
    const oid = await makeOrder(); payments.pay_ABC123456 = { id: "pay_ABC123456", order_id: oid, amount: 1999900, currency: "INR", status: "captured" };
    const r = await verify({ request: req("/api/verify", { razorpay_order_id: oid, razorpay_payment_id: "pay_ABC123456", razorpay_signature: sig(oid, "pay_ABC123456") }), env: { ...env, RESEND_API_KEY: undefined } }); restore();
    const j = await r.json(); expect(j.ok).toBe(true); expect(j.mailed).toBe(false);
  });
  test("rejects malformed ids and other origins", async () => {
    let r = await verify({ request: req("/api/verify", { razorpay_order_id: "x", razorpay_payment_id: "y", razorpay_signature: "z" }), env }); expect(r.status).toBe(400);
    r = await verify({ request: req("/api/verify", {}, { origin: "https://evil.example" }), env }); expect(r.status).toBe(403); restore();
  });
});

describe("central payments (orders open through IT Services by Rajat Agarwal)", () => {
  const cenv = { ...env, PAY_SERVICE_KEY: "psk_coach", PAY_SERVICE_URL: "https://central.test" };
  let central, up;
  beforeEach(() => {
    central = { orders: [], verifies: [] }; up = true;
    const inner = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      if (u === "https://central.test/api/pay/order") {
        if (!up) throw new Error("down");
        const b = JSON.parse(init.body); central.orders.push({ key: init.headers["x-site-key"], ...b });
        const id = "order_CEN" + central.orders.length + "abcdef"; orders[id] = { id, amount: b.amount_minor, currency: b.currency, notes: { ...b.extra_notes, product: b.product, variation: b.plan } };
        return Response.json({ ok: true, orderId: id });
      }
      if (u === "https://central.test/api/pay/verify") { central.verifies.push({ key: init.headers["x-site-key"], ...JSON.parse(init.body) }); return Response.json({ ok: true }); }
      return inner(url, init);
    };
  });
  test("a booking is opened centrally: this website / sales / startups_N, with the buyer's details as notes", async () => {
    const r = await checkout({ request: req("/api/checkout", { ...good, qty: 2 }), env: cenv }); restore();
    const j = await r.json(); expect(r.status).toBe(200);
    expect(central.orders).toHaveLength(1);
    expect(central.orders[0]).toMatchObject({ key: "psk_coach", site: "rajat-agarwal-startup-coach.pages.dev", product: "startup_coach", plan: "startups_2", amount_minor: 3999800, currency: "INR" });
    expect(central.orders[0].extra_notes).toMatchObject({ startup: "FreshCart", mobile: "+919876543210" });
    expect(j.razorpay.orderId).toBe("order_CEN1abcdef");
  });
  test("if the central service is down the booking still works, opened directly with Razorpay", async () => {
    up = false;
    const r = await checkout({ request: req("/api/checkout", good), env: cenv }); restore();
    expect(r.status).toBe(200); expect(central.orders).toHaveLength(0);
    const o = Object.values(orders)[0]; expect(o.notes).toMatchObject({ site: "rajat-agarwal-startup-coach.pages.dev", stream: "sales", plan: "startups_1" });
  });
  test("a verified payment is reported to the central ledger", async () => {
    const c = await (await checkout({ request: req("/api/checkout", good), env: cenv })).json();
    const oid = c.razorpay.orderId, pid = "pay_CEN0000001";
    payments[pid] = { id: pid, order_id: oid, amount: orders[oid].amount, currency: "INR", status: "captured" };
    const r = await verify({ request: req("/api/verify", { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig(oid, pid) }), env: cenv }); restore();
    expect(r.status).toBe(200);
    expect(central.verifies).toHaveLength(1);
    expect(central.verifies[0]).toMatchObject({ key: "psk_coach", site: "rajat-agarwal-startup-coach.pages.dev", razorpay_order_id: oid, razorpay_payment_id: pid });
  });
});


describe("access link (the key to the Proof Forge app)", () => {
  async function paid(extra = {}) {
    const c = await (await checkout({ request: req("/api/checkout", { ...good, ...extra }), env })).json();
    const orderId = c.razorpay.orderId; const payId = "pay_ACCESS" + Math.random().toString(36).slice(2, 8);
    payments[payId] = { id: payId, order_id: orderId, amount: orders[orderId].amount, currency: "INR", status: "captured" };
    return { orderId, payId, res: await verify({ request: req("/api/verify", { razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: sig(orderId, payId) }), env }) };
  }
  test("checkout refuses a booking unless ALL THREE boxes are ticked for the current version of the words", async () => {
    for (const consent of [false, null, true, { v: "2026-10-14", boxes: [] }, { v: "2026-10-14", boxes: ["A"] }, { v: "2026-10-14", boxes: ["A", "B"] }, { v: "2026-10-14", boxes: ["A", "C"] }, { v: "2026-10-13", boxes: ["A", "B", "C"] }, { v: "2020-01-01", boxes: ["A", "B", "C"] }, { boxes: ["A", "B", "C"] }]) {
      const r = await checkout({ request: req("/api/checkout", { ...good, consent }), env }); expect(r.status).toBe(400);
      expect((await r.json()).code).toBe("consent-required");
    }
  });
  test("a verified payment returns a link whose token the app can open, and e-mails it", async () => {
    const { payId, res } = await paid({ qty: 2 }); const j = await res.json();
    expect(j.accessLink.startsWith("https://app.example/#access=")).toBe(true);
    const { openToken } = await import("../../proof-forge/functions/api/_access.js");
    const tok = await openToken("shared-secret-xyz", j.accessLink.split("#access=")[1]);
    expect(tok.p).toBe(payId); expect(tok.q).toBe(2); expect(tok.e).toBe("asha@example.com"); expect(tok.s).toBe("FreshCart");
    const buyer = sent.find((m) => m.to[0] === "asha@example.com"); expect(buyer.text).toContain(j.accessLink); expect(buyer.text).toContain("Rs 9,999");
    expect(buyer.subject).toContain("private Proof Forge link");
  });
  test("a token made with a different secret is useless to the app", async () => {
    const { res } = await paid(); const j = await res.json();
    const { openToken } = await import("../../proof-forge/functions/api/_access.js");
    expect(await openToken("wrong-secret", j.accessLink.split("#access=")[1])).toBe(null);
  });
  test("without ACCESS_SECRET the buyer is still told, and no link is invented", async () => {
    const saved = env.ACCESS_SECRET; delete env.ACCESS_SECRET;
    try { const { res } = await paid(); const j = await res.json(); expect(j.accessLink).toBe(null); expect(sent.find((m) => m.to[0] === "asha@example.com").text).toContain("will be e-mailed to you shortly"); }
    finally { env.ACCESS_SECRET = saved; }
  });
});
