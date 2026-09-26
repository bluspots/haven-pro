/* ── Simulated job feed. Includes deliberate exclusion cases:
   j2/j4/j5 are outside the pro's default work categories.
   j7 matches category + is emergency, but is in NY — proves
   geographic exclusion is unconditional, checked before anything else. ── */
const SIM_JOBS = [
  { id: "j1", customerName: "Marcus T.",  category: "Plumbing",          title: "Leak Repair",         payout: 180, inspectionFee: 45, distanceMi: 2.1, durationMin: 60, city: "Orlando, FL",     lat: 28.5421, lng: -81.3790, requested: "ASAP",              emergency: true,  postedAt: Date.now() - 45 * 1000 },
  { id: "j3", customerName: "Priya S.",  category: "Electrical",        title: "Outlet Repair",       payout: 150, inspectionFee: 45, distanceMi: 3.8, durationMin: 45, city: "Winter Park, FL", lat: 28.6021, lng: -81.3389, requested: "Today, 3:00 PM",    emergency: false, postedAt: Date.now() - 2 * 60 * 60 * 1000 },
  { id: "j6", customerName: "Danielle W.",  category: "Handyman",          title: "Ceiling Fan Install", payout: 70,                     distanceMi: 5.5, durationMin: 35, city: "Winter Park, FL", lat: 28.5975, lng: -81.3435, requested: "Tomorrow, 10:00 AM",emergency: false, postedAt: Date.now() - 60 * 60 * 1000 },
  { id: "j8", customerName: "Robert K.",  category: "HVAC",              title: "AC Not Cooling",      payout: 220, inspectionFee: 45, distanceMi: 6.7, durationMin: 50, city: "Orlando, FL",     lat: 28.5310, lng: -81.3720, requested: "Today, 5:30 PM",    emergency: false, postedAt: Date.now() - 38 * 60 * 1000 },
  { id: "j9", customerName: "Angela F.",  category: "Appliance",         title: "Dishwasher Repair",   payout: 140, inspectionFee: 45, distanceMi: 1.2, durationMin: 40, city: "Orlando, FL",     lat: 28.5395, lng: -81.3812, requested: "Tomorrow, 1:00 PM", emergency: false, postedAt: Date.now() - 4 * 60 * 1000 },
  { id: "j10", customerName: "Chris B.", category: "Plumbing",          title: "Faucet Install",      payout: 110, inspectionFee: 45, distanceMi: 4.9, durationMin: 30, city: "Orlando, FL",     lat: 28.5462, lng: -81.3898, requested: "Today, 11:00 AM",   emergency: false, postedAt: Date.now() - 26 * 60 * 60 * 1000 },
  { id: "j2", customerName: "Nina R.",  category: "TV Mounting",       title: "TV Mounting",         payout: 95,                     distanceMi: 1.4, durationMin: 30, city: "Orlando, FL",     lat: 28.5401, lng: -81.3755, requested: "Today, 2:00 PM",    emergency: false, postedAt: Date.now() - 47 * 60 * 1000 },
  { id: "j4", customerName: "Tyler H.",  category: "Furniture Assembly",title: "Furniture Assembly",  payout: 65,                     distanceMi: 0.9, durationMin: 40, city: "Orlando, FL",     lat: 28.5378, lng: -81.3781, requested: "Tomorrow, 9:00 AM", emergency: false, postedAt: Date.now() - 26 * 60 * 60 * 1000 },
  { id: "j5", customerName: "Monique D.",  category: "Cleaning",          title: "House Cleaning",      payout: 80,                     distanceMi: 4.2, durationMin: 90, city: "Orlando, FL",     lat: 28.5440, lng: -81.3690, requested: "Today, 4:00 PM",    emergency: false, postedAt: Date.now() - 3 * 60 * 1000 },
  { id: "j7", customerName: "Ethan V.",  category: "Plumbing",          title: "Leak Repair",         payout: 175, inspectionFee: 45, distanceMi: 3.0, durationMin: 60, city: "Brooklyn, NY",    lat: 40.6782, lng: -73.9442, requested: "ASAP",              emergency: true,  postedAt: Date.now() - 10 * 60 * 1000 },
];

/* ── Earnings — simulated completed-job history. Field names follow the
   contract's canonical shape: status ('complete' | 'inspection_completed'),
   tipAmount, tipStatus, requiresDiagnosis, inspectionFee, materialsReimbursed
   (simplified stand-in for the not-yet-built materialsRequest object),
   completedAt.

   Payout model (locked): the payout shown to the pro before accepting is
   the exact amount they receive. Haven's economics are built into the
   customer-side labor price, not deducted from the pro's payout — so no
   platform fee is modeled or shown anywhere in the Pro App. Materials,
   tips, and the Inspection Visit are all 100% to the pro, same as before. ── */
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfWeek(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // back up to Sunday
  return d.getTime();
}
function daysAgo(n, hour) {
  const d = new Date();
  d.setHours(hour || 12, 0, 0, 0);
  return d.getTime() - n * DAY_MS;
}
function dayOffsetThisWeek(dayIndex, hour) {
  // dayIndex: 0=Sun..6=Sat. Only meaningful if <= now — future days in the
  // current week correctly have no completed jobs yet.
  const d = new Date(startOfWeek(Date.now()));
  d.setDate(d.getDate() + dayIndex);
  d.setHours(hour || 12, 0, 0, 0);
  return d.getTime();
}
 
const SIM_COMPLETED_JOBS = [
  // This week (day-of-week anchored — entries land only where the date has actually occurred)
  { id: "c1", category: "Plumbing",          title: "Faucet Install",       city: "Orlando, FL",     requiresDiagnosis: true,  status: "complete",                payout: 110, inspectionFee: 45, tipAmount: 20, tipStatus: "paid",    materialsReimbursed: 0,  durationMin: 30, completedAt: dayOffsetThisWeek(1, 10) },
  { id: "c2", category: "TV Mounting",       title: "TV Mounting",          city: "Orlando, FL",     requiresDiagnosis: false, status: "complete",                payout: 95,                      tipAmount: 0,  tipStatus: "notAdded", materialsReimbursed: 0,  durationMin: 30, completedAt: dayOffsetThisWeek(1, 15) },
  { id: "c3", category: "Appliance",         title: "Dishwasher Repair",    city: "Orlando, FL",     requiresDiagnosis: true,  status: "complete",                payout: 140, inspectionFee: 45, tipAmount: 15, tipStatus: "paid",    materialsReimbursed: 22, durationMin: 40, completedAt: dayOffsetThisWeek(2, 13) },
  { id: "c4", category: "HVAC",              title: "AC Not Cooling",       city: "Orlando, FL",     requiresDiagnosis: true,  status: "complete",                payout: 220, inspectionFee: 45, tipAmount: 30, tipStatus: "paid",    materialsReimbursed: 0,  durationMin: 50, completedAt: dayOffsetThisWeek(4, 9)  },
  { id: "c5", category: "Handyman",          title: "Ceiling Fan Install",  city: "Winter Park, FL", requiresDiagnosis: false, status: "complete",                payout: 70,                      tipAmount: 10, tipStatus: "paid",    materialsReimbursed: 0,  durationMin: 35, completedAt: dayOffsetThisWeek(4, 14) },
  { id: "c6", category: "Electrical",        title: "Outlet Repair",        city: "Winter Park, FL", requiresDiagnosis: true,  status: "inspection_completed", payout: 150, inspectionFee: 45, tipAmount: 0,  tipStatus: "notAdded", materialsReimbursed: 0,  durationMin: 20, completedAt: dayOffsetThisWeek(5, 11) },
  { id: "c7", category: "Plumbing",          title: "Leak Repair",          city: "Orlando, FL",     requiresDiagnosis: true,  status: "complete",                payout: 180, inspectionFee: 45, tipAmount: 25, tipStatus: "paid",    materialsReimbursed: 0,  durationMin: 60, completedAt: dayOffsetThisWeek(5, 16) },
  { id: "c8", category: "Cleaning",          title: "House Cleaning",       city: "Orlando, FL",     requiresDiagnosis: false, status: "complete",                payout: 80,                      tipAmount: 12, tipStatus: "paid",    materialsReimbursed: 0,  durationMin: 90, completedAt: dayOffsetThisWeek(6, 10) },
  // Older — depth for Lifetime
  { id: "c9",  category: "Furniture Assembly", title: "Furniture Assembly", city: "Orlando, FL",     requiresDiagnosis: false, status: "complete",                payout: 65,                      tipAmount: 10, tipStatus: "paid",    materialsReimbursed: 0,  durationMin: 40, completedAt: daysAgo(9) },
  { id: "c10", category: "Plumbing",          title: "Leak Repair",         city: "Orlando, FL",     requiresDiagnosis: true,  status: "complete",                payout: 180, inspectionFee: 45, tipAmount: 20, tipStatus: "paid",    materialsReimbursed: 0,  durationMin: 55, completedAt: daysAgo(15) },
  { id: "c11", category: "Electrical",        title: "Outlet Repair",       city: "Winter Park, FL", requiresDiagnosis: true,  status: "inspection_completed", payout: 150, inspectionFee: 45, tipAmount: 0,  tipStatus: "notAdded", materialsReimbursed: 0,  durationMin: 25, completedAt: daysAgo(18) },
  { id: "c12", category: "HVAC",              title: "AC Not Cooling",      city: "Orlando, FL",     requiresDiagnosis: true,  status: "complete",                payout: 220, inspectionFee: 45, tipAmount: 35, tipStatus: "paid",    materialsReimbursed: 18, durationMin: 55, completedAt: daysAgo(24) },
  { id: "c13", category: "TV Mounting",       title: "TV Mounting",         city: "Orlando, FL",     requiresDiagnosis: false, status: "complete",                payout: 95,                      tipAmount: 5,  tipStatus: "paid",    materialsReimbursed: 0,  durationMin: 30, completedAt: daysAgo(31) },
  { id: "c14", category: "Appliance",         title: "Dishwasher Repair",   city: "Orlando, FL",     requiresDiagnosis: true,  status: "complete",                payout: 140, inspectionFee: 45, tipAmount: 0,  tipStatus: "notAdded", materialsReimbursed: 0,  durationMin: 45, completedAt: daysAgo(40) },
  { id: "c15", category: "Handyman",          title: "Ceiling Fan Install", city: "Winter Park, FL", requiresDiagnosis: false, status: "complete",                payout: 70,                      tipAmount: 15, tipStatus: "paid",    materialsReimbursed: 0,  durationMin: 35, completedAt: daysAgo(52) },
  { id: "c16", category: "Cleaning",          title: "House Cleaning",      city: "Orlando, FL",     requiresDiagnosis: false, status: "complete",                payout: 80,                      tipAmount: 10, tipStatus: "paid",    materialsReimbursed: 0,  durationMin: 85, completedAt: daysAgo(63) },
].filter(j => j.completedAt <= Date.now());

/* ── Fresh vs. Demo Pro — the two states "Reset to Fresh Pro" and "Load
   Demo Pro" (dev-only) switch between. Fresh is now the TRUE starting
   point of the app: no profile, no verification, no history. availableJobs
   (the job market) is not part of either — it's environmental data a new
   Pro sees just like an established one, reset separately to the full
   SIM_JOBS pool by applyProDefaults regardless of which mode is chosen. ── */
function freshProDefaults() {
  return {
    workCategories: new Set(),
    travelRadius: 15,
    homeCity: "",
    firstName: "",
    lastName: "",
    about: "",
    avatarEmoji: "🧑‍🔧",
    avatarPhoto: null,
    identityVerification: { provider: "persona", providerVerificationId: null, status: "not_started", verifiedAt: null, failureReasonCode: null, recheckAt: null },
    backgroundCheck: { provider: "checkr", providerReportId: null, status: "not_started", clearedAt: null },
    credentials: [],
    payoutAccount: { provider: "stripe", providerAccountId: null, payoutsEnabled: false, requirementsDue: [], status: "not_started", last4: null },
    taxProfile: { provider: "stripe_connect", status: "not_started", providerReference: null, taxFormAvailability: "Future 1099/tax-document flow, subject to legal and tax review" },
    taxLegalName: "",
    taxClassification: "Individual",
    completedJobsHistory: [],
    earningsStatements: [],
  };
}
function demoProDefaults() {
  return {
    workCategories: new Set(DEFAULT_WORK_CATEGORIES),
    travelRadius: 15,
    homeCity: "Orlando, FL",
    firstName: "Alex",
    lastName: "Rivera",
    about: "Licensed plumber with 8 years of experience across Central Florida. Specializing in leak repair, fixture installs, and emergency calls.",
    avatarEmoji: "👷",
    avatarPhoto: null,
    identityVerification: { provider: "persona", providerVerificationId: null, status: "verified", verifiedAt: Date.now() - 30 * DAY_MS, failureReasonCode: null, recheckAt: null },
    backgroundCheck: { provider: "checkr", providerReportId: null, status: "clear", clearedAt: Date.now() - 30 * DAY_MS },
    credentials: [
      { id: "cred1", type: "License", name: "Florida Plumbing Contractor", jurisdiction: "FL", number: "FL #123456", expiration: "2027-06", status: "verified", verificationSource: "Florida DBPR (simulated adapter)", verifiedAt: Date.now() - 30 * DAY_MS, expiresAt: null, providerReference: "dbpr_demo_2291" },
      { id: "cred2", type: "Certification", name: "EPA Section 608", jurisdiction: "", number: "", expiration: "2025-03", status: "self_reported", verificationSource: null, verifiedAt: null, expiresAt: null, providerReference: null },
    ],
    payoutAccount: { provider: "stripe", providerAccountId: "acct_demo_82910", payoutsEnabled: true, requirementsDue: [], status: "enabled", last4: "4821" },
    taxProfile: { provider: "stripe_connect", status: "verified", providerReference: "tax_demo_5510", taxFormAvailability: "Future 1099/tax-document flow, subject to legal and tax review" },
    taxLegalName: "Alex Rivera",
    taxClassification: "Individual",
    completedJobsHistory: SIM_COMPLETED_JOBS,
    earningsStatements: [],
  };
}

