// What this website removes, and the job that does it (data audit item 7, 14 Oct 2026). NOT SWITCHED ON: nothing calls it on a schedule, and even when called it only
// COUNTS (dry run) unless the request says apply=1 AND the secret RETENTION_LIVE is "1".
// RULE: billing data is never removed. A booking that has a payment attempt, a Razorpay payment id or a paid status is part of ledger C and is kept for audit and tax
// reasons, with its attempts, refunds, consent rows and the Razorpay message log. This job does not touch them, and the tests prove it.
// What it removes (stated in the Privacy Notice, legal/privacy.frag.html):
//   - a booking that was started and never paid (status created or void) and never had any payment attempt: 30 days, then the booking and its consent rows are deleted
//   - the list of already-handled Razorpay event ids (event_seen, a duplicate filter) after 90 days, and the booking-form rate counters (checkout_hit) after 2 days
export const RETENTION = { unpaid_booking_days: 30, seen_event_days: 90, counter_days: 2 };
const DAY = 86400_000;
const UNPAID = "status IN ('created','void') AND rzp_payment_id IS NULL AND created_ms<? AND id NOT IN (SELECT payment_id FROM payment_attempt WHERE payment_id IS NOT NULL) AND id NOT IN (SELECT payment_id FROM payment_refund WHERE payment_id IS NOT NULL)";

export async function runRetention(env, { apply = false, now = Date.now() } = {}) {
  const db = env.DB, R = RETENTION, cutB = now - R.unpaid_booking_days * DAY, cutE = now - R.seen_event_days * DAY, hourC = Math.floor((now - R.counter_days * DAY) / 3600_000);
  const n = async (sql, ...a) => (await db.prepare(sql).bind(...a).first())?.n ?? 0, del = async (sql, ...a) => (await db.prepare(sql).bind(...a).run())?.meta?.changes ?? 0;
  if (!apply) return {
    unpaid_bookings_deleted: await n(`SELECT COUNT(*) AS n FROM payment WHERE ${UNPAID}`, cutB),
    consent_rows_deleted: await n(`SELECT COUNT(*) AS n FROM consent_record WHERE payment_id IN (SELECT id FROM payment WHERE ${UNPAID})`, cutB),
    seen_events_deleted: await n("SELECT COUNT(*) AS n FROM event_seen WHERE seen_ms<?", cutE),
    counters_deleted: await n("SELECT COUNT(*) AS n FROM checkout_hit WHERE hour<?", hourC),
  };
  const consent_rows_deleted = await del(`DELETE FROM consent_record WHERE payment_id IN (SELECT id FROM payment WHERE ${UNPAID})`, cutB);
  return {
    unpaid_bookings_deleted: await del(`DELETE FROM payment WHERE ${UNPAID}`, cutB), consent_rows_deleted,
    seen_events_deleted: await del("DELETE FROM event_seen WHERE seen_ms<?", cutE), counters_deleted: await del("DELETE FROM checkout_hit WHERE hour<?", hourC),
  };
}
