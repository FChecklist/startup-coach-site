-- Consent proof and the booking rate limit (written 14 Oct 2026, data audit items 11 and 25). Safe to repeat (CREATE .. IF NOT EXISTS). NOT yet applied to the live database.
--   consent_record  one row per ticked box per booking: the version of the words, the time, and the SHA-256 of the exact text (and the text itself, so it can be shown again
--                   whatever the page says later). payment_id is the website's own payment id (payment.id). Deleted with the booking when an unpaid booking expires.
--   checkout_hit    how many bookings one visitor started in one hour: a keyed hash of the address (never the address) and the hour. Deleted after 2 days.
CREATE TABLE IF NOT EXISTS consent_record (
  payment_id TEXT NOT NULL,
  box TEXT NOT NULL,
  version TEXT NOT NULL,
  text_sha256 TEXT NOT NULL,
  text TEXT NOT NULL,
  accepted_ms INTEGER NOT NULL,
  PRIMARY KEY (payment_id, box)
);
CREATE TABLE IF NOT EXISTS checkout_hit (
  who TEXT NOT NULL,
  hour INTEGER NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (who, hour)
);
