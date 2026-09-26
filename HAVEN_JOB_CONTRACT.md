# HAVEN — SHARED JOB DATA CONTRACT (Pointer Only — Pro Repo)

This repository no longer carries an editable copy of the shared Job Contract.

Source of truth:

- Product and job rules (statuses, economics, fees, naming/taxonomy):  
  https://github.com/bluspots/bluspots.github.io/blob/master/HAVEN_JOB_CONTRACT.md

Technical representation/enforcement:

- Backend/shared contract lives with the Customer/shared codebase as `HAVEN_SHARED_BACKEND_CONTRACT.md` (link when available in that repo). This Pro repo defers to that file for schema details once published.

Notes for Pro contributors:

- Do not edit product decisions here. Follow the canonical Customer `HAVEN_JOB_CONTRACT.md` for all job/status/fee rules (locked: labor 20/80; Haven $0 on materials/tips/Inspection Visit/$30 convenience; materials are additive; diagnosis decline = `inspection_completed` at $45; standard decline = `materials_declined` at $30; insurance OUT; Pro category names match Customer; hard $45 Inspection Visit).
- Pro-side code and docs should reference the canonical document for rules and use the backend/shared contract for field names and API shapes once available.
