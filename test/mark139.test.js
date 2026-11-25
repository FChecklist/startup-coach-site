// Guard: the small mark "१३९" sits once at the top centre of every page, with the approved look. Run: bun test
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const root = join(import.meta.dir, "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const MARK = '<div class="mark139" lang="hi" aria-hidden="true"><span>१३९</span></div>';
const CSS = '.mark139{position:absolute;top:0;left:0;right:0;margin:0;padding:1px 0 0;text-align:center;line-height:1;pointer-events:none;user-select:none;z-index:2147483647;font-family:"Noto Sans Devanagari","Mukta","Nirmala UI","Mangal","Kohinoor Devanagari","Devanagari Sangam MN",sans-serif;font-size:6px;font-weight:700;color:#0B2A6B}\n.mark139 span{display:inline-block;border-bottom:.5px solid #7A1010;padding-bottom:.5px}';
const count = (s, t) => s.split(t).length - 1;
const pages = ["src/index.html", ...readdirSync(join(root, "dist")).filter((f) => f.endsWith(".html")).map((f) => "dist/" + f)];
describe("mark 139 on every page", () => {
  for (const p of pages) test(p, () => {
    const s = read(p);
    expect(count(s, 'class="mark139"')).toBe(1);
    expect(count(s, MARK)).toBe(1);
    expect(s.indexOf("<body>" + (s.includes("<body>\n") ? "\n" : "") + MARK)).toBeGreaterThan(-1);
  });
  test("build.cjs shell (used for all inner pages, 404 and offline) has it once", () => {
    const s = read("build.cjs");
    expect(count(s, 'class="mark139"')).toBe(1);
    expect(s).toContain("`<body>" + MARK);
  });
  for (const p of ["src/style.css", "dist/style.css"]) test(p + " has the approved CSS", () => {
    const s = read(p);
    expect(count(s, ".mark139{")).toBe(1);
    expect(s).toContain(CSS);
    for (const t of ["#0B2A6B", "#7A1010", "6px", "700", ".5px", "१३९"]) expect(CSS + MARK).toContain(t);
  });
});
