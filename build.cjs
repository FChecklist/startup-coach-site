// Builds dist/ for Cloudflare Pages: node build.cjs   (needs react, react-dom, react-icons: set NODE_PATH, see README.md; and python for the uniform footer)
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const React = require("react"), RDS = require("react-dom/server"), fa = require("react-icons/fa6");
const SITE = process.env.SITE_URL || "https://rajat-agarwal-startup-coach.pages.dev";
const ITS = "https://itservices-rajat-agarwal.pages.dev"; // the website registered with Razorpay: it runs the payment window and holds the policies
const APP = process.env.APP_URL || "https://proof-forge.pages.dev"; // the Proof Forge app (free Cloudflare Pages)
const CFG = { SITE, ITS, APP, PHONE_DISPLAY: "(+91) 96503 97480" };
const root = __dirname, dist = path.join(root, "dist");
const NAME = "Rajat Agarwal, Startup Coach";
fs.rmSync(dist, { recursive: true, force: true }); fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
let html = fs.readFileSync(path.join(root, "src/index.html"), "utf8");
html = html.replace(/\{\{icon:(\w+)\}\}/g, (_, n) => { if (!fa[n]) throw new Error("missing icon " + n); return RDS.renderToStaticMarkup(React.createElement(fa[n], { "aria-hidden": "true", focusable: "false" })); });
html = html.replace(/\{\{(\w+)\}\}/g, (_, k) => { if (!(k in CFG)) throw new Error("missing config " + k); return CFG[k]; });
fs.writeFileSync(path.join(dist, "index.html"), html);
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
// the head every inner page shares: unique title and description, canonical, social image, installable app
const head = (title, desc, p, robots = "index, follow") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta name="robots" content="${robots}"><meta name="theme-color" content="#0E7C6E"><link rel="canonical" href="${SITE}${p}"><meta property="og:type" content="website"><meta property="og:locale" content="en_IN"><meta property="og:site_name" content="${NAME}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${SITE}${p}"><meta property="og:image" content="${SITE}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${NAME} logo"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${SITE}/og.png"><link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml"><link rel="icon" href="/favicon-32.png?v=2" type="image/png" sizes="32x32"><link rel="icon" href="/icon-192.png?v=2" type="image/png" sizes="192x192"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2"><link rel="manifest" href="/manifest.webmanifest"><link rel="stylesheet" href="/style.css"></head>`;
const nav = `<header class="nav"><div class="wrap nav-in"><a class="brand" href="/" aria-label="Rajat Agarwal, Startup Coach, home"><span class="mark"><img src="/logo-mark.svg" alt="Rajat Agarwal, Startup Coach logo" width="38" height="38"></span><span>Rajat Agarwal<small>Startup Coach</small></span></a><nav aria-label="Main"><a href="/">Home</a><a href="/pricing.html">Pricing</a><a class="btn small" href="/#book">Book your seat</a></nav></div></header>`;
// <footer></footer> is filled with the uniform footer (tools/ufooter.py) at the end of this build
const shell = (title, desc, p, frag, robots) => head(title, desc, p, robots) + `<body><a class="skip" href="#main">Skip to content</a>${nav}<main id="main" class="wrap legaldoc">${frag}</main><footer></footer><script src="/pwa.js" defer></script></body></html>`;
const PAGES = [
  ["terms.html", "Terms and Conditions | " + NAME, "Terms and Conditions of the startup coaching programme and the Proof Forge tool by Rajat Agarwal: price, access, refund-back targets, privacy and law.", "legal/terms.frag.html"],
  ["legal-position.html", "Legal Position Statement | " + NAME, "Who sells the startup coaching programme, what is and is not promised, and the law that applies. Issued by IT Services by Rajat Agarwal.", "legal/legal-position.frag.html"],
  ["privacy.html", "Privacy Notice | " + NAME, "Privacy Notice of the startup coaching programme and its booking form: what we keep, why, where, for how long, who receives it, and your rights.", "legal/privacy.frag.html"],
  ["pricing.html", "Pricing: Rs 19,999 per startup | " + NAME, "Startup coaching by Rajat Agarwal costs Rs 19,999 per startup, with no GST added. Only 10 seats a month. Earn the fee back by hitting your targets.", "legal/pricing.frag.html"],
];
for (const [name, title, desc, file] of PAGES) fs.writeFileSync(path.join(dist, name), shell(title, desc, "/" + name, fs.readFileSync(path.join(root, file), "utf8").replace(/\{\{(\w+)\}\}/g, (_, k) => CFG[k])));
fs.writeFileSync(path.join(dist, "404.html"), shell("Page not found | " + NAME, "That page is not here. Go back to the home page of " + NAME + ".", "/404.html", `<h1>That page is not here</h1><p>Please go back to the <a href="/">home page</a> or see the <a href="/pricing.html">pricing</a>.</p>`, "noindex, follow"));
fs.writeFileSync(path.join(dist, "offline.html"), shell("You are offline | " + NAME, "You are offline. Please check your internet connection and try again.", "/offline.html", `<h1>You are offline</h1><p>Please check your internet connection and try again. Pages you have already opened still open without internet. Booking and payment need internet.</p><p><a class="btn" href="/">Home</a></p>`, "noindex, follow"));
for (const f of ["style.css", "app.js"]) fs.copyFileSync(path.join(root, "src", f), path.join(dist, f));
for (const f of fs.readdirSync(path.join(root, "assets"))) fs.copyFileSync(path.join(root, "assets", f), path.join(dist, "assets", f));
// icons, social image, manifest, service worker (static/, made by games-ops/sitegfx.py)
for (const f of fs.readdirSync(path.join(root, "static"))) fs.copyFileSync(path.join(root, "static", f), path.join(dist, f));
fs.writeFileSync(path.join(dist, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${SITE}/sitemap.xml\n`);
fs.writeFileSync(path.join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE}/</loc></url>${PAGES.map(([n]) => `<url><loc>${SITE}/${n}</loc></url>`).join("")}</urlset>\n`);
// Strict headers: scripts only from this site; the only frame allowed is the registered website's pay frame (Razorpay's window runs there). Inline style is allowed for the shared footer's own scoped styles.
fs.writeFileSync(path.join(dist, "_headers"), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(self "${ITS}")
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-src ${ITS}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/style.css
  Cache-Control: no-cache
/app.js
  Cache-Control: no-cache
/sw.js
  Cache-Control: no-cache
/manifest.webmanifest
  Cache-Control: public, max-age=3600
  Content-Type: application/manifest+json
/*.png
  Cache-Control: public, max-age=86400
/api/*
  Cache-Control: no-store
`);
// the uniform footer (same block on every page of every Corporate Games / IT Services website)
execFileSync("python", ["-I", "-X", "utf8", path.join(root, "tools", "ufooter.py"), "COA", dist], { stdio: "inherit" });
console.log("built dist:", fs.readdirSync(dist).join(", "));
