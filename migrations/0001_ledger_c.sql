-- Ledger C of the Startup Coach website: its own payment ledger, connected to Razorpay (A) and to the central ledger B (IT Services by Rajat Agarwal).
-- Written 2026-10-14. Safe to repeat (every statement is CREATE .. IF NOT EXISTS). The tests build their database from this very file.
--   payment          one row per booking the buyer starts: id = the website's own payment id (sc_...), txn_id = COA-<id> (the same text is in Razorpay's order notes and in B).
--   payment_attempt  every Razorpay try (authorized / captured / failed) with the reason it failed; the primary key is Razorpay's payment id, so one try is one row.
--   event_seen       Razorpay event ids (or a key made from the message) already handled: a repeated delivery is ignored.
--   payment_refund   Razorpay refunds, one row each.
--   webhook_log      every call to /api/webhook (signature ok or not, outcome): proof that Razorpay's webhook secret matches.
--   ledger_state     when the monthly figures were last sent to B, and whether something changed since.
CREATE TABLE IF NOT EXISTS payment (
  id TEXT PRIMARY KEY,
  txn_id TEXT NOT NULL UNIQUE,
  rzp_order_id TEXT UNIQUE,
  rzp_payment_id TEXT,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  plan TEXT,
  startups INTEGER,
  org TEXT,
  payer_name TEXT,
  payer_email TEXT,
  payer_phone TEXT,
  status TEXT NOT NULL,
  method TEXT, bank TEXT, card_network TEXT, card_type TEXT, rrn TEXT,
  fee_minor INTEGER, tax_minor INTEGER,
  created_ms INTEGER NOT NULL,
  paid_ms INTEGER,
  updated_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_paid ON payment (status, paid_ms);
CREATE TABLE IF NOT EXISTS payment_attempt (
  rzp_payment_id TEXT PRIMARY KEY,
  payment_id TEXT, rzp_order_id TEXT, txn_id TEXT,
  status TEXT NOT NULL, currency TEXT, amount_minor INTEGER,
  method TEXT, bank TEXT, card_network TEXT, card_type TEXT, card_last4 TEXT, vpa_masked TEXT, rrn TEXT,
  error_code TEXT, error_description TEXT, error_reason TEXT,
  fee_minor INTEGER, tax_minor INTEGER,
  authorized_ms INTEGER, captured_ms INTEGER, failed_ms INTEGER, event_ms INTEGER, created_ms INTEGER,
  updated_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_attempt_payment ON payment_attempt (payment_id);
CREATE TABLE IF NOT EXISTS event_seen (rzp_event_id TEXT PRIMARY KEY, event TEXT, seen_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payment_refund (
  rzp_refund_id TEXT PRIMARY KEY,
  rzp_payment_id TEXT NOT NULL, payment_id TEXT, txn_id TEXT,
  currency TEXT, amount_minor INTEGER NOT NULL, status TEXT,
  created_ms INTEGER, updated_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_refund_payment ON payment_refund (rzp_payment_id);
CREATE TABLE IF NOT EXISTS ledger_state (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS webhook_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at_ms INTEGER NOT NULL, rzp_event_id TEXT, event TEXT, signature_ok INTEGER NOT NULL,
  outcome TEXT, status INTEGER, rzp_order_id TEXT, rzp_payment_id TEXT, payment_id TEXT
);
