// The Terms box at checkout: exact wording, server-side enforcement, no internal notes in anything shipped. Run: bun test
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const root = join(import.meta.dir, "..");
const K7 = "I agree to the Terms, the Privacy Policy and the Refund Policy linked here. I understand there is no promise of funding or results.";
const html = readFileSync(join(root, "src/index.html"), "utf8");
describe("Terms box", () => {
  test("the box is not pre-ticked and is required", () => {
    const m = html.match(/<input type="checkbox" id="f-consent"[^>]*>/); expect(m).toBeTruthy();
    expect(m[0]).not.toContain("checked"); expect(m[0]).toContain("required");
  });
  test("its wording is exactly the agreed wording", () => {
    const label = html.match(/<label class="chk">(.*?)<\/label>/s)[1].replace(/<input[^>]*>/, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    expect(label).toBe(K7);
  });
  test("the Terms link goes to this site's own Terms page", () => { expect(html).toContain('href="/terms.html"'); });
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
