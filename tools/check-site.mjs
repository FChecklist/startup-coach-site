// Checks a BUILT website folder (no server, no dependencies):  node tools/check-site.mjs <folder> [--its <built IT Services folder>] [--site https://this-site.example]
// Every page: exactly one h1, a unique title and description, a canonical link, viewport, theme colour, manifest and social image (indexable pages),
// every internal link and file reference resolves, the sitemap lists every indexable page and only real ones, robots.txt names the sitemap,
// the manifest and its icons exist, og.png is 1200x630, no very dark background colour in any stylesheet, no internal wording anywhere.
// Exit code 0 = all good, 1 = something to fix (each problem is printed).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep, extname, dirname } from "node:path";

const args = process.argv.slice(2);
const root = args[0];
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
if (!root || !existsSync(root)) { console.error("usage: node check-site.mjs <built folder> [--its <folder>] [--site <origin>]"); process.exit(2); }
const itsRoot = opt("--its");
const ITS_ORIGIN = "https://itservices-rajat-agarwal.pages.dev";
const problems = [], notes = [];
const bad = (page, msg) => problems.push(`${page}: ${msg}`);

const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(root).map((p) => relative(root, p).split(sep).join("/"));
const html = files.filter((f) => f.endsWith(".html"));
const urlOf = (f) => (f === "index.html" ? "/" : f.endsWith("/index.html") ? "/" + f.slice(0, -"index.html".length) : "/" + f);
const exists = (base, url) => {
  let p = decodeURIComponent(url.split("#")[0].split("?")[0]);
  if (!p.startsWith("/")) return null;
  const rel = p.slice(1);
  const hit = (r) => existsSync(join(base, r)) && statSync(join(base, r)).isFile() ? r : null;
  if (rel === "") return hit("index.html");
  if (rel.endsWith("/")) return hit(rel + "index.html");
  return hit(rel) || hit(rel + "/index.html") || hit(rel + ".html");
};
const pageIds = new Map();
const idsOf = (base, rel) => { const k = base + "|" + rel; if (!pageIds.has(k)) pageIds.set(k, new Set([...readFileSync(join(base, rel), "utf8").matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))); return pageIds.get(k); };

const titles = new Map(), descs = new Map(), indexable = [];
const FORBIDDEN = [/forever/i, /permanently/i, /kept for ever/i, /owner'?s decision/i, /CA review/i, /not checked with/i, /legal review/i, /owner told/i, /legal (is )?pending/i, /review pending/i, /awaiting (legal|lawyer)/i, /lawyer (review|sign-?off)/i, /shobha/i, /kamal solutions/i, /\bTODO\b/, /lorem ipsum/i];

for (const f of html) {
  const txt = readFileSync(join(root, f), "utf8");
  const url = urlOf(f);
  const noindex = /<meta[^>]+name="robots"[^>]+noindex/i.test(txt);
  const frame = /payframe/.test(f);
  const h1 = (txt.match(/<h1[\s>]/gi) || []).length;
  if (!frame && h1 !== 1) bad(url, `${h1} h1 elements (need exactly 1)`);
  const title = (txt.match(/<title>([^<]*)<\/title>/i) || [])[1]?.trim();
  if (!title) bad(url, "no title"); else if (!frame) { if (titles.has(title)) bad(url, `title repeats ${titles.get(title)}: "${title}"`); else titles.set(title, url); if (title.length > 75) notes.push(`${url}: title is ${title.length} characters`); }
  const desc = (txt.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i) || [])[1];
  if (!frame) {
    if (!desc) bad(url, "no meta description"); else if (descs.has(desc)) bad(url, `description repeats ${descs.get(desc)}`); else descs.set(desc, url);
    if (!/<link[^>]+rel="canonical"/i.test(txt)) bad(url, "no canonical link");
    if (!/<meta[^>]+name="viewport"/i.test(txt)) bad(url, "no viewport");
    if (!/<meta[^>]+name="theme-color"/i.test(txt)) bad(url, "no theme-color");
    if (!/<html[^>]+lang="/i.test(txt)) bad(url, "no html lang");
    if (!/<link[^>]+rel="manifest"/i.test(txt)) bad(url, "no manifest link");
    if (!/<meta[^>]+property="og:image"/i.test(txt)) bad(url, "no og:image");
    if (!/<link[^>]+rel="apple-touch-icon"/i.test(txt)) bad(url, "no apple-touch-icon");
    if (!/class="uf"/.test(txt) && !/\.uf\{/.test(txt)) bad(url, "no uniform footer");
    if (!noindex && f !== "404.html") indexable.push(url);
  }
  for (const re of FORBIDDEN) if (re.test(txt)) bad(url, `forbidden wording ${re}`);
  // links and files
  for (const m of txt.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const v = m[1];
    if (/^(mailto:|tel:|javascript:|data:|#)/.test(v)) { if (v.startsWith("#") && v.length > 1 && !idsOf(root, f).has(v.slice(1))) bad(url, `anchor ${v} has no target`); continue; }
    if (/^https?:\/\//.test(v)) {
      if (itsRoot && v.startsWith(ITS_ORIGIN)) { const path = v.slice(ITS_ORIGIN.length) || "/"; const r = exists(itsRoot, path); if (!r) bad(url, `link to IT Services page does not exist: ${v}`); else if (path.includes("#") && !idsOf(itsRoot, r).has(path.split("#")[1])) bad(url, `anchor missing on IT Services page: ${v}`); }
      continue;
    }
    if (v.startsWith("//")) continue;
    const abs = v.startsWith("/") ? v : "/" + join(dirname(f), v).split(sep).join("/");
    const r = exists(root, abs);
    if (!r) { bad(url, `broken link or file: ${v}`); continue; }
    const hash = v.split("#")[1];
    if (hash && r.endsWith(".html") && !idsOf(root, r).has(hash)) bad(url, `anchor #${hash} not found on ${urlOf(r)}`);
  }
}

// stylesheets: very dark backgrounds
const lum = (hex) => { let h = hex.replace("#", ""); if (h.length === 3) h = h.split("").map((c) => c + c).join(""); const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const cssFiles = files.filter((f) => f.endsWith(".css")), htmlInline = html;
const scan = (name, css) => {
  const vars = new Map([...css.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\b/g)].map((m) => [m[1], m[2]]));
  for (const m of css.matchAll(/(?:^|[;{\s])background(?:-color)?\s*:\s*([^;}]+)/g)) {
    const val = m[1];
    const cols = [...val.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)].map((x) => x[0]);
    for (const v of val.matchAll(/var\((--[\w-]+)\)/g)) if (vars.has(v[1])) cols.push(vars.get(v[1]));
    for (const c of cols) if (lum(c) < 0.06 && !/gradient/.test(val.slice(0, 3))) bad(name, `very dark background colour ${c} in "${val.trim().slice(0, 60)}"`);
  }
};
for (const f of cssFiles) scan(f, readFileSync(join(root, f), "utf8"));
for (const f of htmlInline) for (const m of readFileSync(join(root, f), "utf8").matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) scan(f + " <style>", m[1]);
for (const f of html) for (const m of readFileSync(join(root, f), "utf8").matchAll(/\bstyle="([^"]*)"/g)) scan(f + " style=", m[1]);

// sitemap and robots
const sm = existsSync(join(root, "sitemap.xml")) ? readFileSync(join(root, "sitemap.xml"), "utf8") : null;
if (!sm) bad("sitemap.xml", "missing"); else {
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const origin = opt("--site") || (locs[0] ? new URL(locs[0]).origin : "");
  const paths = new Set(locs.map((l) => l.replace(origin, "")));
  for (const u of indexable) if (!paths.has(u)) bad("sitemap.xml", `does not list ${u}`);
  for (const p of paths) if (!exists(root, p)) bad("sitemap.xml", `lists a page that does not exist: ${p}`);
  notes.push(`sitemap lists ${paths.size} pages; ${indexable.length} indexable pages found`);
}
const robots = existsSync(join(root, "robots.txt")) ? readFileSync(join(root, "robots.txt"), "utf8") : "";
if (!/Sitemap:\s*https?:\/\//i.test(robots)) bad("robots.txt", "does not name the sitemap");

// manifest and images
const mf = existsSync(join(root, "manifest.webmanifest")) ? JSON.parse(readFileSync(join(root, "manifest.webmanifest"), "utf8")) : null;
if (!mf) bad("manifest.webmanifest", "missing"); else {
  for (const k of ["name", "short_name", "start_url", "display", "theme_color", "background_color"]) if (!mf[k]) bad("manifest.webmanifest", `no ${k}`);
  const sizes = new Set();
  for (const i of mf.icons || []) { if (!exists(root, i.src)) bad("manifest.webmanifest", `icon missing ${i.src}`); sizes.add(i.sizes + (i.purpose === "maskable" ? "m" : "")); }
  for (const need of ["192x192", "512x512", "512x512m"]) if (!sizes.has(need)) bad("manifest.webmanifest", `no ${need} icon`);
  if (lum(mf.background_color) < 0.2) bad("manifest.webmanifest", "dark background_color");
  if (mf.start_url && !exists(root, mf.start_url)) bad("manifest.webmanifest", `start_url does not exist: ${mf.start_url}`);
}
const og = ["og.png", "img/og.png"].find((f) => existsSync(join(root, f)));
if (!og) bad("og.png", "missing"); else { const b = readFileSync(join(root, og)); const w = b.readUInt32BE(16), h = b.readUInt32BE(20); if (w !== 1200 || h !== 630) bad(og, `is ${w}x${h}, need 1200x630`); }
if (!files.includes("sw.js")) bad("sw.js", "missing");
if (!html.some((f) => /offline/.test(f))) bad("offline page", "missing");

for (const n of notes) console.log("note:", n);
if (problems.length) { console.log(`\n${problems.length} PROBLEM(S):`); for (const p of problems) console.log(" -", p); process.exit(1); }
console.log(`OK: ${html.length} pages checked, no problems`);
