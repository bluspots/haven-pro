# HAVEN PRO — CURRENT STATE

**Last updated:** First-Time Experience + Blank-Slate App + Active Job Workflow

## CURRENTLY BUILT
- **True blank-slate app**: boots signed-out with zero seeded profile/verification/history. Full first-time onboarding wizard (Welcome → Create Account → Verify Contact → Create Profile → Choose Categories → Service Area → Identity → Background → Payout → Tax → Credentials (optional) → Ready) reusing the real production-shaped verification screens, not a simplified copy.
- Dev-only tools: **Load Demo Pro** / **Reset to Fresh Pro** / **Jump to Marketplace Ready** — Welcome screen and Settings.
- Job Board (Home): grouped by category, drag-to-reorder, emergency filter, collapse-all
- Full job lifecycle: Accept (**one active job at a time, locked rule**) → En Route (real map/directions, geofenced arrival) → Arrived → Diagnosing → Materials (request → customer approval sim → receipt-verified reimbursement) → Working (live timer, **optional job notes + before/after photos**) → **Completion Review** → Complete → Earnings
- Earnings: swipeable Week/Month/Year chart, bucket drill-down, Lifetime → Monthly → Calendar → Day → Job Earnings Statement (now also shows job notes/photos), category filter
- Messages: per-job simulated chat + Support Chat (Help & Support)
- Profile: editable identity/photo, Work Categories, Travel Radius, Settings — Trust Score/Rating/Member-since now genuinely derive from history instead of hardcoded demo numbers
- Verification Center (Identity, Background Check w/ distinct `consent_required` state, Professional Credentials) + Payouts & Tax — production-shaped provider architecture (Persona/Checkr/Stripe Connect conceptually), no status auto-resolves without a DEV control; Insurance removed entirely; Job Earnings Statement generated per finalized job with simulated email delivery

## CURRENT DEVELOPMENT AREA
None open. This slice closed out the onboarding/blank-slate milestone.

## NEXT LIKELY MILESTONE
Job-specific credential eligibility (`isEligibleForJob`) — stub exists, always returns true, not wired to anything. Needs a reviewed jurisdiction/service rules matrix. Otherwise, awaiting next direction — likely shared-sandbox integration with the Customer App, per the project's original phasing.

## IMPORTANT OPEN DECISIONS
- Standard (non-diagnosis) categories still have no fallback fee if materials are declined mid-job — pro is paid $0 in that case. Flagged repeatedly, never resolved.
- Which specific 1099 Haven will issue is explicitly not hardcoded anywhere — needs tax/legal review first.
- Contextual first-time tips (Job Board explainer, "we'll guide you through each step" on first accepted job) were specified but not built this slice — onboarding and the readiness gate cover the substance; the lightweight in-context nudges are still open.

## KNOWN ISSUES
None currently open.

## LAST VERIFIED TEST STATE
Full zero-to-earnings walkthrough, verified step by step: fresh boot → Create Account (validation blocks on mismatched/short password) → Verify Contact (blocked until both verified) → Create Profile (blocked without home city) → Choose Categories (blocked with none selected) → Service Area → all four verification steps (DEV-resolved) → Credentials skip → Ready screen shows correct readiness → Find Work lands on Job Board → Accept first job → **second accept correctly blocked** ("Finish Current Job First" + friendly toast) → Arrive → Diagnose → Work → job notes captured → Mark Complete opens Review (shows notes, no assumed tip) → Complete Job → Job Complete → See Earnings shows real (non-empty) earnings → statement shows job notes and "Job Earnings Statement" header. Separately verified: Load Demo Pro and Reset to Fresh Pro both work; Jump to Marketplace Ready correctly produces a verified-but-zero-history pro showing genuine empty states everywhere (Earnings, Messages, My Jobs, Credentials) and "New" (not fake 92/4.9) on Profile; demo-pro regression across all 5 tabs plus the Inspection Completed materials-decline path still intact. 0 console errors throughout. One real label-wording bug was caught and fixed mid-session (a disabled "I'll finish this later" button read confusingly at `not_started`); several apparent test failures during verification turned out to be test-script artifacts (HTML entity encoding, `<textarea>` vs `<input>` prototypes, an unrelated CSS value matching a numeric substring) — each confirmed by direct inspection before being dismissed, not assumed.
