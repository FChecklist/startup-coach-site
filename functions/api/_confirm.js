// The payment confirmation e-mails (buyer + owner), shared by /api/verify (the buyer's browser reports back) and /api/webhook (Razorpay reports, even when the
// buyer closed the tab). Whichever of the two arrives first sends the mails; the other one finds them already claimed and sends nothing.
//
// EXACTLY ONCE PER PAYMENT (enforced by the database, not by hope)
//   payment.mailed_ms        the buyer's mail.   payment.owner_mailed_ms   the owner's mail.   (migration 0002; NULL = not sent and nobody is sending it)
//   Before a mail is sent its column is CLAIMED with one atomic statement:  UPDATE payment SET mailed_ms=? WHERE id=? AND mailed_ms IS NULL
//   Only the call that changed one row may send; a concurrent verify + webhook cannot both win. If the send fails the claim is RELEASED (set back to NULL),
//   so the next verify, the next webhook or Razorpay's own redelivery tries again. The two mails are claimed separately, so a retry after one of them failed
//   never sends the other one a second time.
//   Fail-open on purpose: with no database, no booking row for the order, or a database error while claiming, the mails are sent unguarded (as before this
//   guard existed): a buyer who paid must never be left without a confirmation because the ledger is down. (Resend's idempotency key is the second layer.)
//   Known limit: a Worker killed between the claim and the answer from Resend leaves the claim set with nothing sent; that is rare and not detectable with one column.
import { claimMail, releaseMail } from "./_ledgerc.js";

const enc = new TextEncoder();
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const rs = (n) => "Rs " + Number(n).toLocaleString("en-IN");
// The access token: proof of a VERIFIED payment, sealed with a secret shared with the Proof Forge app (same format as proof-forge/functions/api/_access.js).
// It carries the buyer's e-mail, readable only with that secret, so the app can send stage e-mails and we store nothing.
const b64u = (b) => btoa(String.fromCharCode.apply(null, new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function mintToken(secret, obj) {
  const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode("pf-access|" + secret)), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return b64u(iv) + "." + b64u(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj))));
}

/** Sends one mail through Resend. True when Resend took it. A 409 means this idempotency key was already used (the first try did reach Resend), which counts as sent. */
async function mail(env, to, subject, text, html, key) {
  if (!env.RESEND_API_KEY) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ from: env.MAIL_FROM || "Rajat Agarwal, Startup Coach <coaching@veridian-aios.com>", to: [to], reply_to: env.OWNER_EMAIL || "rajatsiroffice@gmail.com", subject, text, html, headers: { "Auto-Submitted": "auto-generated" } }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok || r.status === 409;
  } catch { return false; }
}

/** Runs `send` once per payment: claim, send, release the claim if the send failed. Returns true when the mail has been sent (now, or earlier by the other path). */
async function once(db, row, col, now, send) {
  if (!db || !row) return send(); // nothing to claim against: send as before
  let mine;
  try { mine = await claimMail(db, row.id, col, now); } catch { return send(); /* fail-open, see the header */ }
  if (!mine) return true; // already sent (or being sent right now) by the other path
  let ok = false;
  try { ok = await send(); } finally { if (!ok) { try { await releaseMail(db, row.id, col, now); } catch { /* the next try will find it claimed; rare */ } } }
  return ok;
}

/**
 * Confirms a paid booking to the buyer and the owner. Never throws.
 *  row     the booking row of ledger C (buyer's details); null when there is none (then `order.notes` carries them, as in the first version)
 *  order   Razorpay's order (verify has it; the webhook has not and uses the row)
 * Returns { sent, ownerSent, buyerFailed, accessLink, n, total, startups } where `sent` / `ownerSent` mean "that mail has been sent, now or earlier",
 * and `buyerFailed` means "a buyer mail was due and could not be sent" (the webhook answers 500 then, so Razorpay delivers it again).
 */
export async function sendConfirmation(env, { db, row, orderId, payId, order, now = Date.now() }) {
  const amountMinor = Number(row?.amount_minor ?? order?.amount ?? 0);
  const n = { ...(order?.notes || {}), ...(row ? { startup: row.org, name: row.payer_name, email: row.payer_email, mobile: row.payer_phone, startups: String(row.startups) } : {}) };
  const total = Math.round(amountMinor / 100);
  const startups = Number(n.startups) || 1;
  const out = { sent: false, ownerSent: false, buyerFailed: false, accessLink: null, n, total, startups };
  try {
    const when = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST";
    const lines = [`Startup: ${n.startup}`, `Name: ${n.name}`, `E-mail: ${n.email}`, `Mobile: ${n.mobile}`, `Startups booked: ${n.startups}`, `Amount paid: ${rs(total)} (no GST charged)`, `Razorpay payment ID: ${payId}`, `Order ID: ${orderId}`, `Time: ${when}`];
    let accessLink = null;
    if (env.ACCESS_SECRET) { try { accessLink = (env.APP_URL || "https://proof-forge.pages.dev").replace(/\/+$/, "") + "/#access=" + (await mintToken(env.ACCESS_SECRET, { p: payId, q: startups, e: n.email, n: n.name, s: n.startup, at: Date.now() })); } catch { accessLink = null; } }
    out.accessLink = accessLink;
    const buyerText = `Thank you, ${n.name}. Your payment was received.\n\n${lines.join("\n")}\n\n` + (accessLink ? `YOUR PRIVATE LINK TO OPEN PROOF FORGE${startups > 1 ? " (it opens " + startups + " startups, one vault each)" : ""}:\n${accessLink}\n\nThe first time, you choose a passphrase. Write down the recovery code and vault id it shows you: nobody, including us, can recover your data without them. Keep this e-mail, the link is your key.\n\n` : `Your private access link will be e-mailed to you shortly. If it does not arrive within an hour, reply to this e-mail.\n\n`) + `HOW YOUR PAYMENT COMES BACK: raise a quarter of your own funding target by Step 9 and half (Rs 9,999 per startup) comes back. Reach half of your sales, profit and funding targets by Step 12 and all of it does. You set the targets, other people prove them, and a person audits every claim. We cannot promise anyone will raise money.\n\nQuestions? Reply to this e-mail or call +91 96503 97480.\n\nPayment is made to IT Services by Rajat Agarwal through Razorpay. This e-mail is your payment confirmation.`;
    const buyerHtml = `<div style="font:16px/1.5 Arial,sans-serif;color:#0B1F3A;max-width:560px"><h2 style="margin:0 0 8px">Your payment is confirmed</h2><p>Thank you, ${esc(n.name)}. Your payment was received.</p><table style="border-collapse:collapse;width:100%">${lines.map((l) => { const i = l.indexOf(": "); return `<tr><td style="padding:6px 10px;border-bottom:1px solid #D3DCE8;color:#475569">${esc(l.slice(0, i))}</td><td style="padding:6px 10px;border-bottom:1px solid #D3DCE8"><b>${esc(l.slice(i + 2))}</b></td></tr>`; }).join("")}</table>${accessLink ? `<p style="margin:18px 0"><a href="${esc(accessLink)}" style="background:#F5820A;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Open Proof Forge</a></p><p>The first time, you choose a passphrase. Write down the recovery code and vault id it shows you: nobody, including us, can recover your data without them. <b>Keep this e-mail: the link is your key.</b>${startups > 1 ? " It opens " + startups + " startups, one vault each." : ""}</p>` : `<p>Your private access link will be e-mailed to you shortly. If it does not arrive within an hour, reply to this e-mail.</p>`}<p><b>How your payment comes back:</b> raise a quarter of your own funding target by Step 9 and half (Rs 9,999 per startup) comes back. Reach half of your sales, profit and funding targets by Step 12 and all of it does. You set the targets, other people prove them, and a person audits every claim. We cannot promise anyone will raise money.</p><p>Questions? Reply to this e-mail or call <a href="tel:+919650397480">+91 96503 97480</a>.</p><p style="color:#475569;font-size:14px">Payment is made to IT Services by Rajat Agarwal through Razorpay. This e-mail is your payment confirmation.</p></div>`;
    const ownerText = `NEW SEAT BOOKED (paid)\n\n${lines.join("\n")}\n\nThe buyer was e-mailed their private access link ${accessLink ? "(sent)" : "(NOT minted: ACCESS_SECRET missing)"}.`;
    const hasBuyer = !!String(n.email ?? "").trim() && n.email !== "null" && n.email !== "undefined"; // a buyer with no address on record cannot be mailed; the owner still hears of the booking
    const [m1, m2] = await Promise.all([
      hasBuyer ? once(db, row, "mailed_ms", now, () => mail(env, n.email, "Your payment is confirmed. Here is your private Proof Forge link", buyerText, buyerHtml, "b-" + payId)) : false,
      once(db, row, "owner_mailed_ms", now, () => mail(env, env.OWNER_EMAIL || "rajatsiroffice@gmail.com", `New seat booked: ${n.startup} (${rs(total)})`, ownerText, `<pre style="font:15px/1.5 Arial,sans-serif">${esc(ownerText)}</pre>`, "o-" + payId)),
    ]);
    out.sent = !!m1; out.ownerSent = !!m2; out.buyerFailed = hasBuyer && !m1 && !!env.RESEND_API_KEY;
  } catch { out.buyerFailed = !!env.RESEND_API_KEY; /* a mail problem must never undo a paid booking */ }
  return out;
}
