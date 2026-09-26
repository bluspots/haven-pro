// Duplicated constants across apps; consolidate later in Phase 3.

/* ── Category taxonomy — the complete platform list, grouped for the
   Manage Work Categories screen ── */
const CATEGORY_GROUPS = [
  { group: "Repairs", categories: [
    { name: "Plumbing", icon: "🔧" },
    { name: "Electrical", icon: "💡" },
    { name: "HVAC", icon: "❄️" },
    { name: "Appliance", icon: "🧺" },
    { name: "Handyman", icon: "🛠️" },
  ]},
  { group: "Installation & Setup", categories: [
    { name: "TV Mounting", icon: "📺" },
    { name: "Furniture Assembly", icon: "🪑" },
    { name: "Smart Home", icon: "📱" },
  ]},
  { group: "Home & Property Care", categories: [
    { name: "Cleaning", icon: "🧹" },
    { name: "Painting", icon: "🎨" },
    { name: "Landscaping", icon: "🌿" },
    { name: "Moving", icon: "📦" },
  ]},
];
const CATEGORIES = CATEGORY_GROUPS.flatMap(g => g.categories);
const DIAGNOSIS_CATEGORIES = new Set(["Plumbing", "Electrical", "HVAC", "Appliance"]);
const INSPECTION_VISIT_FEE = 45;
const CONVENIENCE_FEE = 30;

const STATUS_LABELS = {
  en_route: "Driving to Job",
  arrived: "Arrived",
  diagnosing: "Diagnosing",
  materials_requested: "Awaiting Customer",
  materials_approved: "Approved — Get Receipt",
  in_progress: "Working",
};
// Statuses that count as an "active job" for one-active guard
const ACTIVE_BLOCK_STATUSES = new Set([
  "en_route",
  "arrived",
  "diagnosing",
  "materials_requested",
  "materials_approved",
  "in_progress",
]);

const DEFAULT_WORK_CATEGORIES = ["Plumbing", "Electrical", "HVAC", "Appliance", "Handyman"];

