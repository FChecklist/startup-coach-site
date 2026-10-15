// Real-Chromium (Playwright) checks of the BUILT site (dist/) with a stand-in payment: no network, no Razorpay, no card details.
//   node test/e2e/coach.e2e.mjs        (needs the heavy lock C:\ct\heavy.lock taken by the caller; run `node build.cjs` first)
// /api/checkout and /api/verify are answered by this script; the "pay frame" is a local page that plays the part of the registered website's frame.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
const require = createRequire("C:/ct/tambola/package.json");
const { chromium } = require("playwright");
const DIST = join(import.meta.dirname, "..", "..", "dist");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".txt": "text/plain" };
const FRAME = `<!doctype html><script>addEventListener("message",e=>{if(e.data&&e.data.t==="open")parent.postMessage({t:"paid",resp:{razorpay_order_id:"order_TEST",razorpay_payment_id:"pay_TEST",razorpay_signature:"sig"}},"*")});parent.postMessage({t:"ready"},"*")</script>`;
const srv = createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]);
  if (p === "/__frame") { r.writeHead(200, { "content-type": "text/html" }); return r.end(FRAME); }
  if (p.endsWith("/")) p += "index.html";
  let f = join(DIST, p); if (!existsSync(f) || !statSync(f).isFile()) f = existsSync(f + ".html") ? f + ".html" : join(DIST, "404.html");
  r.writeHead(f.endsWith("404.html") ? 404 : 200, { "content-type": (MIME[extname(f)] || "application/octet-stream") + "; charset=utf-8" }); r.end(readFileSync(f));
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const base = "http://127.0.0.1:" + srv.address().port;
const out = []; const t = (id, name, ok, d = "") => { out.push({ id, name, ok: !!ok, d }); console.log((ok ? "PASS " : "FAIL ") + id + " " + name + (ok ? "" : "  -> " + d)); };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe" });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage(); const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 120)); });
  // E01 every page: 200, one h1, no internal wording
  const FORBID = [/legal(ly)?\s+(review\s+)?pending/i, /review\s+pending/i, /owner'?s?\s+approval/i, /owner\s+told/i, /not\s+done/i, /lorem ipsum/i, /TODO\b/, /\{\{/];
  for (const p of ["/", "/pricing.html", "/terms.html", "/privacy.html", "/legal-position.html", "/offline.html"]) {
    const r = await page.goto(base + p); const h1 = await page.locator("h1").count(); const txt = await page.locator("body").innerText();
    const bad = FORBID.filter((x) => x.test(txt)).map(String);
    t("E01", `${p} loads, one h1, clean wording`, r.status() === 200 && h1 === 1 && !bad.length, `status ${r.status()} h1 ${h1} ${bad}`);
  }
  t("E02", "404 page answers 404", (await page.goto(base + "/nope")).status() === 404);
  // E03 seller named correctly, price and contact
  await page.goto(base + "/");
  const body = await page.locator("body").innerText();
  t("E03", "seller, price and contact on home", /IT Services by Rajat Agarwal/i.test(body) && /19,999/.test(body) && /rajatsiroffice@gmail\.com/.test(await page.content()) && /96503 97480/.test(body));
  t("E04", "no console or page errors on home", errs.length === 0, errs.join(" | "));
  // E05 manifest + service worker + icons
  const mf = await (await page.request.get(base + "/manifest.webmanifest")).json();
  const icons = await Promise.all(mf.icons.map(async (i) => (await page.request.get(base + i.src)).status()));
  t("E05", "installable: manifest, icons, service worker", mf.name && mf.start_url && icons.every((s) => s === 200) && (await page.request.get(base + "/sw.js")).status() === 200, JSON.stringify(icons));
  // E06 form validation messages
  const msg = page.locator("#msg");
  await page.click("#go"); t("E06a", "all three boxes required", /tick all three/i.test(await msg.innerText()));
  for (const b of ["a", "b", "c"]) await page.check("#f-consent-" + b);
  await page.click("#go"); t("E06b", "name required", /name/i.test(await msg.innerText()));
  await page.fill("#f-name", "Test Founder"); await page.click("#go"); t("E06c", "startup name required", /startup/i.test(await msg.innerText()));
  await page.fill("#f-startup", "Test Startup"); await page.fill("#f-email", "bad"); await page.click("#go"); t("E06d", "e-mail checked", /e-mail/i.test(await msg.innerText()));
  await page.fill("#f-email", "t@example.com"); await page.fill("#f-phone", "12345"); await page.click("#go"); t("E06e", "mobile checked", /mobile/i.test(await msg.innerText()));
  // E07 total follows quantity
  await page.selectOption("#f-qty", "3"); t("E07", "total = 3 x 19,999", /59,997/.test(await page.locator("#total").innerText()));
  // E08 mocked payment: server error is shown, then the stand-in success completes the booking
  let sent = null; await page.route("**/api/checkout", async (r) => { sent = r.request().postDataJSON(); await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ razorpay: { keyId: "rzp_test_x", orderId: "order_TEST", amount: 5999700, currency: "INR", name: "x", description: "x" }, hop: base + "/__frame", total: 59997, txnId: "COA-test" }) }); });
  await page.route("**/api/verify", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, name: "Test Founder", startups: 3, startup: "Test Startup", total: 59997, paymentId: "pay_TEST", accessLink: "https://example.test/x" }) }));
  await page.fill("#f-phone", "9812345678"); await page.click("#go");
  await page.waitForSelector("#done:not([hidden])", { timeout: 15000 }).catch(() => {});
  const doneTxt = await page.locator("#done-text").innerText().catch(() => "");
  t("E08", "stand-in payment completes the booking", /pay_TEST/.test(doneTxt) && /3 seats/.test(doneTxt), doneTxt);
  t("E09", "booking sends consent proof, quantity 3, no price from the browser", sent && sent.qty === 3 && !!sent.consent && sent.total === undefined && sent.amount === undefined, JSON.stringify(sent).slice(0, 200));
  t("E10", "access link shown after payment", await page.locator("#done-link").isVisible());
  // E11 phone fit 320-430, no sideways scroll, on every page
  for (const w of [320, 360, 390, 430]) {
    const c = await browser.newContext({ viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true }); const m = await c.newPage(); const wide = [];
    for (const p of ["/", "/pricing.html", "/terms.html", "/privacy.html", "/legal-position.html"]) { await m.goto(base + p); if (await m.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) wide.push(p); }
    t("E11", `no sideways scroll at ${w}px`, !wide.length, wide.join(","));
    await c.close();
  }
  // E12 accessibility basics: form controls labelled, images have alt, tap targets on the pay button
  await page.goto(base + "/");
  const unl = await page.evaluate(() => [...document.querySelectorAll("input:not([type=hidden]),select,textarea")].filter((e) => !(e.labels && e.labels.length) && !e.getAttribute("aria-label")).map((e) => e.id));
  const noalt = await page.evaluate(() => [...document.images].filter((i) => !i.hasAttribute("alt")).length);
  const lang = await page.evaluate(() => document.documentElement.lang);
  t("E12", "labels, alt text, lang", !unl.length && noalt === 0 && lang === "en", `${unl} ${noalt} ${lang}`);
  // E13 keyboard: skip link is first tab stop
  await page.keyboard.press("Tab"); t("E13", "skip link is the first tab stop", await page.evaluate(() => document.activeElement.className === "skip"));
  // E14 logo present
  t("E14", "logo loads", await page.evaluate(() => { const i = document.querySelector(".brand img"); return i.complete && i.naturalWidth > 0; }));
} finally { await browser.close(); srv.close(); }
const failed = out.filter((x) => !x.ok); console.log(`\n${out.length - failed.length}/${out.length} passed`); process.exit(failed.length ? 1 : 0);
