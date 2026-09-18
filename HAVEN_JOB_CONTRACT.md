# HAVEN — SHARED JOB DATA CONTRACT

**Status:** Living document · **Version:** 0.9 · **Scope:** Customer App ↔ Pro App ↔ (future) Backend

**Purpose.** This is the one document both the Customer App chat and the Pro App chat should be given before either one writes or changes anything touching job data or job status. It exists so the two prototypes stop drifting from each other silently. It is deliberately narrow — a data contract, not a full spec — so it's cheap to paste into a fresh conversation as authoritative context.

This document distinguishes three things at all times:
1. **Target shape** — what a job object should look like once both apps and a real backend exist.
2. **Customer App today** — what's actually implemented in `home_services_app.jsx` right now, verified against source, not memory.
3. **Pro App today** — what's actually implemented in `home_services_pro_app.jsx` right now, verified against source.

Nothing below is aspirational-passed-off-as-real. Where the two apps already disagree, that's stated plainly rather than smoothed over.

---

## 0. Changelog

**v0.9 (this update) — locked economics (Pro copy) and materials-decline wording; docs-only.**

- Locked economics (Pro copy):  
  - Service price = labor.  
  - Materials are additive to labor — never carved out of the service/labor price.  
  - Haven takes $0 on materials, $0 on tips, and $0 on Inspection Visits.  
  - Pro receives: labor payout + 100% of materials + 100% of tips + any applicable diagnosis/service fee.  
  - Customer App code that carves materials out of the labor/service price is NOT canonical for economics. Do not change Customer or Pro code as part of this update — this note documents the product decision only.
- Standard (non‑diagnosis) materials‑decline outcome — approved in principle as a product decision: label it “Job Ended — Materials Declined” (distinct from the diagnosis path). A flat visit fee for that outcome is FOUNDER‑TBD. Existing diagnosis fees and the `inspection_completed` path remain as-is. Implementation is DEFERRED and not part of this PR; no enum/code changes.
- Labor economics — founder‑locked for now: the Pro keeps 100% of the labor price and Haven takes $0 from labor. The founder may revisit labor later; this PR records today’s locked posture without changing code.

**v0.8 (this update) — corrects a real modeling error from v0.2, not an additive change.** Two coordinated fixes:

1. **Platform fee removed from the Pro App entirely.** v0.2 introduced a simulated 15% fee deducted from the pro's payout on `status === 'complete'`. That was wrong: the locked principle is that **the payout shown before accepting is the exact amount the pro receives** — Haven's economics belong in the customer-side labor price, which this prototype doesn't model, not in a deduction from the pro's number. `jobAmount()` no longer computes or returns a `platformFee` at all; `net` is now simply `gross + materials + tip`, always. Every "Haven Platform Fee" line in the Earnings ledger, the Invoice screen, the Job Complete screen, the Help & Support FAQ, and the Support Chat's canned reply has been removed or reworded. This is not "fee is $0" — the concept isn't modeled in the Pro App at all anymore.
2. **`inspection_only_complete` renamed to `inspection_completed`** throughout the codebase and this document (applied retroactively to historical changelog entries too, since it's the same status being relabeled, not a behavior change worth preserving under its old name). "Inspection Only" as user-facing copy is replaced with "Inspection Completed" everywhere a pro sees it. "Inspection Visit" is unchanged — it names the compensation amount, a distinct concept from the job's terminal status.

Practical effect: a pro who sees `$180` on a job card now receives exactly `$180` on completion, full stop. A materials decline now ends the job as `inspection_completed`, paying the full `inspectionFee` with nothing subtracted — this was already true in the code before this update (the fee only ever applied to `status === 'complete'`), so behavior didn't change there, only the status's name and the fact that it's now consistent with a fee model that doesn't exist anywhere else either.

Also: "Done" → "See Earnings" on the Job Complete screen, per explicit request — purely a label change, `goTab("earnings")` behavior from v0.7 is unchanged.

**v0.7** — Added a `customerName` field to every job, and built real (if simulated) two-way messaging on top of it: a per-job chat thread reachable both from the Messages tab (now a real conversation list instead of an empty placeholder) and from a "Message {name}" button on the Active Job Detail screen. Also added a UI/UX layer with no schema implications: the Earnings chart is now swipeable across Week/Month/Year granularity, a Job Board "Collapse All" toggle, an in-app Support Chat, and a button-padding fix — none of those touch job data.

Changes:
- **New field: `customerName`** — a plausible display name on every `SIM_JOBS` entry (not tied to any real customer identity system; there isn't one in this prototype). Customer App has no equivalent field surfaced yet — its own `PROS`-style customer-facing data doesn't have a mirrored "job's customer" record either, so this is a Pro-App-only addition for now, not a synced value.
- **Per-job chat is Pro-App-local, ephemeral state** (`jobMessages`, keyed by job id) — not part of the job object itself, not persisted into `completedJobsHistory` when a job finalizes (a thread's messages are lost once the job completes, the same way `activeJobs`' other transient fields are). This wasn't asked to persist and doesn't pretend to.
- **Auto-replies are canned and randomized**, not from any real customer — same simulation posture as the materials auto-resolve and the new Support Chat, and for the same reason: there's no live counterpart to talk to in this session.
- **Support Chat is a separate, unrelated thread** (`supportMessages`) — reachable from Help & Support, not tied to any job. Its keyword-matched replies are hand-written canned responses covering three topics already established elsewhere in this contract (platform fee, materials reimbursement, work categories) — chosen deliberately so a pro asking about them gets an answer consistent with what the app itself already says, not a improvised one.

---
**v0.6** — Real coordinates and real browser geolocation, replacing the "simulate distance with a string-matched city + a made-up `distanceMi`" approach for two specific interactions: turn-by-turn navigation and arrival confirmation.

Changes:
- **`coordinates` field partially resolved**: every `SIM_JOBS` entry now carries `lat`/`lng` (plausible Orlando/Winter Park/Brooklyn coordinates, not geocoded from anything real). `distanceMi` is unchanged and still independently simulated — the two aren't reconciled (a job's `lat`/`lng` and its `distanceMi` aren't guaranteed to actually agree in real-world terms). That reconciliation is real backend work, not done here.
- **Real browser geolocation, used for two things only**: (1) building a genuine Google Maps turn-by-turn directions link (`/maps/dir/?api=1&origin=...&destination=...`, no API key required) once the pro grants location permission, and (2) gating the "I've Arrived" button on actually being within ~0.15 mi of the job's coordinates (Haversine distance), rather than the pro's own say-so. Falls back gracefully to the pre-v0.6 behavior (destination-only map link, arrival button always available) when permission is denied or unsupported — this was verified explicitly, not assumed, since a hard requirement on location access would break the app for anyone who declines the prompt.
- **This is Pro-App-local geolocation usage**, not a new shared job field in the sense of §6 — `proLiveLocation` is ephemeral browser state, never persisted, never sent anywhere (there's nowhere to send it in this prototype). Only the job's static `lat`/`lng` seed values are part of the job object itself.
- **Does not address** the existing `addressSnapshot` privacy-precision gap already logged in §3 — `city`-level `lat`/`lng` is coarse (job-board-safe), not the full post-acceptance address a real implementation would eventually want for actual navigation precision.

**v0.5** — UI/UX layer around the existing lifecycle, not a status-vocabulary change: accepting a job now jumps the whole screen straight to that job's detail view (no manual tab switch required); `en_route` shows a simulated map with a real, working "Open in Maps" link (city-level query, since there's no full-address field yet); `in_progress` shows a live, second-by-second timer; completing a job now shows a dedicated breakdown screen before returning to the list.

Changes:
- **New field: `actualDurationMin`** — computed by `finalizeJob` as the real elapsed time between `workStartedAt` and the moment a job is finalized (`Date.now() - workStartedAt`, in minutes), for any terminal status where work had actually started (`null` if it never did — e.g., a job declined at `materials_requested` before `in_progress` was ever reached). This is genuinely live-measured, not simulated, and is the first field in this contract that's true "actuals" data rather than an estimate or a placeholder. Displayed on both the Invoice screen and the new post-completion breakdown as "on the job X min (est. ~Y min)" against the existing `durationMin` estimate.
- **No new status, no change to transition ownership** — this update is additive UI around already-existing `workStartedAt`/`in_progress` machinery, not a schema change to §2's enum or §5's ownership table.
- **Full address still not modeled.** The "Open in Maps" link uses `city` (the only location field a job carries) — a real implementation would want the `addressSnapshot` field already described as target-shape-only in §3, populated post-acceptance per that row's existing privacy note (coarse pre-acceptance, full after).

**v0.4** — Corrected the materials-request flow: approval no longer immediately credits the pro's *estimated* cost. Approval only authorizes the purchase; the pro must then actually buy the materials and submit a receipt-verified **actual** cost — which can differ from the estimate — before anything is reimbursed. This adds a new canonical status, `materials_approved`, sitting between `materials_requested` and `in_progress`.

Changes:
- **New status: `materials_approved`** — "customer approved the request; pro is authorized to purchase but hasn't submitted a receipt yet." Added to the canonical enum in §2. Transition `materials_requested → materials_approved` is customer-triggered (same simulated approval as before); `materials_approved → in_progress` is **pro-triggered**, gated on submitting a receipt (see below) — this is a new row in §5.
- **`materialsReimbursed` now credited at receipt submission, not at approval.** The pro enters the actual amount paid (pre-filled with the original estimate, editable) and must attach a photo of the receipt — enforced as a hard requirement in the UI, not just a recommendation. This is the first place the architecture's original "photo is mandatory, not optional" rule is actually enforced in code, and it's enforced at the right step (proof of an actual purchase), not at the initial request (which only ever described what was needed, not proof it was bought).
- **New field: `materialsReceiptPhoto`** — a data-URL photo of the receipt, carried on the active job while pending and forwarded into the `completedJobsHistory` record by `finalizeJob` once the job completes. Displayed as a thumbnail on the Invoice screen, with a "receipt on file" note next to the materials line.
- **No change to the underlying economics** — reimbursement is still 100% to the pro, still $0 platform fee, still only ever paid on an approved request. What changed is *when* the number is locked in (receipt-verified actual cost, not pro-estimated cost) and that there's now photographic proof behind it, matching what a real backend would need to prevent overstated reimbursement claims.
- **Does not resolve** open question §7.2 (no fallback fee for standard-category materials decline) — that's unrelated to this change and remains a live gap.

**v0.3** — The Pro App's full accept→completion lifecycle is now **live, stateful code** — the first time §2's status transitions are actually written by real state transitions rather than existing only in a design doc or a static historical dataset. `SIM_JOBS` now has a real setter (`setAvailableJobs`); a new `activeJobs` state array holds jobs mid-lifecycle; completing a job appends a real record to `completedJobsHistory` (the same state Earnings reads — completed jobs now genuinely show up there, and Profile's "Completed" count reads the same array, so the two can no longer drift apart the way the historical placeholder briefly did).

Changes:
- **Live-coded transitions**: `en_route` (Accept), `arrived`, `diagnosing` (diagnosis-required categories), `materials_requested`, `in_progress`, `complete`, and `inspection_completed` are all now written by real pro actions in the UI, not simulated history. `AVAILABLE`/`ACCEPTED` remain correctly absent — accepting a job writes `en_route` directly, per §2's explicit rejection of a separate accepted-but-not-driving status.
- **`materials_requested` open question resolved**: per product decision, this is available on **any job**, not scoped to `requiresDiagnosis` categories only. A standard-category job mid-`in_progress` can now request materials the same way a diagnosis job can during `diagnosing`.
- **Customer-side approval is simulated, explicitly labeled as such**: since there's no live Customer App connection in this session, `materials_requested → in_progress` (approve) or `→ inspection_completed` (decline) auto-resolves after a real ~4.5s delay, weighted 70% approve / 30% decline. Every resulting toast says "(simulated)" — this is standing in for a customer decision the Pro App has no authority to make itself, not a shortcut being passed off as real.
- **Known real bug found and fixed during this work**: the first implementation tried to read a value back out of a `setState` updater synchronously, immediately after calling it, for use in the same function. That doesn't reliably work in this React version — the updater isn't guaranteed to have run yet at that point — and it silently broke job completion (no toast, no Earnings record, despite the UI otherwise looking correct). Fixed by reading current state directly for synchronous handlers, and via a ref mirroring the latest state for the genuinely-delayed materials-resolution timer. Noted here because it's exactly the kind of silent-drift bug this document exists to catch before it reaches the Customer App side too.
- **Open question #2 (§7) is still NOT resolved** — see below. Standard (non-diagnosis) jobs that get materials declined mid-`in_progress` still pay the pro $0. That gap was known before this update and remains known; it was not silently fixed by extending the Inspection Visit pattern to standard jobs, since doing so would mean changing already-approved Job Board card UI (adding a guaranteed-floor line to every standard job) without being asked to. This is a live, real economic gap in the shipped prototype now, not just a documented risk in a still-unbuilt feature.

**v0.2** — Pro App's Earnings tab was built. This is the first Pro App code to actually populate several fields previously listed as "not present." Because there is still no real accept→complete lifecycle in the Pro App, these fields are populated by a **simulated historical completed-jobs dataset** (`SIM_COMPLETED_JOBS`), not by live state transitions. That distinction is preserved throughout this update — "Pro App today" now says ✅ for these fields, with a note that it's simulated-history-only, not lifecycle-driven, so this document doesn't quietly overstate what's real.

Changes:
- `status`: Pro App now uses the canonical §2 enum values `complete` / `inspection_completed` — but only within the static historical dataset, not written by any live transition.
- `tipAmount`, `tipStatus`: now present in Pro App's simulated data, read directly by the Earnings ledger, 100% credited to the pro — consistent with the Customer App's existing tip-economics rule, not relitigated.
- `requiresDiagnosis`: promoted from an implicit `DIAGNOSIS_CATEGORIES` lookup to a real field on the (simulated) job object, per the recommendation already logged in v0.1's §3.
- `completedAt`: now present in Pro App's simulated data.
- `materialsReimbursed` (**new, simplified**): a flat number representing pass-through materials cost credited to the pro on a completed job. This is **not** the full `materialsRequest` object shape (`{items[], totalCost, photoUrl, requestedAt, status}`) — that workflow remains unbuilt. This is a deliberate simplification scoped to populating historical ledger entries only; do not treat it as the real `materialsRequest` field being implemented.
- `platformFee` (**newly defined — first real decision on this number**): Pro App now simulates a **flat 15% platform fee, applied only when `status === 'complete'`**. This is modeled on TaskRabbit's 15% service-fee structure — the closest structural analog to Haven's fixed-price format — and deliberately *not* modeled on Uber/Lyft's rideshare take rate, which is algorithmic/opaque and reported by industry sources to average 35-40%+ in practice. Per the already-locked Platform Principles, Haven earns $0 from inspection-only completions, materials, or tips — `platformFee` is hard-coded to 0 in every case outside `status === 'complete'`, verified in code, not just documented. **This is still a placeholder for the prototype.** The Customer App has no corresponding UI or field for this at all yet. A real backend must set the authoritative number, which may reasonably vary by category or market — flat 15% is a prototype simplification, not a pricing decision to carry forward uncritically.

---

## 1. Current Implementation Reality (read this first)

**Customer App** has a working job lifecycle: post → accept (simulated via Demo Pro Controls) → en route → arrived → in progress → complete, plus cancellation, tipping, ratings, receipts, and job preferences. No diagnosis, no materials-request flow, no inspection-only outcome — none of that exists in the Customer App yet, despite being fully designed in the Pro App architecture doc (v2, §8–10).

**Pro App** now has a **live, stateful job lifecycle** as of v0.3, refined in v0.4. `availableJobs` (renamed from `SIM_JOBS`/`jobs`, which had no setter) is a real state array; accepting a job moves it into a new `activeJobs` state array with status `en_route`, and it progresses through `arrived` → (`diagnosing` → `materials_requested` → `materials_approved` →) `in_progress` → `complete`/`inspection_completed` via real UI actions, exactly matching this document's §2 enum and §5 ownership rules. Completing a job appends a real record to `completedJobsHistory` (seeded from the historical dataset described below, now genuinely appended to). What's built: the job feed (Job Board, grouped by category), eligibility/geographic filtering, category filters, Profile (editable, with a real photo upload), Settings, dark mode, the Earnings dashboard (now reflecting real completions, not just seed history), My Jobs (the active-job list and detail screens), and the full lifecycle described above, including the two-step materials request → approval → receipt-verified reimbursement flow.

Why this still matters: the *seed* data in `completedJobsHistory` (the seven-or-so historical entries from before this update) remains illustrative history, not something that ever went through the real lifecycle — but anything a pro completes *from now on*, in this session, is real state, genuinely traceable through Accept → Complete. The historical seed and live completions now sit side by side in the same array with no way to tell them apart by inspection; if that distinction ever matters (e.g., for a "demo data" reset), it isn't tracked today.

---

## 2. Status Vocabulary — the decision this document makes

The Customer App already ships with a working, tested status enum:

```
posted → en_route → arrived → in_progress → complete
                                            ↘ cancelled (from any pre-complete state)
```
(lowercase snake_case; source: `home_services_app.jsx`, `SF` array and `VALID_JOB_STATUSES`)

The Pro App's architecture doc independently proposed:

```
AVAILABLE → ACCEPTED → DRIVING → ARRIVED → DIAGNOSING → WORKING → COMPLETED
                                          ↘ MATERIALS_REQUESTED → WORKING | INSPECTION_ONLY_COMPLETE
```
(SCREAMING_SNAKE_CASE; source: `haven-pro-app-architecture-v2.md` §8 — not yet coded as live lifecycle)

**Decision:** adopt the Customer App's existing lowercase convention and extend it, rather than the reverse. Rationale: the Customer App's enum is already shipped, tested (110 passing assertions reference these exact strings), and persisted in real user data structures. The Pro App's enum exists only in a design doc — zero migration cost to change it before the first line of live lifecycle code is written. Changing the Customer App's enum would mean touching shipped, working code and every test that references it for no functional gain.

### Canonical status enum (target, extending Customer App's existing set)

| Status | Meaning | Introduced by |
|---|---|---|
| `posted` | Job created, waiting for a pro to accept | Customer App (existing) |
| `en_route` | Pro accepted, traveling to the property | Customer App (existing) |
| `arrived` | Pro is at the property | Customer App (existing) |
| `diagnosing` | *(any category with `requiresDiagnosis`)* Pro is assessing scope | **Pro App v0.3: live-coded** — written when a pro taps "Start Diagnosis" after arriving |
| `materials_requested` | Pro found the job needs more than expected; awaiting customer approve/decline | **Pro App v0.3: live-coded, on any job** (not scoped to diagnosis categories — see §7 resolution). Customer response is simulated: ~4.5s delay, 70/30 weighted toward approval |
| `materials_approved` | Customer approved the request — pro is authorized to purchase, but hasn't submitted a receipt yet | New in v0.4. **Live-coded.** Distinct from `materials_requested`: approval doesn't credit anything yet, it only authorizes the purchase. Ends when the pro submits a receipt-verified actual cost, which transitions to `in_progress` |
| `in_progress` | Actively doing the work | Customer App (existing) — reused as-is for the post-diagnosis "Working" state; do not introduce a separate `working` status. **Pro App v0.3: live-coded** |
| `complete` | Job finished, full repair, standard payout/pricing applies | Customer App (existing). **Pro App v0.3: live-coded** — written when a pro taps "Mark Complete"; appends a real record to `completedJobsHistory` |
| `inspection_completed` | Diagnosis performed, customer declined materials, job ends at the inspection fee | New. **Pro App v0.3: live-coded** — written by the simulated auto-decline outcome
| `cancelled` | Job cancelled before or during the above (see §5 for cancellation sub-states) | Customer App (existing) |

**Explicitly rejected:** `AVAILABLE` and `ACCEPTED` as separate statuses. In the Customer App's actual model, "posted" *is* "waiting to be accepted" — there is no gap between posting and a pro seeing it in their feed, and the job never has a state that means "accepted but not yet en route." If the Pro App needs to distinguish "I've accepted, haven't started driving yet" as a UI moment, that's a Pro-App-local UI state, not a shared job status — see §6.

Terminology note (DEFERRED implementation): For standard (non‑diagnosis) jobs where materials are declined mid‑`in_progress`, the approved product label is “Job Ended — Materials Declined” with a flat visit fee (FOUNDER‑TBD). Current code ends standard jobs with $0 in this path; diagnosis jobs continue to use `inspection_completed`. Do not introduce a new canonical enum in this PR; alignment across apps is DEFERRED.

---

## 3. Canonical Job Object — target shape

Field names below use the Customer App's existing naming where a field already exists there.

| Field | Type | Customer App today | Pro App today | Notes |
|---|---|---|---|---|
| `id` | string/number | ✅ `id` (`Date.now()`) | ✅ `id` (string like `"j1"` / `"c1"`) | **Mismatch today.** Customer uses a timestamp number; Pro uses a short string. Neither is collision-safe or cross-referenceable. A real backend must issue one canonical ID scheme. |
| `schemaVersion` | number | ❌ not present | ❌ not present | Recommended addition, either side, next time either touches job persistence. |
| `status` | string enum | ✅ `status` (see §2) | ✅ **live as of v0.3** — written by real transitions in `activeJobs` (`en_route` through `complete`/`inspection_completed`); the seed entries in `completedJobsHistory` still use static values from before v0.3 | §2 enum verbatim adopted throughout. |
| `category` | string | ⚠️ implicit via `taskId`/`TASKS` lookup, not a bare field | ✅ `category` (bare string, e.g. `"Plumbing"`) | Shared job object should carry `category` as a bare string on both sides. |
| `title` | string | ✅ via `custom.title` (custom jobs only) or catalog task name | ✅ `title` | |
| `propertyId` / `propertyLabel` | string | ⚠️ `addressLabel` (e.g. `"Home"`), no stable `propertyId` | ❌ n/a | Gap, not urgent. |
| `addressSnapshot` | string | ✅ `addressText` | ✅ `city` (much coarser — city/state only, not a full address) | Real privacy/precision mismatch — coarse `cityLabel` pre-acceptance, full `addressSnapshot` only after. |
| `coordinates` | {lat, lng} | ❌ not present | ⚠️ **present on `SIM_JOBS`, v0.6** — simulated `lat`/`lng`, not reconciled with the independently-simulated `distanceMi` on the same job | Real backend requirement remains: these two numbers should agree once real geocoding exists, and don't today. |
| `fixedCustomerLaborPrice` | number | ✅ resolved via `vjTask.p` / `custom.price` | ⚠️ `payout` (this is the **pro's** payout, not the customer's price) | **These are not the same number and must not become the same field.** |
| `fixedProLaborPayout` | number | ❌ not modeled | ✅ `payout` | `fixedCustomerLaborPrice - fixedProLaborPayout = platformFee`, once both exist on the same job record. |
| `platformFee` | number | ❌ not present | ❌ **removed in v0.8** — modeled in v0.2/v0.3, corrected as a mistake: the pro's payout is never reduced by a fee in this app. Haven's economics, if modeled at all, belong in the customer-side labor price (not built in this prototype) | See §0 v0.8 changelog. This row previously said "present" — that was the error being corrected, not a target shape still worth building toward on the Pro side. |
| `emergencyFee` / `emergency` | number / bool | ✅ `emergencyFee`, `emergency` | ✅ `emergency` (bool only, no fee field) | Pro App shows emergency as a badge; no fee amount field yet. |
| `inspectionFee` | number | ❌ not present (Customer App has no Inspection Visit concept yet) | ✅ `inspectionFee` | Customer App needs corresponding work before a real diagnosis-required job could be posted and completed end-to-end. |
| `requiresDiagnosis` | bool | ❌ not present | ✅ **real field as of v0.2** (previously an implicit `DIAGNOSIS_CATEGORIES` lookup; now set directly on each `SIM_COMPLETED_JOBS` entry, still a static lookup for the live `SIM_JOBS` feed) | Full promotion to a real field across both datasets is still pending; done for the historical dataset only so far. |
| `expectedDurationMin` / `expectedDurationMax` | number | ✅ range with confidence, via `getExpectedDuration()` | ⚠️ `durationMin` only (single value, not a range) | Recommend Pro App adopt the range shape when it next touches this. |
| `actualDurationMin` | number | ❌ not present | ✅ **new in v0.5, live-measured** — `Date.now() - workStartedAt` at finalization, in minutes; `null` if work never started before the job ended | First genuinely "actuals" field in this contract — not an estimate, not simulated. Customer App has no equivalent yet. |
| `scheduledStart` / `scheduledWindow` | timestamp/string | ⚠️ `TIME_PREFS`/`tpId` (a preference category, e.g. "ASAP") | ✅ `requested` (a display string like `"Today, 3:00 PM"`) | Neither side has a real machine-usable timestamp for this yet. |
| status timestamps (`acceptedAt`, `completedAt`, etc.) | timestamp | ✅ `acceptedAt`, `completedAt`, `cancellationRequestedAt`, `tippedAt` | ⚠️ **partially live, v0.3, and partially dropped on completion** — `acceptedAt`, `arrivedAt`, `diagnosingAt`, `materialsRequestedAt`, `workStartedAt` are all real fields written on `activeJobs` while a job is mid-lifecycle. But `finalizeJob` does **not** carry any of them into the `completedJobsHistory` record — only `completedAt` survives. So a completed job's full timeline is real and inspectable while it's active, then lossy the moment it's marked complete. Worth fixing before this data is trusted for anything beyond the current session. | Real timestamps exist now, but the record shape that persists them long-term is incomplete — this is a genuine gap, not just a documentation note. |
| `customerPreferencesSnapshot` | string[] | ✅ `jobPreferences` | ❌ not present | Data already exists on the Customer side, waiting for the Pro App's Job Detail to read it. |
| `paymentSnapshot` | {brand, last4} | ✅ `paymentBrand`, `paymentLast4` | ❌ not present | Low priority. |
| `materialsRequest` | object | ❌ not present | ⚠️ **partially present, v0.3/v0.4** — `pendingMaterialsRequest: {items, totalCost}` lives on the active job while a request is pending or approved-but-not-receipted. Not the full target shape: no `photoUrl` on the request itself (the photo is captured separately, at receipt time — see `materialsReceiptPhoto`), and it's cleared (not archived) once resolved | Still not the literal target shape, but the live/simulated distinction from earlier versions no longer applies to the request-and-approval half of this — only the full object shape remains aspirational. |
| `materialsReimbursed` | number | ❌ not present | ✅ **live as of v0.4** — credited only when the pro submits a receipt-verified actual cost at `materials_approved → in_progress`, not at the moment of approval. Can differ from the original estimate in `pendingMaterialsRequest.totalCost`. Still 100% pass-through, still $0 platform fee | This is the corrected version of what v0.2/v0.3 modeled as instant-on-approval crediting — that was wrong per this update; approval only authorizes a purchase, it doesn't reimburse an estimate. |
| `materialsReceiptPhoto` | string (data URL) | ❌ not present | ✅ **new in v0.4, live** — a required photo attached at receipt-submission time, carried on the active job and forwarded into the `completedJobsHistory` record on completion. Displayed as a thumbnail on the Invoice screen | This is the first place the architecture's "photo is mandatory" rule for materials is actually enforced in code — at the receipt step, not the request step, since that's what it's actually proof of. |
| `inspectionOutcome` | string enum | ❌ not present | ❌ not present — status itself (`complete` vs `inspection_completed`) currently carries this meaning | Consider whether a separate `inspectionOutcome` field (`full_repair`\|`inspection_only`) is still needed once `status` already distinguishes these, or whether that was redundant to begin with. |
| `cancellationState` | object | ✅ `cancelStatus` (`null`\|`"requested"`), `cancellationRequestedAt` | ❌ not present | Pro App has no cancellation flow modeled yet. |
| `customerRating` / `customerReview` | number/string | ✅ `stars`, `reviewTxt`, `rated`, `hireAgain` | ❌ not present (Pro App's own Trust Score is a separate, pre-computed simulated number on the pro profile, not derived from real per-job ratings yet) | Real backend requirement, not urgent for prototype stage. |
| `customerName` | string | ⚠️ implicit — Customer App's own `PROS`-style records are pro-facing, not a "who is this job's customer" field on the job itself | ✅ **new in v0.7** — a plausible display name on every `SIM_JOBS` entry, used for the Messages tab and per-job chat | Not tied to any real identity system on either side. Neither app currently models "this job belongs to this specific customer record" as a real relational field. |
| `tipAmount` / `tipStatus` / `tippedAt` | number/string/timestamp | ✅ all three, fully implemented (`notAdded`\|`processing`\|`paid`\|`failed`) | ⚠️ **`tipAmount`, `tipStatus` live as of v0.3** — every real completion via `finalizeJob` randomly simulates a tip (weighted, since there's no real customer to tip), 100% credited to the pro per the Customer App's existing tip-economics rule. `tippedAt` still not modeled separately (uses `completedAt`). | |

---

## 4. The "Pro" object — also currently two different shapes

Worth naming explicitly, since it's the other half of a job record:

- **Customer App's `PROS`** entries are a simulated, customer-facing view of a pro: `{i (2-letter id), n (name), r (rating), j (job count), s (specialty), col (avatar color), trustScore, onTimeRate, hireAgainRate, completionRate, responseTime, badges[]}`.
- **Pro App's own profile state** (what a pro edits about themselves): `firstName, lastName, about, avatarEmoji, workCategories (Set), travelRadius, homeCity`.

These don't overlap even in intent — one is "what a customer sees about the pro who's coming," the other is "what the pro has configured about themselves." That's expected and fine. The thing to avoid: if a real backend Pro profile gets built, it should be one canonical Pro record that the Customer App's `PROS`-style view is derived from (a read projection), not two independently-maintained pro datasets that can drift out of sync with each other the way job status already has.

---

## 5. Which app may trigger which transition (target model)

| Transition | Triggered by | Notes |
|---|---|---|
| (none) → `posted` | Customer App | Job creation |
| `posted` → `en_route` | Pro App (Accept) | Currently simulated via Customer App's own "Demo Pro Controls" — a stand-in for a real Pro App action, not a real cross-app sync today |
| `en_route` → `arrived` | Pro App | Same simulation caveat |
| `arrived` → `diagnosing` | Pro App | Diagnosis-required categories only (§2); not coded either side as a live transition |
| `diagnosing` → `in_progress` | Pro App | Scope matched what was listed |
| `diagnosing` → `materials_requested` | Pro App | Scope exceeded what was listed |
| `materials_requested` → `materials_approved` | **Customer App** (approve) | Customer-triggered, not Pro-triggered — authorizes the purchase only, credits nothing yet |
| `materials_approved` → `in_progress` | **Pro App** (submit receipt) | New in v0.4. Pro-triggered, but gated: requires an actual-cost amount and a receipt photo. This is where `materialsReimbursed` actually gets credited |
| `materials_requested` → `inspection_completed` | **Customer App** (decline) | Same — customer-triggered terminal state |
| `in_progress` → `complete` | Pro App | |
| (any pre-complete) → `cancelled` | Either, different sub-rules | Customer may cancel before acceptance freely, and request cancellation after acceptance (`cancelStatus:"requested"` — already built); Pro App cancellation/abandonment handling is an open edge case per architecture doc §23 |
| Rating / tip | Customer App only, post-`complete` | Already fully built on Customer side |

A real backend is what actually enforces this table. Until then, this table is the agreement both prototypes should self-police against.

---

## 6. What's explicitly Pro-App-local (not part of the shared contract)

- Job Board section order/collapse state, `emergencyOnly`, category filter chips — pure Pro App UI state.
- `travelRadius`, `workCategories`, `homeCity` — Pro's own settings, not part of any individual job.
- `activeJobs` and its lifecycle-in-progress fields (`pendingMaterialsRequest`, per-step timestamps) — Pro-App-local until a job reaches a terminal state and gets appended to `completedJobsHistory`.
- `completedJobsHistory` itself and the `platformFee` computed from it — this is Pro-App-local (seed history plus, as of v0.3, real live completions) feeding a UI screen, not a shared/synced dataset. If a real backend job record is ever built, the *shape* of its fields should match §3, but this array is scaffolding, not data either app should assume the other can see.
- **New in v0.7:** `jobMessages` (per-job chat) and `supportMessages` (the unrelated Support Chat thread) — both ephemeral, Pro-App-local React state, never persisted past the session, never sent anywhere. `earningsPeriod` and `selectedBucket` (the swipeable Week/Month/Year chart) are the same kind of local UI state as the section-order/filter items above.

---

## 7. Open questions this document surfaces (not resolved here)

1. ~~Should `materials_requested` (the general capability) be available on any job, or scoped only to the five `requiresDiagnosis` categories?~~ **Resolved in v0.3**: any job, per product decision — architecture doc v2's recommendation was adopted as-is.
2. **Approved in principle; DEFERRED to implement:** for standard (non‑diagnosis) jobs, the materials‑declined path should end as “Job Ended — Materials Declined” with a flat visit fee (FOUNDER‑TBD). Current code continues to pay $0 in this path until implemented. Diagnosis jobs remain unchanged (`inspection_completed` with the diagnosis/inspection fee). Do not change enums or code in this PR; align naming across apps later.
3. Whole-request materials approval only (no line-item negotiation) — confirmed acceptable for v1; `materialsRequest` is one object per request, not an array of individually-approvable line items. As of v0.3, the live implementation stores this as `pendingMaterialsRequest: {items, totalCost}` on the active job while pending — matches this shape.
4. Should `requiresDiagnosis` be promoted to a real field on live job records (both `availableJobs`/`SIM_JOBS` and the `completedJobsHistory` records `finalizeJob` produces), per the standing recommendation in §3 — it still isn't; every consumer that needs it calls `DIAGNOSIS_CATEGORIES.has(job.category)` fresh.
5. The seed/historical entries in `completedJobsHistory` and genuinely-live completions from v0.3 onward are now indistinguishable by inspection once appended to the same array. If "real vs. demo data" ever needs to be told apart (e.g., a reset-to-seed-data action), that distinction isn't tracked today and would need to be added retroactively.
6. ~~Is a flat 15% platform fee (regardless of category) the right long-term model, or should this vary by category/market once a real backend exists?~~ **Retired in v0.8**: the platform fee was removed from the Pro App entirely as a modeling correction, not carried forward as an open question. If Haven's economics are modeled in the future, they belong in the customer-side labor price, which is a different (and still unbuilt) question.
7. **From v0.2:** should `inspectionOutcome` exist as its own field, or is it redundant now that `status` (`complete` vs `inspection_completed`) already carries that distinction? Currently no code uses a separate `inspectionOutcome` field — worth deciding whether to formally drop it from the target shape rather than carry a field nothing sets.
8. **New in v0.3:** `finalizeJob` drops every lifecycle timestamp except `completedAt` when a job moves from `activeJobs` into `completedJobsHistory` — the full timeline (`acceptedAt`, `arrivedAt`, `diagnosingAt`, `materialsRequestedAt`, `workStartedAt`) is real while a job is active, then lost on completion. Should the completed-job record be extended to keep all of them?

---

## 8. How to use this document — mandatory, not optional

This document is a required source for both the Customer App chat and the Pro App chat. It is not a one-time report — it is the standing engineering contract between the two prototypes.

**The trigger rule:** for any future slice that changes jobs, pricing, statuses, tips, inspections, materials, preferences, or timestamps, the instruction to give whichever Claude chat is doing that work is:

> Review HAVEN_JOB_CONTRACT.md first. Any schema change must be reflected in the contract and remain compatible with both apps.

Concretely, that means, in the same turn as the code change:
1. Read this document before writing the change.
2. If the change adds, renames, or repurposes a field or status, update the relevant row in §3 (or add one) and the enum in §2 in the same turn.
3. If the change makes one app's shape diverge from the other's, say so explicitly in the "today" columns rather than only documenting the target shape.
4. If a change is genuinely incompatible with the other app (not just not-yet-implemented there), that should stop and become a question back to you.

This document does not replace `HAVEN_MASTER_SPEC.md` — it's a focused extraction of just the job-data-contract slice, meant to be small enough to pass into a fresh conversation without requiring the full spec.
