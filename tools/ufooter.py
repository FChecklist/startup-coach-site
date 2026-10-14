"""Uniform footer for every Corporate Games / IT Services website (owner order 14 Oct 2026, point 15).

render(site) -> one <footer class="uf"> block (HTML + its own scoped CSS, no other file needed).
apply(path, site) -> replaces the existing <footer>...</footer> of one HTML file, keeps its line endings.
CLI:  python -I -X utf8 ufooter.py <site> <folder> [--dry]      (site = TAM BNG TTT SNL LBC IDX COA ITS DPD)

Rules built in: seller is only IT SERVICES BY RAJAT AGARWAL; nothing internal; short plain words; bright, no dark colours.
"""
import re, sys, os

SELLER = "IT Services by Rajat Agarwal"
ADDR = "B-1105, Shipra Krishna Vista, Indirapuram, Ghaziabad, Uttar Pradesh, 201014, India"
EMAIL = "rajatsiroffice@gmail.com"
PHONE_TXT, PHONE_TEL = "(+91) 96503 97480", "+919650397480"

GAMES = [
    ("Corporate Tambola", "https://corporate-tambola.pages.dev"),
    ("Corporate Bingo", "https://corporate-bingo.pages.dev"),
    ("Corporate Tic Tac Toe", "https://corporate-tic-tac-toe.pages.dev"),
    ("Corporate Snakes and Ladders", "https://corporate-snakes-and-ladders.pages.dev"),
    ("Corporate Luck by Chance", "https://corporate-luck-by-chance.pages.dev"),
]
ITS = "https://itservices-rajat-agarwal.pages.dev"
APP = "https://app.veridian-aios.com"
APEX = "https://veridian-aios.com/"  # the DPDP product's public home; its own site links here, not to the legacy app host
COACH = "https://rajat-agarwal-startup-coach.pages.dev"
IDX = "https://corporate-games.pages.dev"

_game_links = lambda: {
    "Home": "/", "Pricing": "/pricing.html", "Demo": "/demo.html", "Brochure": "/brochure.pdf",
    "Terms": "/terms.html", "Privacy": "/legal.html#privacy", "Refund policy": "/refund-policy.html",
    "Disclaimer": "/legal.html#disclaimer", "Data processing": "/dpa.html",
    "About": "/about.html", "Contact": "/contact.html", "Refer and earn": "/partner.html", "Organizer guide": "/organizer-guide.html",
    "pay": "/paytest.html",
}

SITES = {
    "TAM": dict(name="Corporate Tambola", tag="Live housie for company events.", links=_game_links()),
    "BNG": dict(name="Corporate Bingo", tag="Team bingo for remote and hybrid teams.", links=_game_links()),
    "TTT": dict(name="Corporate Tic Tac Toe", tag="Tournaments for remote and hybrid teams.", links=_game_links()),
    "SNL": dict(name="Corporate Snakes and Ladders", tag="A board game for teams.", links=_game_links()),
    "LBC": dict(name="Corporate Luck by Chance", tag="A dice game for teams.", links={**_game_links(), "Brochure": "/brochure.html", "Privacy": "/privacy.html"}),  # LBC ships brochure.html (pages/build.mjs; there is no brochure.pdf) and has a stand-alone privacy notice, privacy.html
    "IDX": dict(name="Corporate Games", tag="Close group, online engagement.", links={
        "Home": "/", "Pricing": "/pricing.html", "How it works": "/how-it-works.html", "The games": "/games.html",
        "Terms": "/terms.html", "Privacy": "/privacy.html", "Sub-processors": "/subprocessors.html", "Refund policy": "/refund-policy.html",
        "About": "/about.html", "Contact": "/contact.html", "Refer and earn": "/partner.html", "For organizers": "/organizers.html",
        "pay": ITS + "/paytest/?from=IDX"}),
    "COA": dict(name="Rajat Agarwal, Startup Coach", tag="A 12-step startup programme.", links={
        "Home": "/", "Pricing": "/pricing.html", "Terms": "/terms.html", "Legal position": "/legal-position.html",
        "Privacy": "/privacy.html", "Refund policy": ITS + "/policies/startup-coach/", "Shipping and delivery": ITS + "/shipping/",
        "Contact and grievance": ITS + "/contact/", "About": ITS + "/about/",
        "pay": ITS + "/paytest/?from=COA"}),
    "ITS": dict(name=SELLER, tag="Software and IT services.", links={
        "Home": "/", "Pricing": "/pricing/", "Product policies": "/policies/",
        "Terms": "/terms/", "Privacy": "/privacy/", "Refund policy": "/refund/", "Shipping and delivery": "/shipping/",
        "About": "/about/", "Contact": "/contact/", "Grievance": "/contact/#grievance",
        "pay": "/paytest/?from=ITS"}),
    "DPD": dict(name="VERIDIAN", tag="DPDP compliance software for India.", links={
        "Home": "/", "Pricing": "/pricing/", "Refer and earn": "/partner/", "About": "/about/", "Terms": "/terms/", "Privacy": "/privacy/",
        "Sub-processors": "/subprocessors/", "Disclaimer": "/disclaimer/", "Refund policy": "/refund/", "Delivery": "/shipping/", "Contact": "/contact/",
        "pay": ITS + "/paytest/?from=DPD"}),
}

CSS = (
    ".uf{background:#FFF6E5;border-top:5px solid #F5820A;color:#2B3A4A;font:15px/1.55 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:0;clear:both}"
    ".uf *{box-sizing:border-box}"
    ".uf .ufw{max-width:1100px;margin:0 auto;padding:28px 16px 20px}"
    ".uf .ufg{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:22px}"
    ".uf .uft{margin:0 0 8px;font:700 14px/1.3 Inter,system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#C2410C}"
    ".uf p{margin:0 0 8px}"
    ".uf ul{list-style:none;margin:0;padding:0}"
    ".uf li{margin:0}"
    ".uf a{color:#0B6B5E;text-decoration:none;display:inline-block;padding:7px 0;min-height:36px;font-weight:600}"
    ".uf a:hover,.uf a:focus{text-decoration:underline;color:#C2410C}"
    ".uf .ufb{font:700 18px/1.3 Inter,system-ui,sans-serif;color:#1F5FBF;margin:0 0 6px}"
    ".uf .ufpay{margin-top:16px}"
    ".uf .ufpay a{background:#F5820A;color:#1B1B1B;border-radius:999px;padding:9px 16px;font-weight:700;min-height:40px}"
    ".uf .ufpay a:hover{background:#FFB347;text-decoration:none;color:#1B1B1B}"
    ".uf .ufgames{border-top:1px dashed #F5B97A;margin-top:18px;padding-top:12px;display:flex;flex-wrap:wrap;gap:4px 18px;align-items:center}"
    ".uf .ufgames b{color:#C2410C;font-size:13px;letter-spacing:.04em;text-transform:uppercase}"
    ".uf .ufl{border-top:1px dashed #F5B97A;margin-top:14px;padding-top:12px;font-size:13px;color:#43566B}"
    ".uf .ufl p{margin:0 0 4px}"
    "@media(max-width:760px){.uf .ufg{grid-template-columns:1fr 1fr}}"
    "@media(max-width:430px){.uf .ufg{grid-template-columns:1fr}.uf .ufw{padding:22px 14px 16px}}"
)

def _a(label, href):
    return f'<li><a href="{href}">{label}</a></li>'

def render(site):
    s = SITES[site]; L = s["links"]
    here = lambda k: L.get(k)
    def col(title, keys):
        items = "".join(_a(k, L[k]) for k in keys if k in L)
        return f'<div><p class="uft">{title}</p><ul>{items}</ul></div>'
    explore_keys = [k for k in ("Home", "Pricing", "How it works", "The games", "Demo", "Brochure", "For organizers", "Organizer guide", "Refer and earn") if k in L]
    legal_keys = [k for k in ("Terms", "Legal position", "Privacy", "Sub-processors", "Refund policy", "Shipping and delivery", "Delivery", "Disclaimer", "Data processing") if k in L]
    help_keys = [k for k in ("About", "Contact", "Contact and grievance", "Grievance") if k in L]
    brand = (f'<div><p class="ufb">{s["name"]}</p><p>{s["tag"]}</p><p>A product of {SELLER}.</p>'
             f'<p><a href="mailto:{EMAIL}">{EMAIL}</a><br><a href="tel:{PHONE_TEL}">{PHONE_TXT}</a></p></div>')
    pay = f'<div class="ufpay"><p class="uft">Payments</p><p>Safe online payment through Razorpay.</p><a href="{L["pay"]}">Test a payment (Rs 1)</a></div>'
    games = "".join(f'<a href="{u}">{n.replace("Corporate ", "")}</a>' for n, u in GAMES)
    other = (f'<a href="{IDX}">All games</a>' + games + f'<a href="{COACH}">Startup Coach</a><a href="{APEX if site == "DPD" else APP}">Veridian DPDP</a>')
    legal = (f'<p>{SELLER} is the trade name of Rajat Agarwal, an individual running a sole proprietorship in India. {ADDR}. '
             f'GST is not charged. Payments are collected by {SELLER}.</p>'
             f'<p>&copy; 2026 Rajat Agarwal. All rights reserved.</p>')
    return _build(brand, col, explore_keys, legal_keys, help_keys, pay, other, legal)

def _build(brand, col, explore_keys, legal_keys, help_keys, pay, other, legal):
    return ('<footer class="uf" aria-label="Site footer"><style>' + CSS + '</style><div class="ufw"><div class="ufg">'
            + brand + col("Explore", explore_keys) + col("Legal", legal_keys)
            + '<div>' + col("Help", help_keys).replace('<div>', '', 1).rsplit('</div>', 1)[0] + pay + '</div>'
            + '</div><div class="ufgames"><b>More from us</b>' + other + '</div><div class="ufl">' + legal + '</div></div></footer>')

FOOT = re.compile(r"<footer\b[^>]*>.*?</footer>", re.S | re.I)

def apply(path, site, dry=False):
    raw = open(path, "rb").read()
    txt = raw.decode("utf8")
    crlf = "\r\n" in txt
    m = FOOT.search(txt)
    if not m:
        return "no-footer"
    new = render(site)
    if crlf:
        new = new.replace("\n", "\r\n")
    out = txt[:m.start()] + new + txt[m.end():]
    if out == txt:
        return "same"
    if not dry:
        open(path, "wb").write(out.encode("utf8"))
    return "changed"

if __name__ == "__main__":
    site, root = sys.argv[1], sys.argv[2]
    dry = "--dry" in sys.argv
    skip = {"node_modules", ".git", "design", "test-results", "tools"}
    res = {}
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in skip]
        for f in files:
            if f.endswith(".html"):
                p = os.path.join(d, f)
                r = apply(p, site, dry)
                res.setdefault(r, []).append(os.path.relpath(p, root))
    for k, v in res.items():
        print(k, len(v), (v if k == "no-footer" else ""))
