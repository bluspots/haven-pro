function jobRequiresDiagnosis(job) {
  return job && Object.prototype.hasOwnProperty.call(job, "requiresDiagnosis")
    ? !!job.requiresDiagnosis
    : DIAGNOSIS_CATEGORIES.has(job.category);
}
function hasBlockingActiveJob(jobs) {
  return jobs.some(j => ACTIVE_BLOCK_STATUSES.has(j.status));
}
function iconFor(category) {
  const c = CATEGORIES.find(c => c.name === category);
  return c ? c.icon : "🧰";
}
function stateOf(city) {
  return city.split(",").pop().trim();
}

/* ── Great-circle distance in miles — used to gate "I've Arrived" on
   actually being near the job, not just on the pro's word. ── */
function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const ARRIVAL_THRESHOLD_MI = 0.15; // roughly "on the same block"

function jobAmount(job) {
  const gross =
    job.status === "inspection_completed"
      ? job.inspectionFee
      : job.status === "materials_declined"
        ? (job.convenienceFee || CONVENIENCE_FEE)
        : job.payout;
  const materials = job.materialsReimbursed || 0;
  const tip = job.tipAmount || 0;
  const net = gross + materials + tip;
  return { gross, materials, tip, net };
}

