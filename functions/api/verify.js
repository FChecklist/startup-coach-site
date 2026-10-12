// Confirms a payment. The browser only REPORTS the result; this function checks Razorpay's signature (HMAC with the account secret),
// then asks Razorpay itself what happened (the order's own notes and amount, the payment's own status) before saying "paid" and sending e-mails.
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
async function hmac(secret, msg) { const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return hex(await crypto.subtle.sign("HMAC", k, enc.encode(msg))); }
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const rs = (n) => "Rs " + Number(n).toLocaleString("en-IN");

async function rzp(env, path, init = {}) {
  const r = await fetch((env.RAZORPAY_BASE_URL || "https://api.razorpay.com") + path, { ...init, headers: { authorization: "Basic " + btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`), "content-type": "application/json" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.description || "Razorpay error");
  return j;
}
async function mail(env, to, subject, text, html, key) {
  if (!env.RESEND_API_KEY) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ from: env.MAIL_FROM || "Rajat Agarwal, Startup Coach <coaching@veridian-aios.com>", to: [to], reply_to: env.OWNER_EMAIL || "rajatsiroffice@gmail.com", subject, text, html, headers: { "Auto-Submitted": "auto-generated" } }),
    });
    return r.ok;
  } catch { return false; }
}

// Tell the central ledger (IT Services) about a verified payment. Best effort: it never blocks or fails the buyer; the central webhook records it too.
async function reportToCentral(env, orderId, payId, sig) {
  if (!env.PAY_SERVICE_KEY) return;
  try { await fetch((env.PAY_SERVICE_URL || "https://itservices-rajat-agarwal.pages.dev").replace(/\/+$/, "") + "/api/pay/verify", { method: "POST", headers: { "content-type": "application/json", "x-site-key": env.PAY_SERVICE_KEY }, signal: AbortSignal.timeout(4000), body: JSON.stringify({ site: "rajat-agarwal-startup-coach.pages.dev", razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: sig }) }); } catch { /* the webhook records it */ }
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ error: "Not allowed." }, 403);
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return json({ error: "Online payment is not switched on." }, 503);
  const raw = await request.text();
  if (raw.length > 2048) return json({ error: "Request too large." }, 413);
  let b; try { b = JSON.parse(raw); } catch { return json({ error: "Bad request." }, 400); }
  const orderId = String(b?.razorpay_order_id ?? ""), payId = String(b?.razorpay_payment_id ?? ""), sig = String(b?.razorpay_signature ?? "");
  if (!/^order_\w{6,40}$/.test(orderId) || !/^pay_\w{6,40}$/.test(payId) || !/^[0-9a-f]{64}$/.test(sig)) return json({ error: "We could not match this payment." }, 400);
  if (!same(await hmac(env.RAZORPAY_KEY_SECRET, `${orderId}|${payId}`), sig)) return json({ error: "The payment could not be verified. If money was taken, write to rajatsiroffice@gmail.com with your payment ID." }, 400);
  let order, pay;
  try { [order, pay] = await Promise.all([rzp(env, `/v1/orders/${orderId}`), rzp(env, `/v1/payments/${payId}`)]); }
  catch { return json({ error: "We could not reach the payment service to confirm. Your payment is safe; please check again in a minute." }, 502); }
  if (pay.order_id !== orderId || Number(pay.amount) !== Number(order.amount) || pay.currency !== "INR") return json({ error: "The payment details did not match the order." }, 400);
  if (pay.status === "created") return json({ confirming: true, message: "Confirming your payment..." }, 202);
  if (pay.status === "authorized") { try { await rzp(env, `/v1/payments/${payId}/capture`, { method: "POST", body: JSON.stringify({ amount: order.amount, currency: "INR" }) }); } catch { /* auto-capture or an earlier capture may have finished it */ } }
  else if (pay.status !== "captured") return json({ error: `The payment is ${pay.status}. Nothing was charged to your order.` }, 402);
  await reportToCentral(env, orderId, payId, sig);
  const n = order.notes || {};
  const total = Math.round(Number(order.amount) / 100);
  const when = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST";
  const lines = [`Startup: ${n.startup}`, `Name: ${n.name}`, `E-mail: ${n.email}`, `Mobile: ${n.mobile}`, `Startups booked: ${n.startups}`, `Amount paid: ${rs(total)} (no GST charged)`, `Razorpay payment ID: ${payId}`, `Order ID: ${orderId}`, `Time: ${when}`];
  const buyerText = `Thank you, ${n.name}. Your payment was received and your seat is booked.\n\n${lines.join("\n")}\n\nRajat Agarwal will contact you on ${n.mobile} with your batch details. Questions? Reply to this e-mail or call +91 96503 97480.\n\nPayment is made to IT Services by Rajat Agarwal through Razorpay. This e-mail is your payment confirmation.`;
  const buyerHtml = `<div style="font:16px/1.5 Arial,sans-serif;color:#0B1F3A;max-width:560px"><h2 style="margin:0 0 8px">Your seat is booked</h2><p>Thank you, ${esc(n.name)}. Your payment was received.</p><table style="border-collapse:collapse;width:100%">${lines.map((l) => { const i = l.indexOf(": "); return `<tr><td style="padding:6px 10px;border-bottom:1px solid #D3DCE8;color:#475569">${esc(l.slice(0, i))}</td><td style="padding:6px 10px;border-bottom:1px solid #D3DCE8"><b>${esc(l.slice(i + 2))}</b></td></tr>`; }).join("")}</table><p>Rajat Agarwal will contact you on <b>${esc(n.mobile)}</b> with your batch details. Questions? Reply to this e-mail or call <a href="tel:+919650397480">+91 96503 97480</a>.</p><p style="color:#475569;font-size:14px">Payment is made to IT Services by Rajat Agarwal through Razorpay. This e-mail is your payment confirmation.</p></div>`;
  const ownerText = `NEW SEAT BOOKED (paid)\n\n${lines.join("\n")}\n\nCall the buyer to share batch details.`;
  const [m1, m2] = await Promise.all([
    mail(env, n.email, "Startup coaching: payment received, your seat is booked", buyerText, buyerHtml, "b-" + payId),
    mail(env, env.OWNER_EMAIL || "rajatsiroffice@gmail.com", `New seat booked: ${n.startup} (${rs(total)})`, ownerText, `<pre style="font:15px/1.5 Arial,sans-serif">${esc(ownerText)}</pre>`, "o-" + payId),
  ]);
  return json({ ok: true, paymentId: payId, orderId, total, startups: Number(n.startups) || 1, startup: n.startup, name: n.name, email: n.email, mailed: !!m1, ownerMailed: !!m2 });
}
export const onRequest = () => json({ error: "Not found." }, 404);
