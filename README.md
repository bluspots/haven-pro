# Haven Pro — Repo Handoff

This is the Pro-side app of Haven, a two-sided fixed-price home-services marketplace (paired with a separate Customer App, not included here). Prototype/sandbox stage — no real backend, auth, or payment providers connected yet.

**Read `HAVEN_PRO_CURRENT_STATE.md` first.** It's the concise, up-to-date summary of what's built, what's in progress, and what's still open — everything else here is either the source code or supporting reference.

## Files in this bundle

| File | What it is |
|---|---|
| `home_services_pro_app.jsx` | **Canonical source.** The entire Pro App as one React component (single-file by design at this stage — see "Architecture note" below). |
| `build-pro.sh` | Regenerates `prototype-pro.html` from the `.jsx` source. Inlines everything into one self-contained file (no external `<script src>`, since that silently fails under `file://` and on some static hosts). |
| `_shell_pre_pro.txt` / `_shell_post_pro.txt` | The HTML/CSS/CDN-script wrapper that `build-pro.sh` sandwiches the compiled component between. Needed by the build script, not meant to be read standalone. |
| `prototype-pro.html` | The current **built, runnable** artifact — open it directly in a browser, no server or build step needed. Regenerate it any time by running `./build-pro.sh` after editing the `.jsx`. |
| `HAVEN_JOB_CONTRACT.md` | The core data contract: job lifecycle status enum, the fixed-payout pricing model (payout shown pre-accept = payout received, no Haven fee), materials/tips/inspection rules, and a running log of what's shared vs. Pro-App-local vs. still-simulated. |
| `HAVEN_PRO_ACCOUNT_CONTRACT.md` | The account/verification contract: identity/background/payout/tax status vocabularies, the provider-boundary architecture (Haven consumes provider *results*, never self-verifies), the one-active-job-at-a-time rule, and the Job Earnings Statement shape. |
| `HAVEN_PRO_CURRENT_STATE.md` | Living handoff doc — current build status, open decisions, last verified test pass. Update this when the state changes meaningfully; don't let it go stale. |

## Architecture note for whoever sets up the repo

The app is currently one large `.jsx` file (~200KB) rendered via a CDN-script + Babel-in-browser setup (see `_shell_pre_pro.txt`), not a bundler-based project (no `package.json`, no npm build). This was a deliberate prototyping choice — it keeps the whole app runnable by opening a single HTML file, with zero install step, which mattered a lot for fast iteration.

If the GitHub repo is meant to move toward a real bundler setup (Vite/CRA/Next), the natural next step is splitting `home_services_pro_app.jsx` into components/modules — but that hasn't been done yet, and doing it is a real refactor, not a mechanical copy-paste, since the file currently relies on being one shared closure (lots of functions reading/writing the same top-level `useState` hooks directly). Flag this rather than assuming a naive split will work.

The `import React` / `export default` lines in the source are already written bundler-compatible; `build-pro.sh` strips just those two lines to make the file work in the no-bundler CDN setup. That's the one piece of "translation" happening between the source and the runnable HTML.

## Suggested `.gitignore` note

`prototype-pro.html` is a **generated file** (output of `build-pro.sh`). Whether to commit it is a judgment call: committing it means anyone can open the repo and immediately see a working app with no build step; not committing it (with a `.gitignore` entry + a "run `./build-pro.sh`" line in the repo's own README) is more conventional for a generated artifact. Either is reasonable here — worth deciding explicitly rather than defaulting silently.

## Quick start

Open `prototype-pro.html` in a browser (no install). After editing `home_services_pro_app.jsx`, regenerate with:

```bash
./build-pro.sh
```
