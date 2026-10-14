// Retention of the Coach website's personal data (data audit item 7). Billing data is never removed: only a booking that was started and never paid
// (and never had a payment attempt) goes after 30 days, plus two scratch tables. Nothing happens unless it is switched on. Run: bun test
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { makeD1 } from "./d1-sqlite.js";
import { runRetention, RETENTION } from "../functions/api/_retention.js";
import { onRequestPost as retentionRoute } from "../functions/api/owner/retention.js";

const DAY = 86400_000, NOW = Date.UTC(2026, 9, 14, 6, 0, 0), OWNER = "owner-key-for-tests-0123456789abcdef";
let raw, env;
const row = (sql, ...a) => raw.query(sql).get(...a), rows = (sql, ...a) => raw.query(sql).all(...a);
const booking = (id, status, ageDays, extra = {}) => raw.query("INSERT INTO payment(id,txn_id,amount_minor,org,payer_name,payer_email,payer_phone,status,rzp_payment_id,created_ms,paid_ms,updated_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(id, "COA-" + id, 1999900, "FreshCart", "Asha", "a@example.com", "+919876543210", status, extra.rzp ?? null, NOW - ageDays * DAY, status === "paid" ? NOW - ageDays * DAY : null, NOW);
const consent = (id) => raw.query("INSERT INTO consent_record(payment_id,box,version,text_sha256,text,accepted_ms) VALUES(?,?,?,?,?,?)").run(id, "A", "v", "h", "t", NOW);
const ledger = () => JSON.stringify([rows("SELECT * FROM payment WHERE id<>'sc_old_unpaid' AND id<>'sc_old_void'"), rows("SELECT * FROM payment_attempt"), rows("SELECT * FROM payment_refund"), rows("SELECT * FROM webhook_log"), rows("SELECT * FROM consent_record WHERE payment_id NOT IN ('sc_old_unpaid','sc_old_void')")]);
beforeEach(() => {
  const d = makeD1(); raw = d.raw; env = { DB: d.db, OWNER_LEDGER_KEY: OWNER };
  booking("sc_old_unpaid", "created", 31); booking("sc_old_void", "void", 45); booking("sc_new_unpaid", "created", 5); booking("sc_old_paid", "paid", 4000, { rzp: "pay_p1" });
  booking("sc_old_failed_try", "created", 400); booking("sc_old_with_refund", "created", 400);
  for (const id of ["sc_old_unpaid", "sc_old_void", "sc_new_unpaid", "sc_old_paid", "sc_old_failed_try"]) consent(id);
  raw.query("INSERT INTO payment_attempt(rzp_payment_id,payment_id,status,updated_ms) VALUES('pay_f1','sc_old_failed_try','failed',1)").run();
  raw.query("INSERT INTO payment_attempt(rzp_payment_id,payment_id,status,updated_ms) VALUES('pay_p1','sc_old_paid','captured',1)").run();
  raw.query("INSERT INTO payment_refund(rzp_refund_id,rzp_payment_id,payment_id,amount_minor,updated_ms) VALUES('rf1','pay_x','sc_old_with_refund',1,1)").run();
  raw.query("INSERT INTO webhook_log(at_ms,signature_ok) VALUES(?,0)").run(NOW - 1000 * DAY);
  raw.query("INSERT INTO event_seen(rzp_event_id,seen_ms) VALUES('e_old',?)").run(NOW - 100 * DAY); raw.query("INSERT INTO event_seen(rzp_event_id,seen_ms) VALUES('e_new',?)").run(NOW - 1 * DAY);
  raw.query("INSERT INTO checkout_hit(who,hour,n) VALUES('all',?,1)").run(Math.floor((NOW - 3 * DAY) / 3600_000)); raw.query("INSERT INTO checkout_hit(who,hour,n) VALUES('all',?,1)").run(Math.floor(NOW / 3600_000));
});
describe("retention", () => {
  test("the periods are stated in the Privacy Notice, with the billing sentence, and no other wording about keeping billing data", () => {
    expect(RETENTION).toEqual({ unpaid_booking_days: 30, seen_event_days: 90, counter_days: 2 });
    const notice = readFileSync(new URL("../legal/privacy.frag.html", import.meta.url), "utf8");
    for (const t of ["30 days", "2 days", "we keep billing data for audit and tax reasons"]) expect(notice).toContain(t);
    expect(notice).not.toMatch(/forever|permanent|for ever\b|8 years|then your name, e-mail and mobile number are removed/i);
  });
  test("a dry run counts and changes nothing", async () => {
    const snap = () => JSON.stringify([rows("SELECT * FROM payment"), rows("SELECT * FROM consent_record"), rows("SELECT * FROM event_seen"), rows("SELECT * FROM checkout_hit")]);
    const before = snap();
    expect(await runRetention(env, { apply: false, now: NOW })).toEqual({ unpaid_bookings_deleted: 2, consent_rows_deleted: 2, seen_events_deleted: 1, counters_deleted: 1 });
    expect(snap()).toBe(before);
  });
  test("applying removes only never-paid bookings with no attempt, and leaves every ledger row exactly as it was", async () => {
    const before = ledger();
    await runRetention(env, { apply: true, now: NOW });
    expect(rows("SELECT id FROM payment ORDER BY id").map((r) => r.id)).toEqual(["sc_new_unpaid", "sc_old_failed_try", "sc_old_paid", "sc_old_with_refund"]);
    expect(rows("SELECT payment_id FROM consent_record ORDER BY 1").map((r) => r.payment_id)).toEqual(["sc_new_unpaid", "sc_old_failed_try", "sc_old_paid"]);
    expect(ledger()).toBe(before);
    expect(row("SELECT payer_name, payer_email, payer_phone, org FROM payment WHERE id='sc_old_paid'")).toEqual({ payer_name: "Asha", payer_email: "a@example.com", payer_phone: "+919876543210", org: "FreshCart" });
    expect(rows("SELECT rzp_event_id FROM event_seen").map((r) => r.rzp_event_id)).toEqual(["e_new"]); expect(rows("SELECT * FROM checkout_hit").length).toBe(1);
    expect(rows("SELECT * FROM webhook_log").length).toBe(1); // the message log is a ledger record: kept
    expect((await runRetention(env, { apply: true, now: NOW })).unpaid_bookings_deleted).toBe(0);
  });
  const call = (qs, key = OWNER, e = env) => retentionRoute({ request: new Request("https://x/api/owner/retention" + qs, { method: "POST", headers: { authorization: "Bearer " + key } }), env: e });
  test("the route is owner-only, counts by default, and deletes only with apply=1 AND RETENTION_LIVE=1", async () => {
    expect((await call("", "wrong-wrong-wrong-wrong-wrong")).status).toBe(404);
    expect(await (await call("?apply=1")).json()).toMatchObject({ ok: true, live: false, applied: false, dry_run: true });
    expect(rows("SELECT * FROM payment").length).toBe(6);
    expect(await (await call("", OWNER, { ...env, RETENTION_LIVE: "1" })).json()).toMatchObject({ applied: false });
    expect(rows("SELECT * FROM payment").length).toBe(6);
    expect(await (await call("?apply=1", OWNER, { ...env, RETENTION_LIVE: "1" })).json()).toMatchObject({ live: true, applied: true, dry_run: false });
    expect(rows("SELECT * FROM payment").length).toBe(4);
  });
});
