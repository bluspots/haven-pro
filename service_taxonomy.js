// Haven shared service taxonomy registry — CAT-01 F1.
//
// The SAME file is kept byte-identical in both apps (Customer
// bluspots/bluspots.github.io and Pro bluspots/haven-pro); each repo's test
// pins its SHA-256, so a change in one copy without the other fails CI.
//
// Source of truth for the approved architecture:
//   Hub decisions/CAT-01-FOUNDER-APPROVAL-2026-10-25.md
//   Hub backend/CAT-01-CANONICAL-TAXONOMY-PROPOSAL.md
//   Hub backend/CAT-01-IMPLEMENTATION-HANDOFF-2026-10-25.md
//
// F1 is BEHAVIOR-NEUTRAL: this file is not part of either app's build and is
// not wired into posting, job discovery, Pro preference saving or diagnosis.
// Stored job categories, Pro preferences and backend requests are unchanged.
// Wiring it in (F2–F6) waits for Grokbot's backend contract (Hub REQ-08..11).
//
// Rules encoded here:
//   - 16 stable snake_case keys; display labels are separate from keys.
//   - Every one of the 61 Customer catalog tasks maps to exactly one key, by
//     task id (never by display title).
//   - Ambiguous legacy labels (Repair, Installation, Maintenance, Other,
//     General) map to NO key: they need review, never a guess.
//   - Legacy Pro "Furniture Assembly" maps to assembly as a furniture-only
//     capability; it is not consent to all assembly work (e.g. task 3, home gym).
//   - New keys are never selected for anyone automatically.

const HAVEN_TAXONOMY_VERSION = 1;

// 16 approved stable keys (order = approved list order) with display labels.
const HAVEN_SERVICE_CATEGORIES = Object.freeze([
  Object.freeze({ key: "plumbing", label: "Plumbing" }),
  Object.freeze({ key: "electrical", label: "Electrical" }),
  Object.freeze({ key: "hvac", label: "Heating & AC" }),
  Object.freeze({ key: "appliance", label: "Appliances" }),
  Object.freeze({ key: "handyman", label: "General Repairs" }),
  Object.freeze({ key: "assembly", label: "Assembly" }),
  Object.freeze({ key: "installation", label: "Installation" }),
  Object.freeze({ key: "tv_mounting", label: "TV Mounting" }),
  Object.freeze({ key: "smart_home", label: "Smart Home" }),
  Object.freeze({ key: "cleaning", label: "Cleaning" }),
  Object.freeze({ key: "landscaping", label: "Landscaping" }),
  Object.freeze({ key: "painting", label: "Painting" }),
  Object.freeze({ key: "flooring", label: "Flooring" }),
  Object.freeze({ key: "moving", label: "Moving" }),
  Object.freeze({ key: "maintenance", label: "Property Maintenance" }),
  Object.freeze({ key: "pest_control", label: "Pest Control" }),
]);

// Customer catalog task id -> service key (all 61 tasks, approved matrix).
const HAVEN_TASK_SERVICE_KEYS = Object.freeze({
  1: "assembly", 2: "assembly", 3: "assembly", 4: "assembly", 5: "assembly",
  6: "tv_mounting",
  7: "installation", 8: "installation", 9: "installation", 10: "installation",
  11: "smart_home", 12: "smart_home", 13: "smart_home", 14: "smart_home",
  15: "plumbing", 16: "plumbing", 17: "plumbing", 18: "plumbing", 19: "plumbing", 52: "plumbing",
  20: "electrical", 21: "electrical", 22: "electrical", 23: "electrical", 54: "electrical", 57: "electrical",
  24: "painting", 25: "painting", 26: "painting",
  27: "flooring", 28: "flooring", 29: "flooring",
  30: "cleaning", 31: "cleaning", 32: "cleaning", 33: "cleaning", 59: "cleaning", 60: "cleaning", 61: "cleaning",
  34: "landscaping", 35: "landscaping", 36: "landscaping", 37: "landscaping",
  38: "moving", 39: "moving", 40: "moving",
  41: "handyman", 42: "handyman", 43: "handyman", 44: "handyman", 56: "handyman", 58: "handyman",
  45: "hvac", 53: "hvac",
  46: "maintenance", 47: "maintenance", 48: "maintenance",
  49: "appliance", 50: "appliance", 55: "appliance",
  51: "pest_control",
});

// Mappings the founder has NOT finally decided (approval record "Open detailed decisions").
const HAVEN_TASK_OPEN_DECISIONS = Object.freeze({
  45: "HVAC filter swap: provisionally hvac; maintenance under consideration. Not final without founder confirmation.",
  17: "Dishwasher installation: kept plumbing (current Customer source) pending any explicitly approved change.",
});

// Tasks whose key alone is not enough for eligibility (capabilities/qualifications to be specified).
const HAVEN_TASK_CAPABILITY_NOTES = Object.freeze({
  3: "Home gym assembly: not implied by legacy 'Furniture Assembly'; needs explicit opt-in.",
  23: "EV charger outlet: qualification rules to be specified.",
  43: "Garage door repair: potentially high-risk (springs); qualification rules to be specified.",
  51: "Pest control: qualification/licensing rules to be specified.",
});

// Customer EMERGENCY_OPTIONS key -> service key. Catalog-backed options use their
// task's key; custom options (locked out, other) are UNCLASSIFIED (null) and need
// an explicit service choice or triage (decision pending), never a silent fallback.
const HAVEN_EMERGENCY_SERVICE_KEYS = Object.freeze({
  leak: "plumbing",   // task 19
  ac: "hvac",         // task 53
  elec: "electrical", // task 54
  garage: "handyman", // task 43
  lock: null,         // custom; locksmith work may be regulated
  other: null,        // custom
});

// Legacy display labels as stored today (jobs.category from Customer; Pro work
// category names). kind: "exact" = one key; "capability_subset" = maps to a key
// only for a narrower capability; "ambiguous" = no key, needs review.
const HAVEN_LEGACY_CUSTOMER_LABELS = Object.freeze({
  "Assembly": Object.freeze({ key: "assembly", kind: "exact" }),
  "Installation": Object.freeze({ key: null, kind: "ambiguous", note: "TV mounting (task 6) or installation (tasks 7-10)" }),
  "Smart Home": Object.freeze({ key: "smart_home", kind: "exact" }),
  "Plumbing": Object.freeze({ key: "plumbing", kind: "exact" }),
  "Electrical": Object.freeze({ key: "electrical", kind: "exact" }),
  "Painting": Object.freeze({ key: "painting", kind: "exact" }),
  "Flooring": Object.freeze({ key: "flooring", kind: "exact" }),
  "Cleaning": Object.freeze({ key: "cleaning", kind: "exact" }),
  "Landscaping": Object.freeze({ key: "landscaping", kind: "exact" }),
  "Moving": Object.freeze({ key: "moving", kind: "exact" }),
  "Repair": Object.freeze({ key: null, kind: "ambiguous", note: "handyman (41-44, 56, 58) or hvac (53)" }),
  "Maintenance": Object.freeze({ key: null, kind: "ambiguous", note: "maintenance (46-48) or hvac (45)" }),
  "Appliance": Object.freeze({ key: "appliance", kind: "exact" }),
  "Pest Control": Object.freeze({ key: "pest_control", kind: "exact" }),
  "Other": Object.freeze({ key: null, kind: "ambiguous", note: "custom job; needs explicit classification" }),
  "General": Object.freeze({ key: null, kind: "ambiguous", note: "posting fallback; needs explicit classification" }),
});

const HAVEN_LEGACY_PRO_LABELS = Object.freeze({
  "Plumbing": Object.freeze({ key: "plumbing", kind: "exact" }),
  "Electrical": Object.freeze({ key: "electrical", kind: "exact" }),
  "HVAC": Object.freeze({ key: "hvac", kind: "exact" }),
  "Appliance": Object.freeze({ key: "appliance", kind: "exact" }),
  "Handyman": Object.freeze({ key: "handyman", kind: "exact" }),
  "TV Mounting": Object.freeze({ key: "tv_mounting", kind: "exact" }),
  "Furniture Assembly": Object.freeze({ key: "assembly", kind: "capability_subset", capability: "furniture_only", note: "not consent to all assembly (e.g. home gym)" }),
  "Smart Home": Object.freeze({ key: "smart_home", kind: "exact" }),
  "Cleaning": Object.freeze({ key: "cleaning", kind: "exact" }),
  "Painting": Object.freeze({ key: "painting", kind: "exact" }),
  "Landscaping": Object.freeze({ key: "landscaping", kind: "exact" }),
  "Moving": Object.freeze({ key: "moving", kind: "exact" }),
});

// Keys with no legacy Pro equivalent: opt-in only, never auto-selected.
const HAVEN_OPT_IN_ONLY_KEYS = Object.freeze(["installation", "flooring", "maintenance", "pest_control"]);

function havenIsServiceKey(key) {
  return HAVEN_SERVICE_CATEGORIES.some(c => c.key === key);
}
function havenServiceKeyForTask(taskId) {
  const k = HAVEN_TASK_SERVICE_KEYS[Number(taskId)];
  return k || null;
}
function havenServiceLabel(key) {
  const c = HAVEN_SERVICE_CATEGORIES.find(x => x.key === key);
  return c ? c.label : null;
}
// Legacy label -> { key, kind, ... } or null when unknown. Unknown and
// ambiguous labels never produce a key.
function havenLegacyLabelInfo(label, app) {
  const table = app === "pro" ? HAVEN_LEGACY_PRO_LABELS : HAVEN_LEGACY_CUSTOMER_LABELS;
  return Object.prototype.hasOwnProperty.call(table, label) ? table[label] : null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HAVEN_TAXONOMY_VERSION, HAVEN_SERVICE_CATEGORIES, HAVEN_TASK_SERVICE_KEYS, HAVEN_TASK_OPEN_DECISIONS,
    HAVEN_TASK_CAPABILITY_NOTES, HAVEN_EMERGENCY_SERVICE_KEYS, HAVEN_LEGACY_CUSTOMER_LABELS, HAVEN_LEGACY_PRO_LABELS,
    HAVEN_OPT_IN_ONLY_KEYS, havenIsServiceKey, havenServiceKeyForTask, havenServiceLabel, havenLegacyLabelInfo,
  };
}
