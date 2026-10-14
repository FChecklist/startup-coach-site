// Bot check and rate limit for POST /api/checkout (data audit item 25, 14 Oct 2026). Anyone can reach that address, and every call that passes writes a third person's
// e-mail and mobile number into the ledger and opens a Razorpay order, so it is limited three ways, all kept in the database (checkout_hit):
//   per visitor  (a keyed hash of the address, never the address itself)   per e-mail address   and   all visitors together.
// A real person takes more than a couple of seconds to fill the form: the page sends how long it was open (t, milliseconds) and a faster call is refused.
// With no database the limit is skipped (the booking itself also works without a database).
export const LIMITS = { per_visitor_hour: 6, per_email_hour: 4, all_hour: 150, min_fill_ms: 2500, max_fill_ms: 6 * 3600_000 };
const enc = new TextEncoder();
const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
export const keyed = async (env, prefix, value) => prefix + ":" + hex(await crypto.subtle.digest("SHA-256", enc.encode(`${env.RATE_SALT || "coach-rate"}|${prefix}|${String(value).toLowerCase()}`))).slice(0, 24);

/** true when the page was open for a believable time. */
export const humanTime = (t) => typeof t === "number" && Number.isFinite(t) && t >= LIMITS.min_fill_ms && t <= LIMITS.max_fill_ms;

/** Counts this attempt and says whether it is over a limit. Returns { over: boolean, which? }. Never throws. */
export async function overLimit(env, request, email, now = Date.now()) {
  const db = env.DB; if (!db) return { over: false };
  try {
    const hour = Math.floor(now / 3600_000);
    const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
    const num = (v, d) => (Number(v) > 0 ? Number(v) : d); // the limits can be tuned with the secrets RATE_PER_VISITOR, RATE_PER_EMAIL, RATE_ALL (tests raise them)
    const keys = [["visitor", await keyed(env, "v", ip), num(env.RATE_PER_VISITOR, LIMITS.per_visitor_hour)], ["e-mail", await keyed(env, "e", email), num(env.RATE_PER_EMAIL, LIMITS.per_email_hour)], ["all", "all", num(env.RATE_ALL, LIMITS.all_hour)]];
    let worst = null;
    for (const [which, who, max] of keys) {
      await db.prepare("INSERT INTO checkout_hit(who,hour,n) VALUES(?,?,1) ON CONFLICT(who,hour) DO UPDATE SET n=n+1").bind(who, hour).run();
      const n = (await db.prepare("SELECT n FROM checkout_hit WHERE who=? AND hour=?").bind(who, hour).first())?.n ?? 0;
      if (n > max && !worst) worst = which;
    }
    return worst ? { over: true, which: worst } : { over: false };
  } catch { return { over: false }; }
}
