p = r"C:\ct\startup-coach-site\src\app.js"
s = open(p, encoding="utf8", newline="").read()
nl = "\r\n" if "\r\n" in s else "\n"
old = '  function show(t) { msg.textContent = t; msg.hidden = !t; }'
assert old in s
new = '''  // A message is never left bare: a polite title, what happened, exact steps, and the box to fix (outlined and focused). Nothing typed is lost.
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
  }'''.replace("\n", nl)
s = s.replace(old, new, 1)
# a dropped connection must not show a raw "Failed to fetch"
a = '    return fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(function (r) {'
assert a in s
s = s.replace(a, '    return fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(function () { throw new Error("We could not reach the service. Please check your internet and try again."); }).then(function (r) {', 1)
open(p, "w", encoding="utf8", newline="").write(s)
print("ok")
