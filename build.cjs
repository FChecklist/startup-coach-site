// Builds dist/ for Cloudflare Pages: node build.cjs   (needs react, react-dom, react-icons: set NODE_PATH, see README.md)
const fs = require("fs"), path = require("path");
const React = require("react"), RDS = require("react-dom/server"), fa = require("react-icons/fa6");
const SITE = process.env.SITE_URL || "https://rajat-agarwal-startup-coach.pages.dev";
const ITS = "https://itservices-rajat-agarwal.pages.dev"; // the website registered with Razorpay: it runs the payment window and holds the policies
const CFG = { SITE, ITS, PHONE_DISPLAY: "(+91) 96503 97480" };
const root = __dirname, dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true }); fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
let html = fs.readFileSync(path.join(root, "src/index.html"), "utf8");
html = html.replace(/\{\{icon:(\w+)\}\}/g, (_, n) => { if (!fa[n]) throw new Error("missing icon " + n); return RDS.renderToStaticMarkup(React.createElement(fa[n], { "aria-hidden": "true", focusable: "false" })); });
html = html.replace(/\{\{(\w+)\}\}/g, (_, k) => { if (!(k in CFG)) throw new Error("missing config " + k); return CFG[k]; });
fs.writeFileSync(path.join(dist, "index.html"), html);
for (const f of ["style.css", "app.js"]) fs.copyFileSync(path.join(root, "src", f), path.join(dist, f));
for (const f of fs.readdirSync(path.join(root, "assets"))) fs.copyFileSync(path.join(root, "assets", f), path.join(dist, "assets", f));
fs.writeFileSync(path.join(dist, "favicon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0B1F3A"/><text x="32" y="43" text-anchor="middle" font-family="Georgia,serif" font-size="30" font-weight="700" fill="#F5820A">RA</text></svg>`);
fs.writeFileSync(path.join(dist, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${SITE}/sitemap.xml\n`);
fs.writeFileSync(path.join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE}/</loc></url></urlset>\n`);
fs.writeFileSync(path.join(dist, "404.html"), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found</title><link rel="stylesheet" href="/style.css"><main class="wrap" style="padding:80px 0"><h1>Page not found</h1><p><a class="btn" href="/">Back to Rajat Agarwal, Startup Coach</a></p></main>`);
// Strict headers: scripts only from this site; the only frame allowed is the registered website's pay frame (Razorpay's window runs there).
fs.writeFileSync(path.join(dist, "_headers"), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(self "${ITS}")
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src ${ITS}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/style.css
  Cache-Control: no-cache
/app.js
  Cache-Control: no-cache
/api/*
  Cache-Control: no-store
`);
console.log("built dist:", fs.readdirSync(dist).join(", "));
