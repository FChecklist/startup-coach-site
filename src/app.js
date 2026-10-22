/* Booking form: asks our own server for a Razorpay order, runs Razorpay's window inside the pay frame of the website registered with Razorpay
   (IT Services by Rajat Agarwal), then sends the signed result to /api/verify. The server decides the price and confirms the payment. */
(function () {
  "use strict";
  var PRICE = 19999;
  var $ = function (id) { return document.getElementById(id); };
  var form = $("pay"); if (!form) return;
  var opened = Date.now(); // the server checks that the form was open for a believable time (bot check)
  var money = function (n) { return "₹" + Number(n).toLocaleString("en-IN"); };
  var msg = $("msg"), go = $("go");
  // A message is never left bare: a polite title, what happened, exact steps, and the box to fix (outlined and focused). Nothing typed is lost.
  var GUIDE = [
    [/tick all three boxes/i, "Please tick the three boxes", "We need your agreement to the three points before we take a payment.", ["Read the three points above the pay button.", "Tick each box.", "Press the pay button again."], "consent_a"],
    [/enter your name/i, "Please type your name", "We need your name for the booking and the receipt.", ["Type your name in the Name box.", "Press the pay button again."], "f-name"],
    [/startup's name/i, "Please type your startup's name", "We need it to put on your booking.", ["Type your startup's name in its box.", "Press the pay button again."], "f-startup"],
    [/valid e-mail/i, "Please check your e-mail address", "It should look like name@company.com. Your receipt and access link are sent there.", ["Look at the e-mail box and fix any typing slip.", "Press the pay button again."], "f-email"],
    [/10-digit Indian mobile/i, "Please check your mobile number", "We need a 10-digit mobile number that starts with 6, 7, 8 or 9.", ["Type just the 10 digits, with no spaces.", "Press the pay button again."], "f-phone"],
    [/fill in the form|too-fast/i, "Please take a moment and try again", "The form was sent a little too fast. Nothing is lost.", ["Check your details once more.", "Press the pay button again."], ""],
    [/too many booking attempts/i, "Please give it a little time", "There were many attempts just now. Nothing is lost.", ["Wait a few minutes and press the pay button again.", "Or call or WhatsApp +91 96503 97480 and we will book your seat."], ""],
    [/being switched on|not switched on/i, "Online payment is not open just yet", "You can still book your seat with us directly.", ["Call or WhatsApp +91 96503 97480.", "We will book your seat and send the receipt."], ""],
    [/still waiting for Razorpay|could not be verified|could not match this payment|did not match the order/i, "We are still confirming your payment", "If money was taken, your seat is safe. This is not your doing.", ["Do not pay again.", "Write to rajatsiroffice@gmail.com with your payment ID, or call +91 96503 97480.", "We will confirm your seat."], ""],
    [/could not reach|not reachable|internet/i, "We could not reach the service", "Your internet may have dropped, or the service is busy for a moment. Nothing is lost and nothing was charged by this attempt.", ["Check your internet.", "Wait a minute and press the pay button again."], ""],
    [/could not start your payment/i, "The payment could not start", "This is not your doing. Nothing was charged.", ["Press the pay button again in a minute.", "If it keeps happening, call +91 96503 97480."], ""]
  ];
  function show(t) {
    msg.textContent = ""; msg.hidden = !t; msg.removeAttribute("tabindex"); if (!t) return;
    var g = null; for (var i = 0; i < GUIDE.length; i++) if (GUIDE[i][0].test(t)) { g = GUIDE[i]; break; }
    if (!g) g = [null, "That did not go through", t.length < 160 ? t : "Something went wrong. Nothing is lost.", ["Press the pay button again.", "If it keeps happening, call or WhatsApp +91 96503 97480."], ""];
    var h = document.createElement("div"); h.style.fontWeight = "800"; h.textContent = g[1]; msg.appendChild(h);
    var p = document.createElement("div"); p.style.cssText = "font-weight:500;margin:4px 0"; p.textContent = g[2]; msg.appendChild(p);
    var ol = document.createElement("ol"); ol.style.cssText = "font-weight:500;margin:4px 0 0 18px;padding:0"; g[3].forEach(function (x) { var li = document.createElement("li"); li.textContent = x; ol.appendChild(li); }); msg.appendChild(ol);
    msg.setAttribute("role", "alert"); msg.setAttribute("tabindex", "-1");
    var el = g[4] ? ($(g[4]) || document.querySelector('[name="' + g[4] + '"]')) : null;
    if (el) { el.style.outline = "3px solid #D9534F"; el.style.outlineOffset = "2px"; var clear = function () { el.style.outline = ""; el.removeEventListener("input", clear); el.removeEventListener("change", clear); }; el.addEventListener("input", clear); el.addEventListener("change", clear); try { el.scrollIntoView({ block: "center" }); el.focus({ preventScroll: true }); } catch (e) {} }
    else { try { msg.scrollIntoView({ block: "center" }); msg.focus({ preventScroll: true }); } catch (e) {} }
  }
  function refresh() { var q = Number($("f-qty").value) || 1; $("total").textContent = money(PRICE * q); if (!go.disabled) go.textContent = "Pay " + money(PRICE * q) + " securely"; }
  $("f-qty").addEventListener("change", refresh); refresh();

  function api(path, body) {
    return fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(function () { throw new Error("We could not reach the service. Please check your internet and try again."); }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok && r.status !== 202) { var e = new Error(j.error || "Something went wrong. Please try again."); e.off = !!j.off; throw e; } j._status = r.status; return j; });
    });
  }
  // The Razorpay window runs inside the registered website's pay frame; only the signed result comes back here.
  function payViaFrame(rz, hop) {
    return new Promise(function (resolve, reject) {
      var origin = new URL(hop).origin, wrap = document.createElement("div"), fr = document.createElement("iframe"), timer;
      function done(fn, v) { window.removeEventListener("message", onMsg); clearTimeout(timer); wrap.remove(); fn(v); }
      wrap.className = "payover"; wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-label", "Secure payment");
      fr.src = hop; fr.title = "Secure payment"; fr.setAttribute("allow", "payment");
      fr.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent"; wrap.appendChild(fr);
      var opts = { key: rz.keyId, order_id: rz.orderId, amount: rz.amount, currency: rz.currency, name: rz.name, description: rz.description, prefill: rz.prefill, notes: rz.notes, theme: rz.theme, config: rz.config };
      timer = setTimeout(function () { done(reject, new Error("Could not reach the payment service. Check your internet and try again.")); }, 30000);
      function onMsg(ev) {
        if (ev.origin !== origin || ev.source !== fr.contentWindow || !ev.data) return;
        var d = ev.data;
        if (d.t === "ready") { clearTimeout(timer); fr.contentWindow.postMessage({ t: "open", opts: opts }, origin); }
        else if (d.t === "dismissed") done(reject, Object.assign(new Error("Payment was cancelled. Nothing was charged."), { cancelled: true }));
        else if (d.t === "failed") done(reject, new Error(String(d.message || "The payment failed. Nothing was charged.").slice(0, 300)));
        else if (d.t === "paid" && d.resp) done(resolve, d.resp);
      }
      window.addEventListener("message", onMsg); document.body.appendChild(wrap);
    });
  }
  function sleep(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  async function confirmPayment(resp) {
    for (var i = 0; i < 60; i++) { // Razorpay may need a moment: ask every 4 seconds, for up to 4 minutes
      var r = await api("/api/verify", resp);
      if (r.ok) return r;
      await sleep(4000);
    }
    throw new Error("We are still waiting for Razorpay to confirm your payment. If money was taken, your seat is safe: write to rajatsiroffice@gmail.com with your payment ID " + resp.razorpay_payment_id + ".");
  }
  form.addEventListener("submit", async function (e) {
    e.preventDefault(); show("");
    var f = new FormData(form), body = { name: f.get("name"), startup: f.get("startup"), email: f.get("email"), phone: f.get("phone"), qty: Number(f.get("qty")), website: f.get("website"), t: Date.now() - opened, consent: (f.get("consent_a") && f.get("consent_b") && f.get("consent_c")) ? { v: "2026-10-14", boxes: ["A", "B", "C"] } : null };
    if (!body.consent) return show("Please tick all three boxes to continue.");
    if (String(body.name).trim().length < 2) return show("Please enter your name.");
    if (String(body.startup).trim().length < 2) return show("Please enter your startup's name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(body.email).trim())) return show("Please enter a valid e-mail address.");
    if (!/^[6-9]\d{9}$/.test(String(body.phone).replace(/\D/g, "").replace(/^(91|0)+(?=\d{10}$)/, ""))) return show("Please enter a valid 10-digit Indian mobile number.");
    go.disabled = true; go.textContent = "Starting your payment...";
    try {
      var order = await api("/api/checkout", body);
      go.textContent = "Complete the payment in the Razorpay window";
      var resp = await payViaFrame(order.razorpay, order.hop);
      go.textContent = "Confirming your payment...";
      var res = await confirmPayment(resp);
      form.hidden = true; var done = $("done"); done.hidden = false;
      $("done-text").textContent = "Thank you, " + res.name + ". " + res.startups + (res.startups > 1 ? " seats" : " seat") + " for " + res.startup + ", " + money(res.total) + ". Razorpay payment ID: " + res.paymentId + ".";
      var dc = $("done-consent"), labels = form.querySelectorAll(".consent label.chk");
      if (dc && labels.length) { var ol = document.createElement("ol"); labels.forEach(function (l) { var li = document.createElement("li"); li.textContent = l.textContent.replace(/\s+/g, " ").trim(); ol.appendChild(li); }); dc.textContent = ""; var h = document.createElement("b"); h.textContent = "What you accepted (version 2026-10-14):"; dc.appendChild(h); dc.appendChild(ol); dc.hidden = false; dc.className = "acc small"; }
      if (res.accessLink) { var a = $("done-link"); a.href = res.accessLink; a.hidden = false; }
      done.focus();
    } catch (err) {
      show(err.message || "Something went wrong. Please try again.");
      go.disabled = false; refresh();
    }
  });
})();
