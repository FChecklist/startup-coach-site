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
  function show(t) { msg.textContent = t; msg.hidden = !t; }
  function refresh() { var q = Number($("f-qty").value) || 1; $("total").textContent = money(PRICE * q); if (!go.disabled) go.textContent = "Pay " + money(PRICE * q) + " securely"; }
  $("f-qty").addEventListener("change", refresh); refresh();

  function api(path, body) {
    return fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(function (r) {
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
