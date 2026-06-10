# Marketing screenshots

The landing page's `FeatureShowcase` automatically uses real product screenshots
when they exist at the paths below. While a file is missing the page falls back
to the existing stylised mockup, so the page never breaks during a rollout.

## Filename convention

| Filename in this folder | Page on the platform | Suggested capture |
|---|---|---|
| `microseg.png` | `/microsegmentation` or any endpoint's "Microseg" tab | A rule set with traffic-counts + a "Lock down" / "Enforce" button visible. Pick an endpoint with at least 50+ hits across a couple of rules. |
| `defender.png` | `/dashboard` or `/threats` | Threat list with a mix of Severe / High / Moderate rows. Bonus: one "Cleaned" + one "Active". |
| `agent.png` | `/endpoints` | List of endpoints with online / offline / threat badges + agent versions. Aim for ~10 rows with mixed states. |
| `hunting.png` | `/hunting` or threat-hunting page | Run an IOC hunt; capture the live progress + a few matches. |
| `gpo.png` | `/policies` → GPO sub-tab | Password / lockout / audit-category policy view with a couple of "non-default" rows highlighted. |
| `incidents.png` | `/incidents` | Open incident list with SLA timer chips + at least one Assigned analyst chip. |
| `reports.png` | `/customer-reports` or an actual generated PDF first page | The dashboard tile showing "Monthly report ready", or a PDF preview cropped to its hero. |
| `tenant.png` | Tenant switcher dropdown open OR `/admin/resellers` | Operator console with tenant switcher dropdown open (shows the multi-customer story) OR the cross-disty reseller health page. |
| `eol.png` | An endpoint detail page for a legacy Windows box | "Windows 7 SP1" or "Server 2008 R2" badge visible + hardening profile rows showing applied controls. |

## Capture tips

- **Browser at 1600 × 1000** before screenshotting. The mockup card is 16:10 aspect
  ratio — match that and your image fills the card edge-to-edge. Anything wider
  will be cropped horizontally; anything narrower will leave dead space.
- **Dark mode looks more "product"** — the landing page background is a dark
  gradient, dark-mode screenshots blend in better. Light mode also works but the
  card border will show more.
- **Hide your name + email** in the header. Either sign in as a generic demo
  account, or use the browser dev tools to overwrite the displayed user.
- **Use real-looking data, not 1-row demo data.** A screenshot with `0 endpoints,
  no threats` looks like a tutorial. A screenshot with 12 endpoints, 3 threats,
  and an SLA timer about to expire looks like a product.
- **PNG, not JPG.** UI screenshots compress better as PNG and stay crisp.
- **Target ~250-500 KB per image.** Above 800 KB hurts the landing page LCP.
  Run them through tinypng.com or `pngquant --quality=70-90` before committing.

## Adding more sections later

If you want a new feature card on the landing page, append a new entry to
`FEATURES` in `src/components/landing/FeatureShowcase.tsx` with a fresh
`mockupType: "newkey"` and drop `public/screenshots/newkey.png`. The image
fallback wiring picks it up automatically — no other changes needed.

## What about the Hero?

The Hero (`HeroSection.tsx`) doesn't currently have a product screenshot — it's
proof-point chips. If you want a hero screenshot too, add an `<img>` block above
the chips referencing e.g. `/screenshots/hero.png`. Recommend a single
operator-console screenshot taken at 2× density (Retina) for sharpness.
