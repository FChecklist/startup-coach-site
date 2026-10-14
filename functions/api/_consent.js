// The three boxes a buyer ticks before paying, and the proof that they were ticked (data audit item 11, 14 Oct 2026).
//   A  the contract: Terms and Conditions and Refund Policy
//   B  the use of the buyer's data (name, e-mail, mobile) for exactly three purposes, as set out in the Privacy Notice
//   C  no promise of funding or any other result
// The page shows exactly these words (test/consent.test.js compares them). The server refuses a booking unless all three are ticked for THIS version, and writes one row per box
// into consent_record: version, time and the SHA-256 of the exact text. The buyer's confirmation e-mail repeats what was accepted. Withdrawal: by e-mail to the Grievance Officer.
export const CONSENT_VERSION = "2026-10-14";
export const CONSENT_TEXTS = {
  A: "I agree to the Terms and Conditions and the Refund Policy.",
  B: "I agree that my name, e-mail address and mobile number are used to confirm my payment, send my private access link and e-mail me about my progress, as set out in the Privacy Notice.",
  C: "I understand that no funding or other result is promised.",
};
export const BOXES = ["A", "B", "C"];
export const sha256Hex = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (x) => x.toString(16).padStart(2, "0")).join("");

/** True only when the request carries THIS version of the boxes and every box is ticked. */
export const consentOk = (cs) => !!cs && typeof cs === "object" && cs.v === CONSENT_VERSION && Array.isArray(cs.boxes) && BOXES.every((b) => cs.boxes.includes(b));

/** Text hash of all the boxes together (what the Razorpay note carries). */
export const bundleHash = async () => (await sha256Hex(BOXES.map((b) => `${b}:${CONSENT_TEXTS[b]}`).join("\n"))).slice(0, 16);

/** One row per box for this payment. Throws on a database error (the caller decides what a failure means). */
export async function recordConsent(db, paymentId, now) {
  for (const b of BOXES) {
    await db.prepare("INSERT OR IGNORE INTO consent_record(payment_id,box,version,text_sha256,text,accepted_ms) VALUES(?,?,?,?,?,?)")
      .bind(paymentId, b, CONSENT_VERSION, await sha256Hex(CONSENT_TEXTS[b]), CONSENT_TEXTS[b], now).run();
  }
}

/** What this payment's buyer accepted: [{ box, version, text, accepted_ms }], [] when nothing is on record. */
export async function acceptedConsent(db, paymentId) {
  if (!db || !paymentId) return [];
  try { return (await db.prepare("SELECT box, version, text, accepted_ms FROM consent_record WHERE payment_id=? ORDER BY box").bind(paymentId).all()).results ?? []; } catch { return []; }
}

/** The "what you accepted" part of the confirmation e-mail, as plain text. */
export function consentLines(rows) {
  if (!rows.length) return "";
  const when = new Date(rows[0].accepted_ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST";
  return `WHAT YOU ACCEPTED (version ${rows[0].version}, ${when}):\n` + rows.map((r) => `${r.box}. ${r.text}`).join("\n") + "\nTo withdraw your consent for the use of your data, write to rajatsiroffice@gmail.com with the subject \"Withdraw consent\".\n\n";
}
