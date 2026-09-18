# HAVEN PRO — ACCOUNT & ELIGIBILITY CONTRACT

**Status:** Living document · **Version:** 0.5 · **Scope:** Pro App only (not yet shared with Customer App)

Companion to `HAVEN_JOB_CONTRACT.md` (job/pricing schema, includes Job Earnings Statement below). Covers Pro account readiness — verification, credentials, payouts, tax — and how it gates job acceptance. Sandbox/prototype only: no real Persona, Checkr, Stripe Connect, or license-registry integration is connected.

---

## 0. Changelog

**v0.5 (this update)** — Aligns the documented onboarding sequence and readiness gate order with the live code in `home_services_pro_app.jsx`. Editorial-only; no code changes:

- Onboarding steps (exact order from code):  
  `["welcome","createAccount","verifyContact","createProfile","chooseCategories","serviceArea","identity","background","payout","tax","credentials","ready"]`
- Verification Center readiness rows (display and gate ordering): Profile → Identity → Background Check → Payouts → Tax Information.
- `acceptJob()` gating order remains: marketplace readiness check first, then online.

**v0.4 (this update)** — True blank-slate app + first-time onboarding + one-active-job-at-a-time. The app no longer boots into a pre-seeded demo; it starts genuinely empty, and the same production-shaped verification screens/logic from v0.2 (not a simplified copy) are sequenced into a real onboarding wizard. Also added the one-active-job-at-a-time rule and optional job notes/before-after photos plus a completion-review step before finalizing a job.

**v0.3** — Two corrections, no architecture changes: (1) `consent_required` is now a real, distinct background-check state with its own screen — locked product decision, not folded into `not_started`. (2) "Stripe Tax" was the wrong name for what handles TIN verification/1099 issuance in the intended model; corrected throughout to "Stripe Connect" / "connected-account tax reporting tooling," since Haven's actual production direction is Stripe Connect's tax-reporting workflows, not Stripe's separate sales-tax/VAT product.

**v0.2** — Corrects the verification model from "Haven decides" to "Haven consumes provider results." Removed Insurance entirely (product decision, not a bug). Removed every timer-based auto-resolution to a positive status — production-facing actions now create a provider session/reference and wait; only a DEV-only control (simulating a provider webhook) can resolve to a terminal state. Added the Job Earnings Statement.

**v0.1** — Initial sandbox model: identity/background/payout/tax as simple status enums, each auto-resolving via `setTimeout` after user action. That auto-resolution was fine for demoing the readiness *gate* but looked exactly like "Haven verifies you" — that's the specific thing this update corrects.

---

## 1. Provider Boundary — Haven Never Self-Verifies

Haven does not verify identity, criminal history, professional licenses, tax identity, or banking by looking at what someone uploaded. It consumes results from specialist providers:

| Concern | Recommended provider | Haven stores |
|---|---|---|
| Identity | Persona (or equivalent) | `identityVerification` — status + provider reference only |
| Background | Checkr (or equivalent FCRA-compliant screener) | `backgroundCheck` — status + provider report reference only |
| Payouts / KYC | Stripe Connect (or equivalent) | `payoutAccount` — status + provider account reference + display-only last4 |
| Tax | Stripe Connect's connected-account tax reporting tooling (or equivalent) | `taxProfile` — status + provider reference only |

No raw ID images, background report contents, bank account/routing numbers, or SSN/EIN are ever stored in app state, sandbox included.

## 2. Status Vocabularies

| Field | States |
|---|---|
| `identityVerification.status` | `not_started` → `session_created` → `pending` → `verified` \| `needs_review` \| `failed` \| `expired` |
| `backgroundCheck.status` | `not_started` → `consent_required`\* → `invited` → `pending` → `clear` \| `consider` \| `disputed` \| `suspended` \| `expired` |
| Credential `status` | `self_reported` → `verification_available`\*\* → `pending` → `verified` \| `unable_to_verify` \| `rejected` \| `expired` |
| `payoutAccount.status` | `not_started` → `pending` → `enabled` \| `restricted` |
| `taxProfile.status` | `not_started` → `pending` → `verified` \| `needs_review` |

\* `consent_required` is a real, distinct state as of v0.3 — not_started means the pro hasn't begun; consent_required means screening is ready to proceed but the pro must review and authorize disclosures first, and the consent UI only ever renders in that state.
\*\* A credential becomes `verification_available` instead of staying `self_reported` once it has both a `number` and `jurisdiction` — enough structured data for an adapter to plausibly check. Credentials without that data can still request verification (routes to manual/issuer review), they just don't get the "ready" label first.

Deliberately **not** "failed" for every non-`clear` background result — `consider` exists because a real report isn't pass/fail; production launch requires legal review of FCRA disclosures, consent language, pre-adverse-action, adverse-action, and dispute-handling procedures before `consider`/`disputed` can resolve to anything. None of that legal workflow is built here.

## 3. No Fake Auto-Verification

Every positive terminal status (`verified`, `clear`, `enabled`) is reached **only** via a DEV-only control that simulates a provider webhook — never a `setTimeout`, never just from the pro submitting a form. Production-facing actions (Submit to Persona, Authorize Background Check, Set Up Payouts, Submit tax info) create a provider session/reference and move to a waiting state (`pending`, `invited`) and stop there. Every status screen has a "⚙ Dev Testing" panel (dashed border, monospace) that is visibly not production UI.

## 4. Professional Credentials

Optional for general enrollment; strengthens trust without inflating Trust Score for merely uploading a document. `verifyProfessionalCredential(id)` is the adapter seam — in production this would call a real per-type/jurisdiction source (e.g. Florida DBPR for FL trade licenses); today it just moves the credential to `pending` and waits for a DEV result. An uploaded credential is never `verified` on upload.

Customer-facing badges (not yet built) should be specific ("Florida HVAC Contractor — Verified"), never one vague "Haven Verified" badge — Haven's own knowledge of what it actually checked shouldn't get flattened for display.

## 5. Job-Specific Legal Eligibility (stub only)

`isEligibleForJob(pro, job)` exists in code, always returns `true`, and is not called anywhere. No jurisdiction/service rules matrix exists — inventing one isn't this slice's job and would need legal review. Today, only work-category/geographic/travel-radius eligibility (unrelated system, already built — see `HAVEN_JOB_CONTRACT.md`) gates what a pro sees on the Job Board.

## 6. Account Readiness

```
marketplaceReady = profileComplete
                 && identityVerification.status === 'verified'
                 && backgroundCheck.status === 'clear'
                 && payoutAccount.status === 'enabled'
                 && taxProfile.status === 'verified'
```

`readinessPercent` = mandatory-flags-true / 5. Credentials are optional and never counted. Insurance no longer participates — it's removed, not just excluded.

`acceptJob()` checks `marketplaceReady` first (toast + route to Verification Center if false), then `online` — independent gates, in that order.

Verification Center readiness rows render and are interpreted in this exact order (matching code):  
1) Profile, 2) Identity, 3) Background Check, 4) Payouts, 5) Tax Information.

## 7. Insurance — Removed

Removed from Profile, Verification Center, Account Readiness, all state models, forms, and sandbox controls. Haven does not require or claim its Pros are insured. Revisit only with a deliberate insurance/protection program backed by legal and insurance advice — not carried forward as a placeholder concept.

## 8. Job Earnings Statement

Canonical per-job financial record, generated once a job reaches a financially final state (`complete` or `inspection_completed`). **Not a tax form** — recordkeeping only, explicitly labeled as such on the statement itself.

```
earningsStatement = {
  id, jobId, proId, createdAt,
  financialSnapshot: { gross, materials, tip, net, status },
  pdfUrl,        // null in this prototype — no real PDF generation
  emailStatus,   // pending | sent | failed
  emailedAt,
}
```

- Generated exactly once per job (`generateEarningsStatement` is a no-op if a statement for that `jobId` already exists).
- `financialSnapshot` mirrors `jobAmount()` exactly — no Haven fee, materials and tips 100% to the pro, matching `HAVEN_JOB_CONTRACT.md`'s locked payout model.
- Email is simulated end-to-end: statement generated → `pending` → `sent`, never a real email client trigger. "Email Again" re-runs the same simulation.
- Production shape: job completion → backend creates the immutable record → server renders a PDF → a transactional email provider sends it → delivery state is recorded back. None of that backend exists; this prototype models the state shape and simulates the three steps.
- Pro-facing UI says "Job Earnings Statement," never "Invoice" (no genuine invoicing workflow exists) and never "1099"/tax form.

**Year-end tax documents are a separate, future concept** — `taxProfile.taxFormAvailability` is an explicitly provider-agnostic placeholder string ("Future 1099/tax-document flow, subject to legal and tax review"); which specific form Haven issues, and through which part of Stripe Connect's tooling, depends on its marketplace/payment structure and needs tax/legal review before that's hardcoded anywhere real.

## 9. First-Time Onboarding & Blank-Slate Mode

The app's true starting state (`accountStatus: "signed_out"`) has no seeded profile, categories, verification, credentials, payout/tax setup, or job history — `availableJobs` (the job market) is the one exception, since it's environmental data a new pro sees exactly like an established one, not pro-specific.

`accountStatus` (`signed_out`|`signed_in`) and `onboardingStatus` (`not_started`|`in_progress`|`completed`) are independent — signed-in-but-mid-onboarding is a real, valid state. `onboardingStep` tracks position through a fixed sequence (`ONBOARDING_STEPS`), exactly as implemented in code:

`["welcome","createAccount","verifyContact","createProfile","chooseCategories","serviceArea","identity","background","payout","tax","credentials","ready"]`

For readability in prose: Welcome → Create Account → Verify Contact → Create Profile → Choose Categories → Service Area → Identity → Background → Payout → Tax → Credentials (optional) → Ready.  
`needsOnboarding = accountStatus === "signed_out" || onboardingStatus !== "completed"` gates whether the app renders the wizard or the normal 5-tab shell.

The four provider steps (Identity/Background/Payout/Tax) reuse the exact same state, actions, and Dev Testing panels as their standalone Profile screens — onboarding is not a simplified preview of verification. Their "Continue" is enabled once the pro has taken the primary action (status `!== "not_started"`), not only once fully verified — a real background check can take days, and onboarding shouldn't block on that. Only Accept Job enforces the full `marketplaceReady` gate.

**Dev-only tools** (Welcome screen and Settings): "Load Demo Pro" restores the full seeded demo; "Reset to Fresh Pro" returns to a true blank slate; "Jump to Marketplace Ready" skips onboarding entirely with all five mandatory items satisfied but zero job history, for testing empty states without re-doing setup each time. All three call `applyProDefaults()`, which resets every profile/verification/history field and always resets `availableJobs` to the full market regardless of mode.

## 10. One Active Job At A Time

Locked marketplace rule: a pro may have at most one job in `activeJobs`. `acceptJob()` checks this before the readiness gate or the online toggle — if a pro somehow has an active job, that's necessarily the actual reason they can't accept another (they were already ready and online to get the first one). Friendly copy only ("Finish your current job to accept another"), never framed as a penalty. Browsing, job details, and every other tab remain fully accessible regardless.

## 11. Job Notes & Photos (Optional)

`jobNotes` (free text) and `beforePhoto`/`afterPhoto` (FileReader data URLs, sandbox/local only) live on the active job during `in_progress` and carry through into the finalized `completedJobsHistory` record and onto the Job Earnings Statement. None are required. "Mark Complete" now opens a Completion Review screen (notes, photos, materials, labor payout — no assumed tip, since tip isn't decided until `finalizeJob` runs) before the actual `Complete Job` action finalizes the job.
