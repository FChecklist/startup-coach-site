// The Terms box at checkout: exact wording, server-side enforcement, no internal notes in anything shipped. Run: bun test
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const root = join(import.meta.dir, "..");
import { CONSENT_TEXTS, CONSENT_VERSION, BOXES } from "../functions/api/_consent.js";
const html = readFileSync(join(root, "src/index.html"), "utf8");
const boxText = (h) => h.replace(/<input[^>]*>/, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
describe("the three boxes", () => {
  const labels = [...html.matchAll(/<label class="chk">(.*?)<\/label>/gs)].map((m) => m[1]);
  test("there are exactly three, not pre-ticked, each required", () => {
    expect(labels.length).toBe(3);
    for (const id of ["f-consent-a", "f-consent-b", "f-consent-c"]) { const m = html.match(new RegExp(`<input type="checkbox" id="${id}"[^>]*>`)); expect(m).toBeTruthy(); expect(m[0]).not.toContain("checked"); expect(m[0]).toContain("required"); }
  });
  test("their wording is exactly what the server records (contract / data use / no promise)", () => {
    expect(BOXES).toEqual(["A", "B", "C"]);
    expect(labels.map(boxText)).toEqual(BOXES.map((b) => CONSENT_TEXTS[b]));
  });
  test("the page sends the same version the server requires, with all three boxes", () => {
    const app = readFileSync(join(root, "src/app.js"), "utf8");
    expect(app).toContain(`v: "${CONSENT_VERSION}", boxes: ["A", "B", "C"]`);
  });
  test("the Terms link goes to this site's own Terms page and the Privacy Notice to this site's own notice", () => {
    expect(html).toContain('href="/terms.html"'); expect(html).toContain('href="/privacy.html"');
    expect(html).not.toMatch(/proof-forge\.pages\.dev|\{\{APP\}\}\/privacy/);
  });
});
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (["node_modules", ".git", "dist", "shots", "assets"].includes(n) ? [] : walk(p)) : [p]; });
const BAD = /COUNSEL|\[●\]|legal(ly)?\s+(review|pending|sign-?off)|review\s+pending|pending\s+(legal|review|approval)|awaiting\s+(legal|counsel|lawyer|approval|review)|\blawyer\b|\badvocate\b|owner'?s?\s+(told|instruction|order|directive|decision)|\bTODO\b|\bFIXME\b|under review|not yet (reviewed|approved)|Shobha/i;
describe("nothing internal is shipped", () => {
  test("no internal note or other-entity name in any page, script or legal text", () => {
    const files = [...walk(join(root, "src")), ...walk(join(root, "legal")), ...walk(join(root, "functions"))].filter((f) => /\.(html|js|css|txt|json|xml)$/.test(f));
    const hits = files.filter((f) => BAD.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
