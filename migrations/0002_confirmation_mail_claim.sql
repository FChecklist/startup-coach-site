-- Confirmation e-mails exactly once per payment (written 2026-10-14). Run ONCE per database (SQLite has no "ADD COLUMN IF NOT EXISTS"); the tests build theirs from 0001 + this file.
--   payment.mailed_ms        when the BUYER's confirmation mail was claimed for sending (NULL = not sent and nobody is sending it)
--   payment.owner_mailed_ms  the same for the OWNER's mail
-- A mail is claimed with  UPDATE payment SET <col>=? WHERE id=? AND <col> IS NULL  (one winner, however many of /api/verify and /api/webhook run at once),
-- and the claim is set back to NULL when the send fails, so it can be retried. See functions/api/_confirm.js.
ALTER TABLE payment ADD COLUMN mailed_ms INTEGER;
ALTER TABLE payment ADD COLUMN owner_mailed_ms INTEGER;
-- Payments already paid before this column existed were confirmed by /api/verify (the only sender then): they must never be mailed a second time by a late webhook.
UPDATE payment SET mailed_ms = paid_ms, owner_mailed_ms = paid_ms WHERE status = 'paid' AND mailed_ms IS NULL;
