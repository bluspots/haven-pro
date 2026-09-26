import React, { useState, useEffect, useRef } from "react";

const AVATAR_OPTIONS = ["👷", "👷‍♀️", "🧑‍🔧", "👨‍🔧", "👩‍🔧"];
const RADIUS_OPTIONS = [5, 10, 15, 25, 50];

 
function formatShortDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
 

/* ── Centralized job-age formatter — informational only, never used to
   rank or highlight a job ── */
function formatJobAge(postedAt, now) {
  const diffMs = Math.max(0, now - postedAt);
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "Posted just now";
  if (min < 60) return `Posted ${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `Posted ${hr} hr ago`;
  if (hr < 48) return "Posted yesterday";
  return `Posted ${Math.floor(hr / 24)} days ago`;
}

 

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error("Haven Pro render error:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, fontFamily: FONT, background: LIGHT.bg, padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 32 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: LIGHT.tx }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: LIGHT.ts, maxWidth: 280, lineHeight: 1.5 }}>Haven Pro hit an unexpected error. Reloading usually fixes it.</div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   APP
   ══════════════════════════════════════════════════════════════════════ */

export default function HavenProApp() {
  const [tab, setTab] = useState("home");
  const [theme, setTheme] = useState("light");
  const [notifPrefs, setNotifPrefs] = useState({ newJobs: true, emergency: true, materials: true, earnings: true });
  const [openFaq, setOpenFaq] = useState(null);
  const [online, setOnline] = useState(true);
  const [availableJobs, setAvailableJobs] = useState(SIM_JOBS);
  const [activeJobs, setActiveJobs] = useState([]); // jobs a pro has accepted, mid-lifecycle
  const [completedJobsHistory, setCompletedJobsHistory] = useState([]);
  const [toast, setToast] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [clockTick, setClockTick] = useState(Date.now()); // 1s cadence, only runs while a job is in_progress
  const [proLiveLocation, setProLiveLocation] = useState(null); // {lat,lng} from the browser, or null if unavailable/denied

  // Permanent profile preferences — the eligibility pool. Starts blank
  // (true first-launch state); onboarding or "Load Demo Pro" populates it.
  const [workCategories, setWorkCategories] = useState(new Set());
  const [travelRadius, setTravelRadius] = useState(15);
  const [homeCity, setHomeCity] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [about, setAbout] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState("🧑‍🔧");
  const [avatarPhoto, setAvatarPhoto] = useState(null); // data URL from a real uploaded file, takes precedence over avatarEmoji when set

  // Temporary Home browsing filter — separate from workCategories.
  // Trade Board groups by category natively, so the only cross-cutting
  // filter left is Emergency (it cuts across every category's section).
  const [emergencyOnly, setEmergencyOnly] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState(new Set()); // category names currently collapsed
  const [sectionOrder, setSectionOrder] = useState(CATEGORIES.map(c => c.name)); // pro-customizable via tap-and-hold
  const [draggingSection, setDraggingSection] = useState(null);

  // Earnings sub-navigation + ledger filter
  // Earnings sub-navigation — a real stack so Main → Monthly → Calendar →
  // Day → Statement can all go back one level at a time (button or swipe).
  const [earningsStack, setEarningsStack] = useState([{ view: "main" }]);
  const [myJobsStack, setMyJobsStack] = useState([{ view: "list" }]);
  const [messagesStack, setMessagesStack] = useState([{ view: "list" }]);
  const [jobMessages, setJobMessages] = useState({}); // { [jobId]: [{from:'pro'|'customer', text, at}] }
  const [messageDraftText, setMessageDraftText] = useState("");
  const [supportMessages, setSupportMessages] = useState([
    { from: "support", text: "Hi! I'm here to help with anything Haven Pro related. What's up?", at: Date.now() },
  ]);
  const [supportInput, setSupportInput] = useState("");
  const [materialsDraft, setMaterialsDraft] = useState(null); // { jobId, items:[{name,cost}] } while filling out a request
  const [receiptDraft, setReceiptDraft] = useState(null); // { jobId, cost, photo } while submitting a post-purchase receipt
  const [earningsPeriod, setEarningsPeriod] = useState("week"); // week | month | year — swipeable on the chart panel
  const [selectedBucket, setSelectedBucket] = useState(null); // { start, end, fullLabel } — inline swap on the main screen's chart, any period
  const [ledgerCategoryFilter, setLedgerCategoryFilter] = useState("all");
  const [ledgerFilterOpen, setLedgerFilterOpen] = useState(false);
  const [acceptingJobId, setAcceptingJobId] = useState(null);

  // Load posted jobs when viewing Home (Job Board) and refresh lightly while on that screen
  useEffect(() => {
    let cancelled = false;
    let timerId = null;
    async function load() {
      const jobs = await fetchPostedJobsFromSupabase();
      if (jobs && !cancelled) {
        // Replace SIM_JOBS entirely when backend is configured (even if empty)
        setAvailableJobs(jobs);
      }
    }
    if (tab === "home" && getSupabaseConfig()) {
      load();
      timerId = window.setInterval(load, 30000); // ~30s refresh cadence
    }
    return () => {
      cancelled = true;
      if (timerId) window.clearInterval(timerId);
    };
  }, [tab]);

  // Poll backend for status changes on active, backend-claimed jobs (e.g., materials approve/decline)
  useEffect(() => {
    const cfg = getSupabaseConfig();
    if (!cfg) return;
    // Only poll while there is at least one backend-claimed job awaiting customer action
    const jobsToPoll = activeJobs.filter(j =>
      j.backendClaimed && looksLikeUuid(j.id) && (j.status === "materials_requested" || j.status === "materials_approved")
    );
    if (jobsToPoll.length === 0) return;
    let cancelled = false;
    const pollOne = async (job) => {
      try {
        const url = `${cfg.url}/rest/v1/jobs?id=eq.${encodeURIComponent(job.id)}&pro_id=eq.${encodeURIComponent(DEMO_PRO_ID)}&select=id,status,inspection_fee_cents,convenience_fee_cents`;
        const res = await fetch(url, {
          method: "GET",
          headers: {
            "apikey": cfg.anon,
            "Authorization": `Bearer ${cfg.anon}`,
            "Accept": "application/json",
            "Prefer": "count=exact",
          },
        });
        if (!res.ok) {
          // Soft failure — keep local UI state; customer UI continues independently.
          return;
        }
        const rows = await res.json();
        if (!Array.isArray(rows) || rows.length === 0) return;
        const row = rows[0];
        if (cancelled) return;
        const currentJob = activeJobsRef.current.find(j => j.id === job.id);
        if (!currentJob) return;
        const backendStatus = row.status;
        if (backendStatus === "materials_approved" && currentJob.status === "materials_requested") {
          updateActiveJob(job.id, { status: "materials_approved" });
          showToast(`Customer approved materials for ${currentJob.title} — go ahead and purchase, then submit your receipt`);
        } else if (backendStatus === "inspection_completed" && currentJob.status !== "inspection_completed") {
          // Terminal — remove from active, finalize with inspection fee from backend if present.
          const cents = typeof row.inspection_fee_cents === "number" ? row.inspection_fee_cents : Math.round(((currentJob.inspectionFee || INSPECTION_VISIT_FEE) || 0) * 100);
          const fee = Math.round(cents / 100);
          setActiveJobs(prev => prev.filter(j => j.id !== job.id));
          showToast(`Inspection Completed — Inspection Visit $${fee}`);
          finalizeJob({ ...currentJob, inspectionFee: fee }, "inspection_completed");
          setMyJobsStack([{ view: "list" }]);
        } else if (backendStatus === "materials_declined" && currentJob.status !== "materials_declined") {
          // Terminal — remove from active, finalize with convenience fee (default to constant if backend omitted it)
          const cents = typeof row.convenience_fee_cents === "number" ? row.convenience_fee_cents : CONVENIENCE_FEE * 100;
          const conv = Math.round(cents / 100);
          setActiveJobs(prev => prev.filter(j => j.id !== job.id));
          showToast(`Materials declined — job could not be completed — Convenience Fee $${conv}`);
          finalizeJob({ ...currentJob, convenienceFee: conv }, "materials_declined");
          setMyJobsStack([{ view: "list" }]);
        }
      } catch {
        // swallow — polling is best-effort
      }
    };
    const tick = () => {
      // Poll each (the one-active-job rule keeps this tiny)
      jobsToPoll.forEach(pollOne);
    };
    // Start now and then every ~5s
    let id = window.setInterval(tick, 5000);
    tick();
    return () => { cancelled = true; if (id) window.clearInterval(id); };
  }, [activeJobs]);

  // Profile sub-navigation + drafts (draft/commit pattern so typing never silently saves)
  const [profileView, setProfileView] = useState("main"); // main | edit | categories | settings
  const [editDraft, setEditDraft] = useState(null);
  const [categoriesDraft, setCategoriesDraft] = useState(null);

  /* ── Verification / Payouts & Tax — production-shaped state model.
     Haven consumes PROVIDER results; it never verifies identity/background/
     credentials/banking by looking at what someone uploaded. Every status
     transition to a positive terminal state (verified/clear/enabled) is
     driven by a DEV-only control simulating a provider webhook — nothing
     auto-resolves from a timer or from the pro's own submission alone.
     Matches HAVEN_PRO_ACCOUNT_CONTRACT.md. Insurance removed per product
     decision (see contract) — not carried forward in any form. ── */
  const [identityVerification, setIdentityVerification] = useState({
    provider: "persona", providerVerificationId: null, status: "not_started", verifiedAt: null, failureReasonCode: null, recheckAt: null,
  }); // status: not_started|session_created|pending|verified|needs_review|failed|expired
  const [identityProgress, setIdentityProgress] = useState({ idCaptured: false, selfieCaptured: false });

  const [backgroundCheck, setBackgroundCheck] = useState({
    provider: "checkr", providerReportId: null, status: "not_started", clearedAt: null,
  }); // status: not_started|consent_required|invited|pending|clear|consider|disputed|suspended|expired
  const [backgroundConsent, setBackgroundConsent] = useState(false);

  const [credentials, setCredentials] = useState([]);
  const [credentialDraft, setCredentialDraft] = useState(null);

  const [payoutAccount, setPayoutAccount] = useState({
    provider: "stripe", providerAccountId: null, payoutsEnabled: false, requirementsDue: [], status: "not_started", last4: null,
  }); // status: not_started|pending|enabled|restricted

  const [taxProfile, setTaxProfile] = useState({
    provider: "stripe_connect", status: "not_started", providerReference: null, taxFormAvailability: "Future 1099/tax-document flow, subject to legal and tax review",
  }); // status: not_started|pending|verified|needs_review
  const [taxLegalName, setTaxLegalName] = useState("");
  const [taxClassification, setTaxClassification] = useState("Individual");
  const [taxDraft, setTaxDraft] = useState(null); // {legalName, classification} while editing, pre-submission only

  const [earningsStatements, setEarningsStatements] = useState([]); // {id, jobId, proId, createdAt, financialSnapshot, pdfUrl, emailStatus, emailedAt}

  /* ── Account / Onboarding — production-shaped, not one giant boolean.
     accountStatus and onboardingStatus are independent: signed_in with
     onboarding not yet completed is a real, valid state (mid-onboarding).
     onboardingVersion exists so a future onboarding redesign can force
     existing incomplete accounts through the new flow rather than silently
     misinterpreting old step names. ── */
  const ONBOARDING_VERSION = 1;
  const [accountStatus, setAccountStatus] = useState("signed_out"); // signed_out | signed_in
  const [onboardingStatus, setOnboardingStatus] = useState("not_started"); // not_started | in_progress | completed
  const [onboardingStep, setOnboardingStep] = useState("welcome");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPhone, setAccountPhone] = useState("");
  const [accountPasswordDraft, setAccountPasswordDraft] = useState({ password: "", confirm: "" }); // never persisted past account creation
  const [emailVerifyStatus, setEmailVerifyStatus] = useState("not_sent"); // not_sent | pending | verified
  const [phoneVerifyStatus, setPhoneVerifyStatus] = useState("not_sent"); // not_sent | pending | verified
  const [signUpDraft, setSignUpDraft] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "", confirm: "" });
  const [accountCreatedAt, setAccountCreatedAt] = useState(null);

  /* ── Account Readiness — derived, never stored directly. Only the 5
     mandatory baseline items gate marketplaceReady; optional credentials
     strengthen the profile but never block it. ── */
  const profileComplete = !!(firstName.trim() && lastName.trim() && homeCity.trim());
  const identityVerified = identityVerification.status === "verified";
  const backgroundApproved = backgroundCheck.status === "clear";
  const payoutEnabled = payoutAccount.status === "enabled";
  const taxComplete = taxProfile.status === "verified";
  const mandatoryFlags = [profileComplete, identityVerified, backgroundApproved, payoutEnabled, taxComplete];
  const readinessPercent = Math.round((mandatoryFlags.filter(Boolean).length / mandatoryFlags.length) * 100);
  const marketplaceReady = mandatoryFlags.every(Boolean);
  const needsOnboarding = accountStatus === "signed_out" || onboardingStatus !== "completed";

  /* ── Job-specific legal eligibility — architecture stub only, per
     HAVEN_PRO_ACCOUNT_CONTRACT.md §7. Not wired to anything: no
     jurisdiction/service rules matrix exists yet, and inventing one isn't
     this slice's job. Work-category/geo/radius eligibility (unrelated,
     already built) is what actually gates the Job Board today. ── */
  function isEligibleForJob(pro, job) {
    return true; // TODO: once a reviewed jurisdiction/service rules matrix exists, evaluate required credentials here
  }

  const toastTimer = useRef(null);
  const swipeStartX = useRef(null);
  const materialsTimers = useRef({});
  useEffect(() => () => { Object.values(materialsTimers.current).forEach(clearTimeout); }, []);
  // Timers fire well after the render that scheduled them, so they can't
  // rely on a closed-over `activeJobs` (it would be stale by then) — this
  // ref always holds the latest value for exactly that kind of read.
  const activeJobsRef = useRef(activeJobs);
  useEffect(() => { activeJobsRef.current = activeJobs; }, [activeJobs]);
  const longPressTimer = useRef(null);
  const dragBaseY = useRef(0);
  const suppressNextClick = useRef(false);

  const T = theme === "dark" ? DARK : LIGHT;

  // Standalone/mobile detection — remove desktop phone-frame chrome on real phones
  const isStandalone = (typeof window !== "undefined" && (
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    (window.navigator && window.navigator.standalone === true) // iOS Safari legacy flag
  )) || false;
  const isNarrow = typeof window !== "undefined" ? window.innerWidth <= 480 : false;
  const showFrameChrome = !(isStandalone || isNarrow);

  // Tapping any bottom tab — including the one already active — pops
  // back to that tab's root, matching standard "tap active tab to go
  // home" behavior. Filter preferences (ledgerCategoryFilter) persist;
  // only navigation depth resets.
  function goTab(t) {
    setTab(t);
    setEarningsStack([{ view: "main" }]);
    setMyJobsStack([{ view: "list" }]);
    setMessagesStack([{ view: "list" }]);
    setMaterialsDraft(null);
    setReceiptDraft(null);
    setSelectedBucket(null);
    setEarningsPeriod("week");
    setProfileView("main");
    setEditDraft(null);
    setCategoriesDraft(null);
    setTaxDraft(null);
    setCredentialDraft(null);
  }

  /* ── Dev-only: swap the whole Pro identity/verification/history between
     a true blank slate and the seeded demo. Never touches availableJobs
     (the job market) — that's environmental, not pro-specific, and stays
     the full SIM_JOBS pool either way. Not called from anywhere in the
     normal user flow. ── */
  function applyProDefaults(d) {
    setWorkCategories(d.workCategories);
    setTravelRadius(d.travelRadius);
    setHomeCity(d.homeCity);
    setFirstName(d.firstName);
    setLastName(d.lastName);
    setAbout(d.about);
    setAvatarEmoji(d.avatarEmoji);
    setAvatarPhoto(d.avatarPhoto);
    setIdentityVerification(d.identityVerification);
    setIdentityProgress({ idCaptured: false, selfieCaptured: false });
    setBackgroundCheck(d.backgroundCheck);
    setBackgroundConsent(false);
    setCredentials(d.credentials);
    setCredentialDraft(null);
    setPayoutAccount(d.payoutAccount);
    setTaxProfile(d.taxProfile);
    setTaxLegalName(d.taxLegalName);
    setTaxClassification(d.taxClassification);
    setTaxDraft(null);
    setCompletedJobsHistory(d.completedJobsHistory);
    setEarningsStatements(d.earningsStatements);
    setActiveJobs([]);
    setJobMessages({});
    setAvailableJobs(SIM_JOBS);
    setTab("home");
    setEarningsStack([{ view: "main" }]);
    setMyJobsStack([{ view: "list" }]);
    setMessagesStack([{ view: "list" }]);
    setProfileView("main");
    setEditDraft(null);
    setCategoriesDraft(null);
    setSelectedBucket(null);
    setEarningsPeriod("week");
    setLedgerCategoryFilter("all");
    setMaterialsDraft(null);
    setReceiptDraft(null);
    setMessageDraftText("");
    setSupportMessages([{ from: "support", text: "Hi! I'm here to help with anything Haven Pro related. What's up?", at: Date.now() }]);
    setSupportInput("");
  }
  function resetToFreshPro() {
    applyProDefaults(freshProDefaults());
    setAccountStatus("signed_out");
    setOnboardingStatus("not_started");
    setOnboardingStep("welcome");
    setAccountEmail("");
    setAccountPhone("");
    setAccountCreatedAt(null);
    setEmailVerifyStatus("not_sent");
    setPhoneVerifyStatus("not_sent");
    setSignUpDraft({ firstName: "", lastName: "", email: "", phone: "", password: "", confirm: "" });
    showToast("Reset to fresh Pro (dev)");
  }
  function loadDemoPro() {
    applyProDefaults(demoProDefaults());
    setAccountStatus("signed_in");
    setOnboardingStatus("completed");
    setOnboardingStep("done");
    setAccountEmail("alex.rivera@example.com");
    setAccountPhone("(407) 555-0142");
    setEmailVerifyStatus("verified");
    setPhoneVerifyStatus("verified");
    setAccountCreatedAt(Date.now() - 400 * DAY_MS);
    showToast("Loaded demo Pro (dev)");
  }
  /* Dev shortcut only — skips straight to a ready-to-work state without
     walking through each onboarding step, for testing screens downstream
     of onboarding without re-doing it every time. */
  function devJumpToMarketplaceReady() {
    setAccountStatus("signed_in");
    if (!accountCreatedAt) setAccountCreatedAt(Date.now());
    if (!homeCity.trim()) setHomeCity("Orlando, FL");
    if (!firstName.trim()) setFirstName("Jordan");
    if (!lastName.trim()) setLastName("Ellis");
    if (workCategories.size === 0) setWorkCategories(new Set(DEFAULT_WORK_CATEGORIES));
    setIdentityVerification(v => ({ ...v, status: "verified", verifiedAt: Date.now() }));
    setBackgroundCheck(v => ({ ...v, status: "clear", clearedAt: Date.now() }));
    setPayoutAccount(v => ({ ...v, status: "enabled", payoutsEnabled: true, providerAccountId: v.providerAccountId || `acct_demo_${Math.floor(10000 + Math.random() * 89999)}`, last4: v.last4 || String(Math.floor(1000 + Math.random() * 8999)) }));
    setTaxProfile(v => ({ ...v, status: "verified" }));
    setOnboardingStatus("completed");
    setOnboardingStep("done");
    showToast("Jumped to Marketplace Ready (dev)");
  }

  function pushEarnings(view) { setEarningsStack(prev => [...prev, view]); }
  function popEarnings() { setEarningsStack(prev => (prev.length > 1 ? prev.slice(0, -1) : prev)); }
  const currentEarningsView = earningsStack[earningsStack.length - 1];

  function pushMyJobs(view) { setMyJobsStack(prev => [...prev, view]); }
  function popMyJobs() { setMyJobsStack(prev => (prev.length > 1 ? prev.slice(0, -1) : prev)); }
  const currentMyJobsView = myJobsStack[myJobsStack.length - 1];

  function pushMessages(view) { setMessagesStack(prev => [...prev, view]); }
  function popMessages() { setMessagesStack(prev => (prev.length > 1 ? prev.slice(0, -1) : prev)); }
  const currentMessagesView = messagesStack[messagesStack.length - 1];


  /* ── Swipe-right-to-go-back — same gesture as the Customer App. Only
     meaningful on a screen that has somewhere to go back to. ── */
  function swipeBackHandlers(onBack) {
    return {
      onTouchStart: e => { swipeStartX.current = e.touches[0].clientX; },
      onTouchEnd: e => {
        if (swipeStartX.current == null) return;
        const dx = e.changedTouches[0].clientX - swipeStartX.current;
        if (dx > 60) onBack();
        swipeStartX.current = null;
      },
    };
  }

  function showToast(msg) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  // Live on-the-job timer — only ticks every second while a job is actually
  // in_progress, so idle browsing doesn't force a re-render every second.
  useEffect(() => {
    if (!activeJobs.some(j => j.status === "in_progress")) return;
    const id = setInterval(() => setClockTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeJobs]);

  // Live location — only watched while a job is actually en_route, and only
  // to gate "I've Arrived" and power real turn-by-turn directions. Fails
  // silently (permission denied, no geolocation support, etc.) — the
  // fallbacks below treat "no location" the same as "can't verify," not as
  // a hard block, so the app still works for a pro who declines the prompt.
  useEffect(() => {
    if (!activeJobs.some(j => j.status === "en_route") || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      pos => setProLiveLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setProLiveLocation(null),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [activeJobs]);

  function isNearJob(job) {
    if (!proLiveLocation || job.lat == null || job.lng == null) return true; // can't verify — don't block
    return haversineMiles(proLiveLocation.lat, proLiveLocation.lng, job.lat, job.lng) <= ARRIVAL_THRESHOLD_MI;
  }

  /* ── Eligibility pipeline: geography (unconditional) -> work categories
     -> travel radius -> Emergency-only toggle. Grouping by category is
     the board's own structure, not a separate filter step. ── */
  const proState = stateOf(homeCity);
  const geoCategoryPassed = availableJobs.filter(j => stateOf(j.city) === proState && workCategories.has(j.category));
  // Treat missing distanceMi as eligible so backend jobs without simulated distances still surface.
  const eligibleJobs = geoCategoryPassed.filter(j => j.distanceMi == null || j.distanceMi <= travelRadius);
  const boardJobs = eligibleJobs.filter(j => !emergencyOnly || j.emergency);

  // Sections ordered by sectionOrder — defaults to the pro's own
  // work-category order, but is directly reorderable via tap-and-hold on
  // a section header, so the board can match how each pro actually works.
  const boardSections = sectionOrder
    .filter(name => workCategories.has(name))
    .map(name => CATEGORIES.find(c => c.name === name))
    .map(c => ({ ...c, jobs: boardJobs.filter(j => j.category === c.name) }))
    .filter(section => section.jobs.length > 0);

  function toggleSection(name) {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  function toggleCollapseAll() {
    const allNames = boardSections.map(s => s.name);
    const allCollapsed = allNames.length > 0 && allNames.every(n => collapsedSections.has(n));
    setCollapsedSections(allCollapsed ? new Set() : new Set(allNames));
  }

  function swapSections(nameA, nameB) {
    setSectionOrder(prev => {
      const next = [...prev];
      const iA = next.indexOf(nameA), iB = next.indexOf(nameB);
      if (iA === -1 || iB === -1) return prev;
      [next[iA], next[iB]] = [next[iB], next[iA]];
      return next;
    });
  }

  /* ── Tap-and-hold to reorder section headers. A short tap still
     collapses/expands; holding for ~450ms without much movement lifts
     the section, and dragging up/down swaps it with its visible
     neighbor each time the drag crosses a threshold. ── */
  function sectionTouchStart(e, name) {
    dragBaseY.current = e.touches[0].clientY;
    clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      setDraggingSection(name);
      suppressNextClick.current = true;
    }, 450);
  }
  function sectionTouchMove(e, name) {
    const y = e.touches[0].clientY;
    if (draggingSection === name) {
      e.preventDefault(); // belt-and-suspenders on top of user-select:none — stops selection/scroll mid-drag
      const dy = y - dragBaseY.current;
      const visibleNames = boardSections.map(s => s.name);
      const idx = visibleNames.indexOf(name);
      if (dy > 56 && idx < visibleNames.length - 1) {
        swapSections(name, visibleNames[idx + 1]);
        dragBaseY.current = y;
      } else if (dy < -56 && idx > 0) {
        swapSections(name, visibleNames[idx - 1]);
        dragBaseY.current = y;
      }
    } else if (Math.abs(y - dragBaseY.current) > 10) {
      clearTimeout(longPressTimer.current); // moved before the long-press fired — treat as a scroll, not a hold
    }
  }
  function sectionTouchEnd() {
    clearTimeout(longPressTimer.current);
    setDraggingSection(null);
  }
  function sectionClick(name) {
    if (suppressNextClick.current) { suppressNextClick.current = false; return; }
    toggleSection(name);
  }

  /* ── Job lifecycle — status vocabulary and transition ownership follow
     HAVEN_JOB_CONTRACT.md §2/§5 exactly. "posted" (available) → "en_route"
     is the Accept transition itself; there is no separate accepted-but-
     not-driving status, per the contract's explicit rejection of that.
     materials_requested → in_progress | inspection_completed is
     customer-triggered per the contract — since there's no live Customer
     App connection here, it's simulated: auto-resolves after a short
     delay, weighted toward approval, and every simulated resolution says
     so explicitly in its toast rather than pretending to be real. ── */
  async function acceptJob(job) {
    // Local/SIM guard — block when any active job exists across en_route/materials_requested/etc.
    if (hasBlockingActiveJob(activeJobs)) {
      showToast("Finish your current job to accept another.");
      return;
    }
    if (!marketplaceReady) {
      showToast("Complete your Haven Pro verification before accepting jobs.");
      setTab("profile");
      setProfileView("verificationCenter");
      return;
    }
    if (!online) { showToast("Go online to accept jobs"); return; }
    // If a backend is configured, claim there first and handle conflicts clearly
    const cfg = getSupabaseConfig();
    let backendClaimed = false;
    if (cfg && looksLikeUuid(job.id)) {
      if (acceptingJobId === job.id) return;
      setAcceptingJobId(job.id);
      try {
        const result = await claimJobOnSupabase(job);
        if (!result.ok) {
          if (result.conflict) {
            // Backend enforced one-active (or similar) — keep message crisp
            showToast("Finish your current job to accept another.");
          } else if (result.reason === "already_claimed") {
            showToast("This job was just taken by another pro.");
          } else {
            showToast("Unable to claim this job right now.");
          }
          // Best-effort refresh of posted jobs after a failed claim
          const refreshed = await fetchPostedJobsFromSupabase();
          if (refreshed) setAvailableJobs(refreshed);
          return;
        }
        backendClaimed = true;
      } finally {
        setAcceptingJobId(null);
      }
    }
    // Local accept (SIM-only or after successful backend claim)
    setAvailableJobs(prev => prev.filter(j => j.id !== job.id));
    setActiveJobs(prev => [
      ...prev,
      { ...job, status: "en_route", acceptedAt: Date.now(), jobNotes: "", beforePhoto: null, afterPhoto: null, backendClaimed },
    ]);
    setTab("jobs");
    setMyJobsStack([{ view: "detail", jobId: job.id }]);
    showToast(`Accepted — ${job.title}`);
  }

  function updateActiveJob(jobId, updates) {
    setActiveJobs(prev => prev.map(j => (j.id === jobId ? { ...j, ...updates } : j)));
  }
  function markArrived(jobId) { updateActiveJob(jobId, { status: "arrived", arrivedAt: Date.now() }); }
  function startDiagnosis(jobId) { updateActiveJob(jobId, { status: "diagnosing", diagnosingAt: Date.now() }); }
  function startWork(jobId) { updateActiveJob(jobId, { status: "in_progress", workStartedAt: Date.now() }); }

  function openMaterialsForm(jobId) {
    setMaterialsDraft({ jobId, items: [{ name: "", cost: "" }] });
    pushMyJobs({ view: "materials", jobId });
  }
  function cancelMaterialsForm() {
    setMaterialsDraft(null);
    popMyJobs();
  }
  function submitMaterialsRequest() {
    if (!materialsDraft) return;
    const { jobId, items } = materialsDraft;
    const cleanItems = items.filter(it => it.name.trim() && Number(it.cost) > 0);
    if (cleanItems.length === 0) { showToast("Add at least one item with a cost"); return; }
    const totalCost = cleanItems.reduce((sum, it) => sum + Number(it.cost), 0);
    // Snapshot current job to decide backend behavior before we mutate local state
    const current = activeJobs.find(j => j.id === jobId);
    const cfg = getSupabaseConfig();
    const isBackendJob = !!current && !!cfg && looksLikeUuid(current.id) && !!current.backendClaimed;
    updateActiveJob(jobId, { status: "materials_requested", materialsRequestedAt: Date.now(), pendingMaterialsRequest: { items: cleanItems, totalCost } });
    setMaterialsDraft(null);
    popMyJobs();
    showToast("Materials request sent — waiting on the customer");
    if (isBackendJob) {
      // Live path — do NOT start the local auto-resolution SIM; write to backend and rely on polling.
      bestEffortPatchMaterialsRequested(current, cleanItems, totalCost);
    } else {
      // Local-only SIM — keep existing auto-resolution
      const timer = setTimeout(() => resolveMaterialsAuto(jobId), 4500);
      materialsTimers.current[jobId] = timer;
    }
  }

  /* ── Receipt submission — the actual reimbursement gate. Approval only
     authorized the purchase; the pro must submit a receipt-verified real
     cost before anything is credited, per the corrected materials flow. ── */
  function openReceiptForm(jobId) {
    const job = activeJobs.find(j => j.id === jobId);
    const estimate = job && job.pendingMaterialsRequest ? job.pendingMaterialsRequest.totalCost : "";
    setReceiptDraft({ jobId, cost: estimate ? String(estimate) : "", photo: null });
    pushMyJobs({ view: "receipt", jobId });
  }
  function cancelReceiptForm() {
    setReceiptDraft(null);
    popMyJobs();
  }
  function submitReceipt() {
    if (!receiptDraft) return;
    const { jobId, cost, photo } = receiptDraft;
    if (!(Number(cost) > 0)) { showToast("Enter the actual amount you paid"); return; }
    if (!photo) { showToast("Attach a photo of the receipt"); return; }
    updateActiveJob(jobId, prevJobUpdatesForReceipt(jobId, Number(cost), photo));
    setReceiptDraft(null);
    popMyJobs();
    showToast("Receipt submitted — reimbursement added, job continues");
  }
  function prevJobUpdatesForReceipt(jobId, actualCost, photo) {
    const job = activeJobs.find(j => j.id === jobId);
    const already = (job && job.materialsReimbursed) || 0;
    return {
      status: "in_progress",
      workStartedAt: (job && job.workStartedAt) || Date.now(),
      materialsReimbursed: already + actualCost,
      materialsReceiptPhoto: photo,
      pendingMaterialsRequest: null,
    };
  }

  /* ── Message the customer — a per-job simulated thread. Auto-replies are
     canned, since there's no real customer or backend on the other end;
     the delay-then-reply pattern mirrors the materials auto-resolve flow,
     including reading the LATEST activeJobs via the ref so a reply doesn't
     fire against a job that's already completed by the time it lands. ── */
  function sendCustomerMessage(jobId) {
    const text = messageDraftText.trim();
    if (!text) return;
    setJobMessages(prev => ({ ...prev, [jobId]: [...(prev[jobId] || []), { from: "pro", text, at: Date.now() }] }));
    setMessageDraftText("");
    setTimeout(() => {
      const stillActive = activeJobsRef.current.some(j => j.id === jobId);
      if (!stillActive) return;
      const replies = ["Sounds good, thank you!", "Ok, see you soon!", "Got it, thanks for the update.", "Perfect, I'll be home.", "Thanks for letting me know!"];
      const reply = replies[Math.floor(Math.random() * replies.length)];
      setJobMessages(prev => ({ ...prev, [jobId]: [...(prev[jobId] || []), { from: "customer", text: reply, at: Date.now() }] }));
    }, 1800);
  }

  function sendSupportMessage() {
    const text = supportInput.trim();
    if (!text) return;
    setSupportMessages(prev => [...prev, { from: "pro", text, at: Date.now() }]);
    setSupportInput("");
    setTimeout(() => {
      const lower = text.toLowerCase();
      let reply = "Thanks for reaching out! This is a demo of Haven Support chat — a real team member will follow up here once this is connected to live support.";
      if (lower.includes("payout") || lower.includes("fee")) reply = "Your labor payout is fixed and shown before you accept — it's exactly what you receive, no fee deducted. Materials and tips are 100% yours too.";
      else if (lower.includes("material")) reply = "Once a customer approves your materials request, buy it, then submit the actual cost and a receipt photo in the app — you're reimbursed 100%.";
      else if (lower.includes("categor")) reply = "You can update your Work Categories anytime from Profile — only jobs in your enabled categories show up on your board.";
      setSupportMessages(prev => [...prev, { from: "support", text: reply, at: Date.now() }]);
    }, 1400);
  }

  function resolveMaterialsAuto(jobId) {
    delete materialsTimers.current[jobId];
    const job = activeJobsRef.current.find(j => j.id === jobId);
    if (!job || job.status !== "materials_requested") return; // job already moved on — nothing to resolve
    const approved = Math.random() < 0.7;
    if (approved) {
      // Approval authorizes the PURCHASE — it does not credit the estimate.
      // The pro still has to actually buy the materials and submit a
      // receipt-verified actual cost before anything is reimbursed.
      updateActiveJob(jobId, { status: "materials_approved" });
      showToast(`Customer approved materials for ${job.title} (simulated) — go ahead and purchase, then submit your receipt`);
    } else {
      setActiveJobs(prev => prev.filter(j => j.id !== jobId));
      const diagnosisPath = jobRequiresDiagnosis(job);
      if (diagnosisPath) {
        const hasInspectionFee = (job.inspectionFee || 0) > 0;
        const fee = hasInspectionFee ? job.inspectionFee : INSPECTION_VISIT_FEE;
        showToast(`Customer declined materials for ${job.title} (simulated) — Inspection Completed — Inspection Visit $${fee}`);
        finalizeJob({ ...job, inspectionFee: fee }, "inspection_completed");
      } else {
        const convenienceFee = CONVENIENCE_FEE;
        showToast(`Materials declined — job could not be completed — Convenience Fee $${convenienceFee}`);
        finalizeJob({ ...job, convenienceFee }, "materials_declined");
      }
      setMyJobsStack([{ view: "list" }]);
    }
  }

  function completeJob(jobId) {
    const job = activeJobs.find(j => j.id === jobId);
    if (!job) return;
    setActiveJobs(prev => prev.filter(j => j.id !== jobId));
    finalizeJob(job, "complete");
    setMyJobsStack([{ view: "list" }, { view: "jobComplete", jobId }]);
  }

  function finalizeJob(job, finalStatus) {
    const tipAmount = finalStatus === "complete" && Math.random() < 0.7 ? Math.round(job.payout * (0.05 + Math.random() * 0.15)) : 0;
    const actualDurationMs = job.workStartedAt ? Date.now() - job.workStartedAt : null;
    const record = {
      id: job.id, category: job.category, title: job.title, city: job.city,
      status: finalStatus,
      payout: job.payout,
      inspectionFee: job.inspectionFee || 0,
      convenienceFee: job.convenienceFee || 0,
      tipAmount, tipStatus: tipAmount > 0 ? "paid" : "notAdded",
      materialsReimbursed: job.materialsReimbursed || 0,
      materialsReceiptPhoto: job.materialsReceiptPhoto || null,
      durationMin: job.durationMin,
      actualDurationMin: actualDurationMs != null ? Math.round(actualDurationMs / 60000) : null,
      actualDurationMs,
      jobNotes: job.jobNotes || "",
      beforePhoto: job.beforePhoto || null,
      afterPhoto: job.afterPhoto || null,
      completedAt: Date.now(),
    };
    setCompletedJobsHistory(prev => [...prev, record]);
    generateEarningsStatement(record);
    if (finalStatus === "inspection_completed" || finalStatus === "materials_declined") {
      // fire-and-forget; local history is authoritative in the prototype
      bestEffortPatchTerminalStatus(job, finalStatus);
    }
    return record;
  }

  /* ── Job Earnings Statement — the canonical per-job financial record.
     Production shape: job finalizes -> backend creates this immutable
     record -> a server job renders a PDF -> a transactional email
     provider sends it -> delivery state is recorded. None of that backend
     exists here, so this simulates exactly those three steps (generated ->
     queued -> sent) without ever triggering a real email client, and never
     duplicates a statement for a job that already has one. */
  function generateEarningsStatement(record) {
    setEarningsStatements(prev => {
      if (prev.some(s => s.jobId === record.id)) return prev;
      const a = jobAmount(record);
      const statement = {
        id: `stmt_${record.id}`,
        jobId: record.id,
        proId: "demo-pro-alex",
        createdAt: Date.now(),
        financialSnapshot: { gross: a.gross, materials: a.materials, tip: a.tip, net: a.net, status: record.status },
        pdfUrl: null, // no real PDF generation in this prototype
        emailStatus: "pending",
        emailedAt: null,
      };
      return [...prev, statement];
    });
    setTimeout(() => {
      setEarningsStatements(prev => prev.map(s => (s.jobId === record.id && s.emailStatus === "pending" ? { ...s, emailStatus: "sent", emailedAt: Date.now() } : s)));
    }, 1500);
  }
  function resendEarningsStatement(jobId) {
    setEarningsStatements(prev => prev.map(s => (s.jobId === jobId ? { ...s, emailStatus: "pending" } : s)));
    showToast("Resending statement (simulated)");
    setTimeout(() => {
      setEarningsStatements(prev => prev.map(s => (s.jobId === jobId ? { ...s, emailStatus: "sent", emailedAt: Date.now() } : s)));
    }, 1200);
  }

  function openManageCategories() {
    setCategoriesDraft(new Set(workCategories));
    setProfileView("categories");
  }
  function saveCategories() {
    setWorkCategories(categoriesDraft);
    setProfileView("main");
    showToast("Work categories updated");
  }
  function cancelCategories() {
    setCategoriesDraft(null);
    setProfileView("main");
  }

  /* ── Identity Verification — production shape: Haven creates a session
     and hands off to the provider (Persona); it never decides "verified"
     itself. The visible ID/selfie steps are the CONCEPTUAL flow a hosted
     provider flow would show — submitting creates a provider session and
     waits. Only a DEV control (simulating the provider's webhook) can
     resolve it to a terminal state. ── */
  function startIdentityVerification() {
    setIdentityVerification(v => ({ ...v, status: "session_created", providerVerificationId: null }));
    setIdentityProgress({ idCaptured: false, selfieCaptured: false });
  }
  function submitIdentityVerification() {
    setIdentityVerification(v => ({ ...v, status: "pending", providerVerificationId: `persona_demo_${Math.floor(100000 + Math.random() * 899999)}` }));
    // Waits here for a provider webhook — see the Dev Testing panel below.
  }
  function retryIdentityVerification() {
    setIdentityVerification({ provider: "persona", providerVerificationId: null, status: "not_started", verifiedAt: null, failureReasonCode: null, recheckAt: null });
    setIdentityProgress({ idCaptured: false, selfieCaptured: false });
  }
  function devSetIdentityStatus(status) {
    setIdentityVerification(v => ({ ...v, status, verifiedAt: status === "verified" ? Date.now() : v.verifiedAt, failureReasonCode: status === "failed" ? "dev_simulated_mismatch" : null }));
  }

  /* ── Background Check — separate provider (Checkr) and separate consent
     step from identity. not_started and consent_required are distinct
     product/legal states: not_started means the pro hasn't begun;
     consent_required means screening is ready to proceed but the pro must
     review and authorize disclosures first — the consent UI only ever
     appears in that state, never earlier. "consider"/"disputed" exist
     because a real report isn't just pass/fail; Haven doesn't auto-resolve
     any of these. ── */
  function startBackgroundCheck() {
    setBackgroundCheck(v => ({ ...v, status: "consent_required" }));
  }
  function authorizeBackgroundCheck() {
    if (!backgroundConsent) { showToast("Check the consent box to authorize your background check"); return; }
    setBackgroundCheck(v => ({ ...v, status: "invited", providerReportId: `checkr_demo_${Math.floor(100000 + Math.random() * 899999)}` }));
    setTimeout(() => setBackgroundCheck(v => (v.status === "invited" ? { ...v, status: "pending" } : v)), 800);
    // Then waits for the provider's report — see the Dev Testing panel below.
  }
  function devSetBackgroundStatus(status) {
    setBackgroundCheck(v => ({ ...v, status, clearedAt: status === "clear" ? Date.now() : v.clearedAt }));
  }

  /* ── Professional Credentials — uploading never auto-verifies. A
     credential becomes verification_available once it has enough
     structured data (number + jurisdiction) for an adapter to check;
     verifyProfessionalCredential() is the adapter seam a real per-type
     source (e.g. Florida DBPR for FL trade licenses) would plug into. ── */
  function openAddCredential(type) {
    setCredentialDraft({ type, name: "", jurisdiction: "", number: "", expiration: "" });
  }
  function saveCredential() {
    const d = credentialDraft;
    if (!d.name.trim()) { showToast("Enter a name or title for this credential"); return; }
    const hasVerifiableData = !!(d.number.trim() && d.jurisdiction.trim());
    setCredentials(prev => [...prev, {
      id: `cred${Date.now()}`, type: d.type, name: d.name.trim(), jurisdiction: d.jurisdiction.trim(), number: d.number.trim(), expiration: d.expiration.trim(),
      status: hasVerifiableData ? "verification_available" : "self_reported", verificationSource: null, verifiedAt: null, expiresAt: null, providerReference: null,
    }]);
    setCredentialDraft(null);
    showToast("Credential added — self-reported until verified");
  }
  function removeCredential(id) { setCredentials(prev => prev.filter(c => c.id !== id)); }
  /* Adapter seam: in production this calls the real per-type/jurisdiction
     verification source. Today it just moves the credential to "pending"
     and waits — the actual result only ever comes from the Dev Testing
     panel, simulating that adapter's response. */
  function verifyProfessionalCredential(id) {
    setCredentials(prev => prev.map(c => (c.id === id ? { ...c, status: "pending" } : c)));
  }
  function devSetCredentialStatus(id, status) {
    setCredentials(prev => prev.map(c => (c.id === id
      ? { ...c, status, verifiedAt: status === "verified" ? Date.now() : c.verifiedAt, verificationSource: status === "verified" ? (c.jurisdiction ? `${c.jurisdiction} registry (simulated)` : "Issuer confirmation (simulated)") : c.verificationSource }
      : c)));
  }

  /* ── Payout Setup — Stripe-Connect-style: Haven never collects raw bank
     details or auto-enables an account. "Set Up Payouts" conceptually
     redirects to the provider's hosted onboarding; it comes back pending
     until the provider's webhook (simulated via Dev Testing) says enabled. ── */
  function startPayoutSetup() {
    setPayoutAccount(v => ({ ...v, status: "pending", providerAccountId: `acct_demo_${Math.floor(10000 + Math.random() * 89999)}`, requirementsDue: ["identity_document", "bank_account"] }));
  }
  function devSetPayoutStatus(status) {
    setPayoutAccount(v => ({
      ...v, status,
      payoutsEnabled: status === "enabled",
      requirementsDue: status === "enabled" ? [] : v.requirementsDue,
      last4: status === "enabled" ? String(Math.floor(1000 + Math.random() * 8999)) : v.last4,
    }));
  }

  /* ── Tax Information — no TIN is ever collected, only status + safe
     fields. Submitting conceptually hands off to the tax provider; it
     doesn't self-verify. ── */
  function openTaxInfo() {
    setTaxDraft({ legalName: taxLegalName, classification: taxClassification });
    setProfileView("taxInfo");
  }
  function submitTaxInfo() {
    if (!taxDraft.legalName.trim()) { showToast("Enter your legal name"); return; }
    setTaxLegalName(taxDraft.legalName.trim());
    setTaxClassification(taxDraft.classification);
    setTaxProfile(v => ({ ...v, status: "pending", providerReference: `tax_demo_${Math.floor(1000 + Math.random() * 8999)}` }));
    setTaxDraft(null);
    setProfileView("main");
    showToast("Submitted to tax provider for verification");
  }
  function cancelTaxInfo() { setTaxDraft(null); setProfileView("main"); }
  function devSetTaxStatus(status) { setTaxProfile(v => ({ ...v, status })); }

  function openEditProfile() {
    setEditDraft({ firstName, lastName, about, homeCity, avatarEmoji, avatarPhoto });
    setProfileView("edit");
  }
  function saveEditProfile() {
    setFirstName(editDraft.firstName);
    setLastName(editDraft.lastName);
    setAbout(editDraft.about);
    setHomeCity(editDraft.homeCity);
    setAvatarEmoji(editDraft.avatarEmoji);
    setAvatarPhoto(editDraft.avatarPhoto);
    setEditDraft(null);
    setProfileView("main");
    showToast("Profile updated");
  }
  function cancelEditProfile() {
    setEditDraft(null);
    setProfileView("main");
  }

  /* ── Bottom navigation ───────────────────────────────────────────── */
  function bottomNav() {
    const items = [
      { key: "home", label: "Home", icon: "🏠" },
      { key: "jobs", label: "My Jobs", icon: "🧰" },
      { key: "earnings", label: "Earnings", icon: "💰" },
      { key: "messages", label: "Messages", icon: "💬" },
      { key: "profile", label: "Profile", icon: "👷" },
    ];
    return (
      <div
        style={{
          // Fixed within the app frame so it never scrolls off-screen
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 30,
          display: "flex",
          borderTop: `1px solid ${T.bd}`,
          background: T.w,
          // Respect iOS home-indicator safe area
          padding: "8px 4px calc(10px + env(safe-area-inset-bottom))",
        }}
      >
        {items.map(it => {
          const active = tab === it.key;
          return (
            <button
              key={it.key}
              className="hp-tab-btn"
              onClick={() => goTab(it.key)}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 0" }}
            >
              <span style={{ fontSize: 20, opacity: active ? 1 : 0.55, filter: active ? "none" : "grayscale(35%)" }}>{it.icon}</span>
              <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, color: active ? T.pg : T.tm, fontFamily: FONT }}>{it.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  function pill(label, icon, active, onClick, key) {
    return (
      <button
        key={key}
        className="hp-chip"
        onClick={onClick}
        style={{
          flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "8px 13px", borderRadius: 12,
          border: `1.5px solid ${active ? T.pg : T.bd}`, background: active ? T.pgt : T.w, cursor: "pointer", fontFamily: FONT,
        }}
      >
        {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
        <span style={{ fontSize: 12.5, fontWeight: 700, color: active ? T.pgd : T.ts, whiteSpace: "nowrap" }}>{label}</span>
      </button>
    );
  }

  function emptyStateInfo() {
    if (workCategories.size === 0) {
      return { icon: "🗂️", title: "No categories selected", subtitle: "Choose the types of work you want to see.", ctaLabel: "Choose Categories", cta: () => { setTab("profile"); openManageCategories(); } };
    }
    if (geoCategoryPassed.length === 0) {
      return { icon: "📭", title: "No jobs available", subtitle: "No jobs are available in your area right now." };
    }
    if (eligibleJobs.length === 0) {
      return { icon: "📍", title: "Outside your travel radius", subtitle: "No matching jobs are currently within your travel radius." };
    }
    return { icon: "🚨", title: "No emergency jobs", subtitle: "No emergency jobs are available in your area right now." };
  }

  /* ── Compact Trade Board job card — smaller than a hero card so several
     fit per category section, but still leads with the exact labor payout
     and never hides the Inspection Visit line. ── */
  function tradeBoardCard(job) {
    const diagnosis = jobRequiresDiagnosis(job);
    const blockedLabel = hasBlockingActiveJob(activeJobs) ? "Finish Current Job First" : !marketplaceReady ? "Complete Verification" : !online ? "Go Online to Accept" : null;
    const disabled = !!blockedLabel || acceptingJobId === job.id;
    return (
      <div key={job.id} style={{ background: T.w, borderRadius: 16, padding: 14, marginBottom: 8, border: `1px solid ${T.bd}` }}>
        {(job.emergency || diagnosis) && (
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            {job.emergency && <span style={{ fontSize: 11, fontWeight: 700, color: T.emTx, background: T.emBg, border: `1px solid ${T.emBd}`, borderRadius: 9, padding: "5px 9px" }}>🚨 Emergency</span>}
            {diagnosis && <span style={{ fontSize: 11, fontWeight: 700, color: T.dxTx, background: T.dxBg, border: `1px solid ${T.dxBd}`, borderRadius: 9, padding: "5px 9px" }}>🔍 Diagnosis Required</span>}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.tx, fontFamily: FONT }}>{job.title}</div>
            {(() => {
              const parts = [];
              if (job.distanceMi != null) parts.push(`📍 ${job.distanceMi} mi`);
              if (job.durationMin != null) parts.push(`⏱ ~${job.durationMin} min`);
              return parts.length > 0
                ? <div style={{ fontSize: 11.5, fontWeight: 500, color: T.ts, fontFamily: FONT, marginTop: 1 }}>{parts.join(" · ")}</div>
                : null;
            })()}
          </div>
          <div style={{ fontSize: 21, fontWeight: 900, color: T.pg, fontFamily: FONT, letterSpacing: -0.4, flexShrink: 0, marginLeft: 10 }}>${job.payout}</div>
        </div>
        {diagnosis && job.inspectionFee != null && (
          <div style={{ fontSize: 11, fontWeight: 600, color: T.ts, fontFamily: FONT, marginBottom: 6 }}>
            Inspection Visit: ${job.inspectionFee} if repair can't proceed
          </div>
        )}
        <div style={{ fontSize: 10.5, fontWeight: 600, color: T.tm, fontFamily: FONT, marginBottom: 10 }}>
          📅 {job.requested} · 🕐 {formatJobAge(job.postedAt, now)}
        </div>
        <button
          className="hp-accept-btn"
          onClick={disabled ? undefined : () => acceptJob(job)}
          style={{
            width: "100%", padding: "10px 0", borderRadius: 12, border: "none", fontSize: 13.5, fontWeight: 800, fontFamily: FONT,
            cursor: "pointer", color: disabled ? T.tm : "#FFFFFF", background: disabled ? T.soonBg : T.pgb,
          }}
        >
          {blockedLabel || (acceptingJobId === job.id ? "Accepting…" : "Accept Job")}
        </button>
      </div>
    );
  }

  /* ── Home screen — Trade Board: jobs grouped by category so a pro can
     scan their own trade(s) directly instead of a mixed list. Category
     order follows the pro's own work-category order (neutral for now;
     becomes the hook for a customizable priority order later). ── */
  function homeScreen() {
    const empty = boardSections.length === 0 ? emptyStateInfo() : null;
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "28px 20px 0" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ts, fontFamily: FONT, letterSpacing: 0.2 }}>HAVEN PRO</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: T.tx, fontFamily: FONT, marginTop: 2, marginBottom: 16 }}>Good afternoon</div>

          <button
            className="hp-toggle"
            onClick={() => setOnline(o => !o)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", border: "none", cursor: "pointer", borderRadius: 18, padding: "16px 18px", marginBottom: 14, background: online ? T.pg : T.soonBg, transition: "background .18s ease" }}
          >
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: online ? "#FFFFFF" : T.tx, fontFamily: FONT }}>{online ? "You're Online" : "You're Offline"}</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: online ? "rgba(255,255,255,.78)" : T.ts, fontFamily: FONT, marginTop: 1 }}>{online ? "You can accept jobs" : "Browsing only — go online to accept"}</div>
            </div>
            <div style={{ width: 46, height: 27, borderRadius: 20, background: online ? "rgba(255,255,255,.28)" : T.bd, position: "relative", flexShrink: 0, transition: "background .18s ease" }}>
              <div style={{ position: "absolute", top: 2.5, left: online ? 21 : 2.5, width: 22, height: 22, borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 1px 3px rgba(0,0,0,.25)", transition: "left .18s ease" }} />
            </div>
          </button>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 8 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: T.tx, fontFamily: FONT, flexShrink: 0 }}>Job Board</div>
            <button
              onClick={toggleCollapseAll}
              className="hp-chip"
              style={{ display: "flex", alignItems: "center", gap: 5, border: `1px solid ${T.bd}`, background: "transparent", borderRadius: 10, padding: "6px 10px", cursor: "pointer" }}
            >
              <span style={{ fontSize: 11 }}>{boardSections.length > 0 && boardSections.every(s => collapsedSections.has(s.name)) ? "⊞" : "⊟"}</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: T.ts, fontFamily: FONT, whiteSpace: "nowrap" }}>
                {boardSections.length > 0 && boardSections.every(s => collapsedSections.has(s.name)) ? "Expand All" : "Collapse All"}
              </span>
            </button>
            {pill("Emergency", "🚨", emergencyOnly, () => setEmergencyOnly(v => !v), "emergency-toggle")}
          </div>
        </div>

        <div className="hp-scroll" style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
          {boardSections.length > 0 ? (
            boardSections.map(section => {
              const collapsed = collapsedSections.has(section.name);
              const dragging = draggingSection === section.name;
              return (
                <div key={section.name} style={{ marginBottom: 12, position: "relative", zIndex: dragging ? 5 : 1 }}>
                  <button
                    onClick={() => sectionClick(section.name)}
                    onTouchStart={e => sectionTouchStart(e, section.name)}
                    onTouchMove={e => sectionTouchMove(e, section.name)}
                    onTouchEnd={sectionTouchEnd}
                    style={{
                      width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                      background: T.pgt, border: "none", borderRadius: 12, padding: "11px 13px", marginBottom: collapsed ? 0 : 8, cursor: "pointer",
                      boxShadow: dragging ? "0 8px 20px rgba(15,110,78,.30)" : "none",
                      transform: dragging ? "scale(1.03)" : "scale(1)",
                      transition: dragging ? "none" : "transform .15s ease",
                      WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none", touchAction: "none",
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 800, color: T.pgd, fontFamily: FONT, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ opacity: 0.5, fontSize: 12 }}>⠿</span>
                      {section.icon} {section.name} ({section.jobs.length})
                    </span>
                    <span style={{ fontSize: 14, color: T.pgd }}>{collapsed ? "›" : "⌄"}</span>
                  </button>
                  {!collapsed && (
                    <div style={{ paddingLeft: 4 }}>
                      {section.jobs.map(tradeBoardCard)}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "50px 16px" }}>
              <div style={{ width: 56, height: 56, borderRadius: 18, background: T.pgt, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, marginBottom: 14 }}>{empty.icon}</div>
              <div style={{ fontSize: 15.5, fontWeight: 800, color: T.tx, fontFamily: FONT, marginBottom: 4 }}>{empty.title}</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: T.ts, fontFamily: FONT, marginBottom: 14, maxWidth: 260 }}>{empty.subtitle}</div>
              {empty.cta && (
                <button onClick={empty.cta} style={{ border: "none", background: T.pg, color: "#FFF", fontWeight: 700, fontSize: 13, fontFamily: FONT, cursor: "pointer", padding: "10px 18px", borderRadius: 12 }}>
                  {empty.ctaLabel}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  function emptyState(icon, title, subtitle) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "60px 30px" }}>
        <div style={{ width: 64, height: 64, borderRadius: 20, background: T.pgt, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, marginBottom: 16 }}>{icon}</div>
        <div style={{ fontSize: 17, fontWeight: 800, color: T.tx, fontFamily: FONT, marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: T.ts, fontFamily: FONT, lineHeight: 1.5, maxWidth: 260 }}>{subtitle}</div>
      </div>
    );
  }

  /* ── Inline primary action(s) for a job's current status — same set used
     on the compact My Jobs card and the full detail screen, so behavior
     never diverges between the two. ── */
  function statusActions(job) {
    const diagnosis = jobRequiresDiagnosis(job);
    const btnStyle = (primary) => ({
      flex: 1, padding: "12px 18px", borderRadius: 12, border: "none", fontSize: 13.5, fontWeight: 800, fontFamily: FONT, cursor: "pointer",
      color: primary ? "#FFFFFF" : T.pg, background: primary ? T.pgb : T.pgt, textAlign: "center",
    });
    if (job.status === "en_route") {
      if (isNearJob(job)) {
        return <button style={btnStyle(true)} onClick={() => markArrived(job.id)}>I've Arrived</button>;
      }
      const dist = proLiveLocation && job.lat != null ? haversineMiles(proLiveLocation.lat, proLiveLocation.lng, job.lat, job.lng) : null;
      return (
        <div style={{ textAlign: "center", padding: "10px 0", fontSize: 12.5, fontWeight: 700, color: T.tm, fontFamily: FONT }}>
          🚗 {dist != null ? `${dist.toFixed(1)} mi to go — ` : ""}keep driving to confirm arrival
        </div>
      );
    }
    if (job.status === "arrived") {
      return diagnosis
        ? <button style={btnStyle(true)} onClick={() => startDiagnosis(job.id)}>Start Diagnosis</button>
        : <button style={btnStyle(true)} onClick={() => startWork(job.id)}>Start Job</button>;
    }
    if (job.status === "diagnosing") {
      return (
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btnStyle(true)} onClick={() => startWork(job.id)}>Start Job</button>
          <button style={btnStyle(false)} onClick={() => openMaterialsForm(job.id)}>Request Materials</button>
        </div>
      );
    }
    if (job.status === "materials_requested") {
      return <div style={{ textAlign: "center", padding: "10px 0", fontSize: 12.5, fontWeight: 700, color: T.tm, fontFamily: FONT }}>⏳ Waiting on customer response…</div>;
    }
    if (job.status === "materials_approved") {
      return (
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: T.ts, fontFamily: FONT, marginBottom: 8, textAlign: "center" }}>Approved to purchase — go buy it, then submit your receipt to get reimbursed.</div>
          <button style={{ ...btnStyle(true), width: "100%" }} onClick={() => openReceiptForm(job.id)}>Submit Receipt</button>
        </div>
      );
    }
    if (job.status === "in_progress") {
      return (
        <div>
          <button style={{ ...btnStyle(true), width: "100%", marginBottom: 8 }} onClick={() => pushMyJobs({ view: "completionReview", jobId: job.id })}>Mark Complete</button>
          <button onClick={() => openMaterialsForm(job.id)} style={{ width: "100%", border: "none", background: "none", color: T.ts, fontSize: 12, fontWeight: 700, fontFamily: FONT, cursor: "pointer", padding: 0 }}>Need materials? Request them</button>
        </div>
      );
    }
    return null;
  }

  function myJobsCard(job) {
    return (
      <div key={job.id} style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 16, padding: 14, marginBottom: 10 }}>
        <div onClick={() => pushMyJobs({ view: "detail", jobId: job.id })} style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.tx, fontFamily: FONT }}>{iconFor(job.category)} {job.title}</div>
            <div style={{ fontSize: 11.5, fontWeight: 500, color: T.ts, fontFamily: FONT, marginTop: 2 }}>{job.category} · {job.city}</div>
          </div>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: T.pgd, background: T.pgt, borderRadius: 9, padding: "5px 10px", whiteSpace: "nowrap" }}>{STATUS_LABELS[job.status]}</span>
        </div>
        {statusActions(job)}
      </div>
    );
  }

  function myJobsListScreen() {
    if (activeJobs.length === 0) {
      return (<div style={{ flex: 1, display: "flex", flexDirection: "column" }}>{screenHeader("My Jobs")}{emptyState("🧰", "No active jobs yet", "Accepted jobs will show up here — from driving to the site all the way through payout.")}</div>);
    }
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }}>
        {screenHeader("My Jobs")}
        <div style={{ padding: "0 20px 32px" }}>
          {activeJobs.map(myJobsCard)}
        </div>
      </div>
    );
  }

  /* ── Simulated map for en-route navigation — decorative route visual,
     plus a real, working "Open in Maps" link (city-level only, since
     that's all the job data carries pre-full-address). ── */
  function mapPanel(job) {
    const hasDestCoords = job.lat != null && job.lng != null;
    const destination = hasDestCoords ? `${job.lat},${job.lng}` : job.city;
    const hasOrigin = !!proLiveLocation;
    const mapsUrl = hasOrigin
      ? `https://www.google.com/maps/dir/?api=1&origin=${proLiveLocation.lat},${proLiveLocation.lng}&destination=${encodeURIComponent(destination)}&travelmode=driving`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`;
    return (
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: "block", borderRadius: 18, overflow: "hidden", marginBottom: 16, border: `1px solid ${T.bd}`, textDecoration: "none", cursor: "pointer" }}
      >
        <div style={{ height: 140, position: "relative", background: "linear-gradient(135deg, #DCE6DF, #C9D6CC)" }}>
          <svg width="100%" height="100%" viewBox="0 0 300 140" style={{ position: "absolute", inset: 0 }} preserveAspectRatio="none">
            <path d="M 40 110 Q 130 40 260 50" stroke="#0F6E4E" strokeWidth="3" strokeDasharray="7 7" fill="none" opacity="0.65" />
            <circle cx="40" cy="110" r="7" fill="#16211D" />
            <circle cx="260" cy="50" r="9" fill="#16A34A" stroke="#fff" strokeWidth="3" />
          </svg>
          <div style={{ position: "absolute", top: 10, left: 10, background: "#fff", borderRadius: 10, padding: "6px 10px", fontSize: 11, fontWeight: 700, color: T.tx, boxShadow: "0 2px 8px rgba(0,0,0,.12)" }}>
            📍 {hasOrigin ? `Directions to ${job.city}` : `Navigating to ${job.city}`}
          </div>
          <div style={{ position: "absolute", bottom: 10, right: 10, background: "rgba(255,255,255,.92)", borderRadius: 8, padding: "4px 9px", fontSize: 10, fontWeight: 700, color: T.pgd }}>
            Tap to expand ↗
          </div>
        </div>
        <div style={{ display: "block", textAlign: "center", padding: "12px 0", background: T.pgb, color: "#fff", fontSize: 13.5, fontWeight: 800, fontFamily: FONT }}>
          🗺️ {hasOrigin ? "Get Directions" : "Open in Maps"}
        </div>
      </a>
    );
  }

  function formatElapsed(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function timerPanel(job) {
    const elapsed = clockTick - job.workStartedAt;
    return (
      <div style={{ background: T.pgt, borderRadius: 18, padding: 20, marginBottom: 16, textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: T.pgd, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>Time On Job</div>
        <div style={{ fontSize: 34, fontWeight: 900, color: T.pgd, fontFamily: FONT, letterSpacing: 1 }}>{formatElapsed(elapsed)}</div>
      </div>
    );
  }

  /* Optional before/after photo — sandbox/local only (FileReader data URL),
     architecture anticipates real backend storage later. Never mandatory. */
  function photoUploadSlot(job, field, label) {
    function handleUpload(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => updateActiveJob(job.id, { [field]: ev.target.result });
      reader.readAsDataURL(file);
    }
    const photo = job[field];
    return (
      <label style={{ flex: 1, cursor: "pointer" }}>
        <input type="file" accept="image/*" onChange={handleUpload} style={{ display: "none" }} />
        <div style={{ width: "100%", aspectRatio: "1", borderRadius: 12, border: `1px dashed ${T.bd}`, background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          {photo ? <img src={photo} alt={label} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 20 }}>📷</span>}
        </div>
        <div style={{ textAlign: "center", fontSize: 10.5, fontWeight: 700, color: T.ts, fontFamily: FONT, marginTop: 4 }}>{photo ? `${label} ✓` : label}</div>
      </label>
    );
  }

  function activeJobDetailScreen(jobId) {
    const job = activeJobs.find(j => j.id === jobId);
    if (!job) return myJobsListScreen();
    const diagnosis = jobRequiresDiagnosis(job);
    const steps = diagnosis
      ? ["en_route", "arrived", "diagnosing", "in_progress", "complete"]
      : ["en_route", "arrived", "in_progress", "complete"];
    const stepLabel = { en_route: "Driving", arrived: "Arrived", diagnosing: "Diagnosing", in_progress: "Working", complete: "Complete" };
    const materialsAnchorStep = diagnosis ? "diagnosing" : "in_progress"; // standard jobs can only hit materials while already in_progress
    const materialsMidflight = job.status === "materials_requested" || job.status === "materials_approved";
    const currentIdx = materialsMidflight ? steps.indexOf(materialsAnchorStep) + 0.5 : steps.indexOf(job.status);
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }} {...swipeBackHandlers(popMyJobs)}>
        {backHeader(job.title, popMyJobs)}
        <div style={{ padding: "0 20px 32px" }}>
          {job.status === "en_route" && mapPanel(job)}
          {job.status === "in_progress" && timerPanel(job)}
          <div style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 18, padding: 18, marginBottom: 16 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ts, fontFamily: FONT, marginBottom: 10 }}>{job.category} · {job.city}</div>
            <div style={{ fontSize: 11, fontWeight: 800, color: T.ts, textTransform: "uppercase", letterSpacing: 0.3 }}>Labor Payout</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: T.pg, fontFamily: FONT, marginBottom: diagnosis ? 6 : 12 }}>${job.payout}</div>
            {diagnosis && job.inspectionFee != null && <div style={{ fontSize: 12, fontWeight: 600, color: T.ts, fontFamily: FONT, marginBottom: 12 }}>Inspection Visit: ${job.inspectionFee} if the repair can't proceed</div>}
            <div style={{ display: "flex", gap: 18 }}>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: T.tm, textTransform: "uppercase" }}>Distance</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginTop: 2 }}>{job.distanceMi != null ? `📍 ${job.distanceMi} mi` : "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: T.tm, textTransform: "uppercase" }}>Requested</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginTop: 2 }}>📅 {job.requested}</div>
              </div>
            </div>
          </div>

          <button
            onClick={() => { setTab("messages"); setMessagesStack([{ view: "thread", jobId: job.id }]); }}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "13px 0", borderRadius: 14, border: `1px solid ${T.bd}`, background: T.w, color: T.tx, fontSize: 13.5, fontWeight: 800, fontFamily: FONT, cursor: "pointer", marginBottom: 16 }}
          >
            💬 Message {job.customerName}
          </button>

          {job.status === "in_progress" && (
            <div style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 18, padding: 18, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: T.ts, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 10 }}>Job Notes (Optional)</div>
              <textarea
                value={job.jobNotes || ""}
                onChange={e => updateActiveJob(job.id, { jobNotes: e.target.value })}
                placeholder="e.g. Replaced worn fill valve. Customer asked me to leave old part in garage."
                rows={2}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${T.bd}`, background: T.bg, color: T.tx, fontSize: 13, fontFamily: FONT, outline: "none", resize: "none", marginBottom: 14 }}
              />
              <div style={{ fontSize: 12, fontWeight: 800, color: T.ts, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 10 }}>Photos (Optional)</div>
              <div style={{ display: "flex", gap: 10 }}>
                {photoUploadSlot(job, "beforePhoto", "Before")}
                {photoUploadSlot(job, "afterPhoto", "After")}
              </div>
            </div>
          )}

          <div style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 18, padding: 18, marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: T.ts, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 12 }}>Progress</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {steps.map((s, i) => {
                const done = i < currentIdx;
                const current = i === Math.floor(currentIdx) && job.status !== "complete";
                return (
                  <div key={s} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: done || current ? T.pg : T.bd, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                      {done ? "✓" : i + 1}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: current ? 800 : 600, color: current ? T.tx : done ? T.ts : T.tm }}>{stepLabel[s]}</span>
                    {materialsMidflight && s === materialsAnchorStep && (
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: T.dxTx, background: T.dxBg, borderRadius: 8, padding: "5px 9px", marginLeft: 4 }}>
                        {job.status === "materials_requested" ? "Materials Requested" : "Approved — Get Receipt"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {statusActions(job)}
        </div>
      </div>
    );
  }

  function materialsFormScreen() {
    if (!materialsDraft) return myJobsListScreen();
    const job = activeJobs.find(j => j.id === materialsDraft.jobId);
    function updateItem(i, field, value) {
      setMaterialsDraft(prev => ({ ...prev, items: prev.items.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)) }));
    }
    function addItem() { setMaterialsDraft(prev => ({ ...prev, items: [...prev.items, { name: "", cost: "" }] })); }
    function removeItem(i) { setMaterialsDraft(prev => ({ ...prev, items: prev.items.filter((_, idx) => idx !== i) })); }
    const total = materialsDraft.items.reduce((sum, it) => sum + (Number(it.cost) || 0), 0);
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }} {...swipeBackHandlers(cancelMaterialsForm)}>
        {backHeader("Request Materials", cancelMaterialsForm)}
        <div style={{ padding: "0 20px 32px" }}>
          {job && <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ts, fontFamily: FONT, marginBottom: 16 }}>For {job.title} — the customer reviews and approves this before you buy anything. 100% of approved cost is reimbursed to you.</div>}
          {materialsDraft.items.map((it, i) => (
            <div key={i} style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 14, padding: 14, marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: T.ts, fontFamily: FONT, textTransform: "uppercase" }}>Item {i + 1}</div>
                {materialsDraft.items.length > 1 && <button onClick={() => removeItem(i)} style={{ border: "none", background: "none", color: T.ts, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Remove</button>}
              </div>
              <input
                value={it.name}
                onChange={e => updateItem(i, "name", e.target.value)}
                placeholder="Material name"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${T.bd}`, background: T.bg, color: T.tx, fontSize: 13.5, fontFamily: FONT, outline: "none", marginBottom: 8 }}
              />
              <input
                value={it.cost}
                onChange={e => updateItem(i, "cost", e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="Cost ($)"
                inputMode="decimal"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${T.bd}`, background: T.bg, color: T.tx, fontSize: 13.5, fontFamily: FONT, outline: "none" }}
              />
            </div>
          ))}
          <button onClick={addItem} style={{ width: "100%", border: `1px dashed ${T.bd}`, background: "transparent", color: T.ts, fontSize: 12.5, fontWeight: 700, fontFamily: FONT, cursor: "pointer", padding: "10px 0", borderRadius: 12, marginBottom: 16 }}>+ Add another item</button>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.tx, fontFamily: FONT }}>Total</span>
            <span style={{ fontSize: 18, fontWeight: 900, color: T.pg, fontFamily: FONT }}>${total.toFixed(2).replace(/\.00$/, "")}</span>
          </div>
          <button onClick={submitMaterialsRequest} style={{ width: "100%", padding: "13px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}>Submit Request</button>
        </div>
      </div>
    );
  }

  function receiptFormScreen() {
    if (!receiptDraft) return myJobsListScreen();
    const job = activeJobs.find(j => j.id === receiptDraft.jobId);
    function set(field, value) { setReceiptDraft(prev => ({ ...prev, [field]: value })); }
    function handleReceiptUpload(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => set("photo", reader.result);
      reader.readAsDataURL(file);
    }
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }} {...swipeBackHandlers(cancelReceiptForm)}>
        {backHeader("Submit Receipt", cancelReceiptForm)}
        <div style={{ padding: "0 20px 32px" }}>
          {job && (
            <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ts, fontFamily: FONT, marginBottom: 16, lineHeight: 1.5 }}>
              For {job.title}. Enter what you actually paid — it can differ from the estimate — and attach a photo of the receipt. The customer covers this cost; it's reimbursed to you 100%, no platform fee.
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.ts, fontFamily: FONT, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 }}>Actual Cost Paid</div>
            <input
              value={receiptDraft.cost}
              onChange={e => set("cost", e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="$"
              inputMode="decimal"
              style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${T.bd}`, background: T.w, color: T.tx, fontSize: 14, fontFamily: FONT, outline: "none" }}
            />
          </div>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.ts, fontFamily: FONT, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.3 }}>Receipt Photo</div>
            {receiptDraft.photo ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <img src={receiptDraft.photo} alt="Receipt" style={{ width: 64, height: 64, borderRadius: 12, objectFit: "cover", border: `1px solid ${T.bd}` }} />
                <label style={{ padding: "9px 14px", borderRadius: 10, border: `1px solid ${T.pg}`, color: T.pg, fontSize: 12.5, fontWeight: 700, fontFamily: FONT, cursor: "pointer" }}>
                  Replace
                  <input type="file" accept="image/*" onChange={handleReceiptUpload} style={{ display: "none" }} />
                </label>
              </div>
            ) : (
              <label style={{ display: "block", textAlign: "center", padding: "18px 0", borderRadius: 14, border: `1.5px dashed ${T.bd}`, color: T.ts, fontSize: 13, fontWeight: 700, fontFamily: FONT, cursor: "pointer" }}>
                📷 Attach Receipt Photo
                <input type="file" accept="image/*" onChange={handleReceiptUpload} style={{ display: "none" }} />
              </label>
            )}
          </div>
          <button onClick={submitReceipt} style={{ width: "100%", padding: "13px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}>Submit Receipt</button>
        </div>
      </div>
    );
  }

  function jobCompleteScreen(jobId) {
    const job = completedJobsHistory.find(j => j.id === jobId);
    if (!job) return myJobsListScreen();
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ padding: "28px 20px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: T.tx, fontFamily: FONT }}>Job Complete!</div>
        </div>
        <div style={{ padding: "0 20px 32px" }}>
          {job.actualDurationMs != null && (
            <div style={{ background: T.pgt, borderRadius: 18, padding: 18, marginBottom: 16, textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: T.pgd, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>Exact Time On Job</div>
              <div style={{ fontSize: 30, fontWeight: 900, color: T.pgd, fontFamily: FONT, letterSpacing: 1 }}>{formatElapsed(job.actualDurationMs)}</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: T.pgd, opacity: 0.75, marginTop: 4 }}>Estimated ~{job.durationMin} min</div>
            </div>
          )}
          {earningsStatementBody(job)}
          <button
            onClick={() => goTab("earnings")}
            style={{ width: "100%", marginTop: 16, padding: "13px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}
          >
            See Earnings
          </button>
        </div>
      </div>
    );
  }

  function completionReviewScreen(jobId) {
    const job = activeJobs.find(j => j.id === jobId);
    if (!job) return myJobsListScreen();
    const isInspectionPath = false; // review only ever precedes a full "complete" — inspection_completed comes from the materials-decline path, which doesn't go through review
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }} {...swipeBackHandlers(popMyJobs)}>
        {backHeader("Review & Complete", popMyJobs)}
        <div style={{ padding: "0 20px 32px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: T.ts, fontFamily: FONT, marginBottom: 18, lineHeight: 1.5 }}>
            Take a second look before you close this one out.
          </div>
          <div style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 18, padding: 18, marginBottom: 16 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: T.tx, fontFamily: FONT }}>{iconFor(job.category)} {job.title}</div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: T.ts, fontFamily: FONT, marginTop: 2, marginBottom: 14 }}>{job.category} · {job.city}</div>

            {job.jobNotes && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: T.ts, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>Job Notes</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: T.tx, fontFamily: FONT, lineHeight: 1.4 }}>{job.jobNotes}</div>
              </div>
            )}

            {(job.beforePhoto || job.afterPhoto) && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: T.ts, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>Photos</div>
                <div style={{ display: "flex", gap: 10 }}>
                  {job.beforePhoto && <img src={job.beforePhoto} alt="Before" style={{ width: 64, height: 64, borderRadius: 10, objectFit: "cover", border: `1px solid ${T.bd}` }} />}
                  {job.afterPhoto && <img src={job.afterPhoto} alt="After" style={{ width: 64, height: 64, borderRadius: 10, objectFit: "cover", border: `1px solid ${T.bd}` }} />}
                </div>
              </div>
            )}

            <div style={{ borderTop: `1px solid ${T.bd}`, paddingTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.tx, fontFamily: FONT }}>Labor Payout</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.tx, fontFamily: FONT }}>${job.payout}</span>
              </div>
              {job.materialsReimbursed > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.tx, fontFamily: FONT }}>Materials Reimbursed</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.tx, fontFamily: FONT }}>+${job.materialsReimbursed}</span>
                </div>
              )}
              <div style={{ fontSize: 10.5, fontWeight: 500, color: T.tm, fontFamily: FONT, marginTop: 8, lineHeight: 1.4 }}>
                Any tip will show up on your Job Earnings Statement once this job is complete — it isn't decided yet.
              </div>
            </div>
          </div>

          <button
            onClick={() => completeJob(jobId)}
            style={{ width: "100%", padding: "14px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 15, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}
          >
            Complete Job
          </button>
        </div>
      </div>
    );
  }

  function jobsScreen() {
    const v = currentMyJobsView;
    if (v.view === "detail") return activeJobDetailScreen(v.jobId);
    if (v.view === "materials") return materialsFormScreen();
    if (v.view === "receipt") return receiptFormScreen();
    if (v.view === "completionReview") return completionReviewScreen(v.jobId);
    if (v.view === "jobComplete") return jobCompleteScreen(v.jobId);
    return myJobsListScreen();
  }

  function monthKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}`; }
  function monthLabel(ts) { return new Date(ts).toLocaleDateString(undefined, { month: "long", year: "numeric" }); }
  function formatWeekRange(weekStartTs) {
    const fmt = ts => {
      const d = new Date(ts);
      return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
    };
    return `${fmt(weekStartTs)} - ${fmt(weekStartTs + 6 * DAY_MS)}`;
  }
  function formatDayHeading(ts) {
    return new Date(ts).toLocaleDateString(undefined, { weekday: "long", month: "numeric", day: "numeric" });
  }

  /* ── Swipeable earnings period panel — Week / Month / Year, each bucketed
     at a different granularity (day / week-of-month / month-of-year) so
     zooming out always shows a sensible number of bars. Every bucket is
     just a time range; clicking one swaps the ledger below to that range's
     jobs, regardless of which period produced it. ── */
  function computeWeekBuckets(ts) {
    const weekStart = startOfWeek(ts);
    const letters = ["S", "M", "T", "W", "T", "F", "S"];
    const buckets = letters.map((label, i) => {
      const start = weekStart + i * DAY_MS;
      const end = start + DAY_MS;
      const total = completedJobsHistory.filter(j => j.completedAt >= start && j.completedAt < end).reduce((s, j) => s + jobAmount(j).net, 0);
      return { label, start, end, total, fullLabel: `${formatDayHeading(start)} Completed Jobs`, shortLabel: formatShortDate(start) };
    });
    return { buckets, rangeLabel: formatWeekRange(weekStart), highlightIndex: new Date(ts).getDay() };
  }
  function computeMonthBuckets(ts) {
    const d = new Date(ts);
    const year = d.getFullYear(), month = d.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const numBuckets = Math.ceil(daysInMonth / 7);
    const buckets = [];
    for (let i = 0; i < numBuckets; i++) {
      const startDay = i * 7 + 1;
      const endDay = Math.min(startDay + 7, daysInMonth + 1);
      const start = new Date(year, month, startDay).getTime();
      const end = new Date(year, month, endDay).getTime();
      const total = completedJobsHistory.filter(j => j.completedAt >= start && j.completedAt < end).reduce((s, j) => s + jobAmount(j).net, 0);
      const startD = new Date(start), endD = new Date(end - DAY_MS);
      const fullLabel = `${startD.toLocaleDateString(undefined, { month: "short", day: "numeric" })}–${endD.toLocaleDateString(undefined, { day: "numeric" })} Completed Jobs`;
      buckets.push({ label: `W${i + 1}`, start, end, total, fullLabel, shortLabel: `${startD.toLocaleDateString(undefined, { month: "short", day: "numeric" })}–${endD.getDate()}` });
    }
    return { buckets, rangeLabel: new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }), highlightIndex: Math.floor((d.getDate() - 1) / 7) };
  }
  function computeYearBuckets(ts) {
    const d = new Date(ts);
    const year = d.getFullYear();
    const letters = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
    const buckets = letters.map((label, i) => {
      const start = new Date(year, i, 1).getTime();
      const end = new Date(year, i + 1, 1).getTime();
      const total = completedJobsHistory.filter(j => j.completedAt >= start && j.completedAt < end).reduce((s, j) => s + jobAmount(j).net, 0);
      const fullLabel = `${new Date(start).toLocaleDateString(undefined, { month: "long", year: "numeric" })} Completed Jobs`;
      return { label, start, end, total, fullLabel, shortLabel: new Date(start).toLocaleDateString(undefined, { month: "short" }) };
    });
    return { buckets, rangeLabel: String(year), highlightIndex: d.getMonth() };
  }
  function periodData(period, ts) {
    if (period === "month") return computeMonthBuckets(ts);
    if (period === "year") return computeYearBuckets(ts);
    return computeWeekBuckets(ts);
  }

  const periodSwipeStartX = useRef(null);
  function periodSwipeHandlers() {
    const order = ["week", "month", "year"];
    return {
      onTouchStart: e => { periodSwipeStartX.current = e.touches[0].clientX; },
      onTouchEnd: e => {
        if (periodSwipeStartX.current == null) return;
        const dx = e.changedTouches[0].clientX - periodSwipeStartX.current;
        const idx = order.indexOf(earningsPeriod);
        if (dx < -50 && idx < order.length - 1) setEarningsPeriod(order[idx + 1]); // swipe left -> next (coarser)
        else if (dx > 50 && idx > 0) setEarningsPeriod(order[idx - 1]); // swipe right -> previous (finer)
        periodSwipeStartX.current = null;
      },
    };
  }
  function clickBucket(bucket) {
    if (bucket.total <= 0) return;
    setSelectedBucket(prev => (prev && prev.start === bucket.start && prev.end === bucket.end ? null : { start: bucket.start, end: bucket.end, fullLabel: bucket.fullLabel, shortLabel: bucket.shortLabel }));
  }

  function ledgerFilterSheet() {
    if (!ledgerFilterOpen) return null;
    const presentCategories = CATEGORIES.filter(c => completedJobsHistory.some(j => j.category === c.name));
    return (
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 30, display: "flex", alignItems: "flex-end" }} onClick={() => setLedgerFilterOpen(false)}>
        <div onClick={e => e.stopPropagation()} style={{ background: T.w, width: "100%", borderRadius: "22px 22px 0 0", padding: "18px 20px 28px", maxHeight: "70%", overflowY: "auto" }} className="hp-scroll">
          <div style={{ width: 36, height: 4, borderRadius: 3, background: T.bd, margin: "0 auto 16px" }} />
          <div style={{ fontSize: 16, fontWeight: 800, color: T.tx, fontFamily: FONT, marginBottom: 14 }}>Filter Completed Jobs</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pill("All Categories", "🗂️", ledgerCategoryFilter === "all", () => { setLedgerCategoryFilter("all"); setLedgerFilterOpen(false); }, "ledger-all")}
            {presentCategories.map(c => pill(c.name, c.icon, ledgerCategoryFilter === c.name, () => { setLedgerCategoryFilter(c.name); setLedgerFilterOpen(false); }, "ledger-" + c.name))}
          </div>
        </div>
      </div>
    );
  }

  /* ── One reusable ledger row — tapping it always opens the Job Earnings Statement
     breakdown, whether it's reached from the main ledger, a day's list,
     or a week-day swap. ── */
  function ledgerRow(job) {
    const a = jobAmount(job);
    const isInspectionOnly = job.status === "inspection_completed";
    const isMaterialsDeclined = job.status === "materials_declined";
    return (
      <button
        key={job.id}
        onClick={() => pushEarnings({ view: "earningsStatement", jobId: job.id })}
        style={{ display: "block", width: "100%", textAlign: "left", background: T.w, border: `1px solid ${T.bd}`, borderRadius: 16, padding: 14, marginBottom: 10, cursor: "pointer", fontFamily: FONT }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.tx, fontFamily: FONT }}>{iconFor(job.category)} {job.title}</div>
            <div style={{ fontSize: 11.5, fontWeight: 500, color: T.ts, fontFamily: FONT, marginTop: 2 }}>{job.category} · {job.city}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 17, fontWeight: 900, color: T.pg, fontFamily: FONT }}>${a.net}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.tm }}>{formatShortDate(job.completedAt)}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: (isInspectionOnly || isMaterialsDeclined) ? T.dxTx : T.pgd, background: (isInspectionOnly || isMaterialsDeclined) ? T.dxBg : T.pgt, border: `1px solid ${(isInspectionOnly || isMaterialsDeclined) ? T.dxBd : "transparent"}`, borderRadius: 9, padding: "5px 10px" }}>
            {isInspectionOnly ? "Inspection Completed" : isMaterialsDeclined ? "Materials declined — job could not be completed" : "Full Repair"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, fontWeight: 600, color: T.ts, borderTop: `1px solid ${T.bd}`, paddingTop: 8 }}>
          <span>{isInspectionOnly ? "Inspection Visit" : isMaterialsDeclined ? "Convenience Fee" : "Labor Payout"} ${a.gross}</span>
          {a.tip > 0 && <span>Tip +${a.tip}</span>}
          {a.materials > 0 && <span>Materials +${a.materials}</span>}
        </div>
      </button>
    );
  }

  function earningsMainScreen() {
    if (completedJobsHistory.length === 0) {
      return (<div style={{ flex: 1, display: "flex", flexDirection: "column" }}>{screenHeader("Earnings")}{emptyState("💵", "No completed payouts yet", "Every job you complete — payout, materials, and tips — will show up here, job by job.")}</div>);
    }

    const { buckets, rangeLabel, highlightIndex } = periodData(earningsPeriod, now);
    const periodTotal = buckets.reduce((a, b) => a + b.total, 0);
    const maxBucket = Math.max(1, ...buckets.map(b => b.total));
    const periodTitle = { week: "This Week", month: "This Month", year: "This Year" }[earningsPeriod];
    const lifetimeTotal = completedJobsHistory.reduce((sum, j) => sum + jobAmount(j).net, 0);
    const totalDurationHrs = completedJobsHistory.reduce((sum, j) => sum + j.durationMin, 0) / 60;
    const avgPerHour = totalDurationHrs > 0 ? Math.round(lifetimeTotal / totalDurationHrs) : 0;

    const bucketSelected = !!selectedBucket;
    const bucketJobs = bucketSelected
      ? completedJobsHistory.filter(j => j.completedAt >= selectedBucket.start && j.completedAt < selectedBucket.end).sort((a, b) => a.completedAt - b.completedAt)
      : [];
    const bucketDurationHrs = bucketJobs.reduce((sum, j) => sum + j.durationMin, 0) / 60;
    const bucketNetTotal = bucketJobs.reduce((sum, j) => sum + jobAmount(j).net, 0);
    const bucketAvgPerHour = bucketDurationHrs > 0 ? Math.round(bucketNetTotal / bucketDurationHrs) : 0;
    const categoryFilteredJobs = completedJobsHistory.filter(j => ledgerCategoryFilter === "all" || j.category === ledgerCategoryFilter);
    const sortedJobs = [...categoryFilteredJobs].sort((a, b) => b.completedAt - a.completedAt); // most-recent-first for the general ledger

    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto", position: "relative" }}>
        {screenHeader("Earnings")}
        <div style={{ padding: "0 20px 32px" }}>
          {/* Swipeable period chart — swipe right for coarser (Week -> Month -> Year), left to go back */}
          <div {...periodSwipeHandlers()} style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 18, padding: 18, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: T.ts, textTransform: "uppercase", letterSpacing: 0.3 }}>{periodTitle}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.tm, fontFamily: FONT }}>{rangeLabel}</div>
            </div>
            <div style={{ fontSize: 30, fontWeight: 900, color: T.pg, fontFamily: FONT, marginBottom: 16 }}>${periodTotal}</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 90, marginBottom: 6 }}>
              {buckets.map((b, i) => {
                const isSelected = selectedBucket && selectedBucket.start === b.start && selectedBucket.end === b.end;
                return (
                  <button
                    key={i}
                    onClick={() => clickBucket(b)}
                    style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", background: "none", border: "none", cursor: b.total > 0 ? "pointer" : "default", padding: 0 }}
                  >
                    <div style={{ fontSize: 9.5, fontWeight: 700, color: T.ts, marginBottom: 3, height: 12 }}>{b.total > 0 ? `$${b.total}` : ""}</div>
                    <div style={{
                      width: "100%", maxWidth: 26, borderRadius: "6px 6px 3px 3px",
                      height: Math.max(4, (b.total / maxBucket) * 62),
                      background: T.pgb,
                      opacity: b.total > 0 ? (!bucketSelected || isSelected ? 1 : 0.35) : 0.25,
                      outline: isSelected ? `2px solid ${T.pgd}` : "none",
                      outlineOffset: 1,
                    }} />
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              {buckets.map((b, i) => (
                <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 10.5, fontWeight: i === highlightIndex ? 800 : 600, color: i === highlightIndex ? T.pg : T.tm }}>{b.label}</div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
              {["week", "month", "year"].map(p => (
                <div key={p} style={{ width: 6, height: 6, borderRadius: 3, background: earningsPeriod === p ? T.pg : T.bd }} />
              ))}
            </div>
          </div>

          {/* Lifetime (tappable → monthly breakdown) + quick stats */}
          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            <button onClick={() => pushEarnings({ view: "monthly" })} style={{ flex: 1, background: T.w, border: `1px solid ${T.bd}`, borderRadius: 14, padding: "12px 8px", textAlign: "center", cursor: "pointer", fontFamily: FONT }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: T.tx }}>${lifetimeTotal}</div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: T.pg, marginTop: 2 }}>Lifetime ›</div>
            </button>
            {statCard(bucketSelected ? String(bucketJobs.length) : String(completedJobsHistory.length), bucketSelected ? "Jobs In Range" : "Completed Jobs")}
            {statCard(bucketSelected ? `$${bucketAvgPerHour}/hr` : `$${avgPerHour}/hr`, bucketSelected ? "Range Avg Hourly" : "Avg Hourly")}
          </div>

          {/* Ledger — either a single bucket's jobs (swapped in from any period), or the filterable full list */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: T.tx, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 0.3 }}>
              {bucketSelected ? selectedBucket.fullLabel : (ledgerCategoryFilter === "all" ? "All Completed Jobs" : `${ledgerCategoryFilter} Jobs`)}
            </div>
            {bucketSelected ? (
              <button onClick={() => setSelectedBucket(null)} style={{ display: "flex", alignItems: "center", gap: 4, border: `1px solid ${T.pg}`, background: T.pgt, borderRadius: 10, padding: "5px 9px", cursor: "pointer" }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: T.pgd, fontFamily: FONT }}>{selectedBucket.shortLabel}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: T.pgd }}>✕</span>
              </button>
            ) : ledgerCategoryFilter !== "all" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button onClick={() => setLedgerFilterOpen(true)} style={{ display: "flex", alignItems: "center", gap: 4, border: `1px solid ${T.pg}`, background: T.pgt, borderRadius: 10, padding: "5px 9px", cursor: "pointer" }}>
                  <span style={{ fontSize: 12 }}>{iconFor(ledgerCategoryFilter)}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: T.pgd, fontFamily: FONT }}>{ledgerCategoryFilter}</span>
                </button>
                <button onClick={() => setLedgerCategoryFilter("all")} style={{ border: "none", background: "none", cursor: "pointer", color: T.ts, fontSize: 14, fontWeight: 800, padding: 0 }}>✕</button>
              </div>
            ) : (
              <button onClick={() => setLedgerFilterOpen(true)} style={{ display: "flex", alignItems: "center", gap: 5, border: `1px solid ${T.bd}`, background: "transparent", borderRadius: 10, padding: "5px 10px", cursor: "pointer" }}>
                <span style={{ fontSize: 12 }}>⚙️</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: T.ts, fontFamily: FONT }}>Filter</span>
              </button>
            )}
          </div>

          {bucketSelected ? (
            bucketJobs.length === 0
              ? <div style={{ textAlign: "center", padding: "24px 0", fontSize: 12.5, fontWeight: 500, color: T.ts, fontFamily: FONT }}>No jobs completed in that range.</div>
              : bucketJobs.map(ledgerRow)
          ) : (
            <>
              {sortedJobs.length === 0 && (
                <div style={{ textAlign: "center", padding: "24px 0", fontSize: 12.5, fontWeight: 500, color: T.ts, fontFamily: FONT }}>No {ledgerCategoryFilter} jobs completed yet.</div>
              )}
              {sortedJobs.map(ledgerRow)}
            </>
          )}

          <div style={{ fontSize: 11, fontWeight: 500, color: T.tm, fontFamily: FONT, textAlign: "center", marginTop: 4, lineHeight: 1.5 }}>
            The payout shown before you accept is exactly what you receive — no fee deducted. Materials and tips are 100% yours too.
          </div>
        </div>
        {ledgerFilterSheet()}
      </div>
    );
  }

  function monthlyBreakdownScreen() {
    const byMonth = {};
    completedJobsHistory.forEach(j => {
      const key = monthKey(j.completedAt);
      if (!byMonth[key]) byMonth[key] = { key, label: monthLabel(j.completedAt), total: 0, count: 0, sortTs: j.completedAt };
      const a = jobAmount(j);
      byMonth[key].total += a.net;
      byMonth[key].count += 1;
    });
    const months = Object.values(byMonth).sort((a, b) => b.sortTs - a.sortTs);
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }} {...swipeBackHandlers(popEarnings)}>
        {backHeader("Monthly Breakdown", popEarnings)}
        <div style={{ padding: "0 20px 32px" }}>
          {months.map((m, i) => (
            <button
              key={i}
              onClick={() => pushEarnings({ view: "calendar", monthKey: m.key })}
              style={{ width: "100%", textAlign: "left", background: T.w, border: `1px solid ${T.bd}`, borderRadius: 14, padding: 14, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", fontFamily: FONT }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: T.tx, fontFamily: FONT }}>{m.label}</div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: T.ts, fontFamily: FONT, marginTop: 2 }}>{m.count} job{m.count === 1 ? "" : "s"} · avg ${Math.round(m.total / m.count)}/job</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: T.pg, fontFamily: FONT }}>${m.total}</div>
                <span style={{ color: T.tm, fontSize: 15 }}>›</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  function calendarScreen(monthKeyStr) {
    const [year, month] = monthKeyStr.split("-").map(Number);
    const firstOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startWeekday = firstOfMonth.getDay();
    const dayMap = {};
    completedJobsHistory.forEach(j => {
      const d = new Date(j.completedAt);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const key = d.getDate();
        if (!dayMap[key]) dayMap[key] = { total: 0, count: 0 };
        dayMap[key].total += jobAmount(j).net;
        dayMap[key].count += 1;
      }
    });
    const cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);

    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }} {...swipeBackHandlers(popEarnings)}>
        {backHeader(monthLabel(firstOfMonth.getTime()), popEarnings)}
        <div style={{ padding: "0 20px 32px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 8 }}>
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <div key={i} style={{ textAlign: "center", fontSize: 10.5, fontWeight: 700, color: T.tm }}>{d}</div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
            {cells.map((day, i) => {
              if (day === null) return <div key={i} />;
              const info = dayMap[day];
              const hasJobs = !!info;
              return (
                <button
                  key={i}
                  onClick={() => hasJobs && pushEarnings({ view: "day", dateKey: `${year}-${month}-${day}` })}
                  style={{
                    aspectRatio: "1", borderRadius: 10, border: `1px solid ${hasJobs ? T.pg : T.bd}`,
                    background: hasJobs ? T.pgt : T.w, cursor: hasJobs ? "pointer" : "default",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 2,
                  }}
                >
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: hasJobs ? T.pgd : T.tm }}>{day}</span>
                  {hasJobs && <span style={{ fontSize: 9, fontWeight: 800, color: T.pgd, marginTop: 1 }}>${info.total}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  function dayDetailScreen(dateKeyStr) {
    const [year, month, day] = dateKeyStr.split("-").map(Number);
    const dayJobs = completedJobsHistory
      .filter(j => { const d = new Date(j.completedAt); return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day; })
      .sort((a, b) => a.completedAt - b.completedAt); // order completed
    const label = new Date(year, month, day).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }} {...swipeBackHandlers(popEarnings)}>
        {backHeader(label, popEarnings)}
        <div style={{ padding: "0 20px 32px" }}>
          {dayJobs.length === 0
            ? <div style={{ textAlign: "center", padding: "24px 0", fontSize: 12.5, fontWeight: 500, color: T.ts, fontFamily: FONT }}>No jobs completed that day.</div>
            : dayJobs.map(ledgerRow)}
        </div>
      </div>
    );
  }

  function earningsStatementBody(job) {
    const a = jobAmount(job);
    const isInspectionOnly = job.status === "inspection_completed";
    const isMaterialsDeclined = job.status === "materials_declined";
    const statement = earningsStatements.find(s => s.jobId === job.id);
    const row = (label, value, muted) => (
      <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${T.bd}` }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: muted ? T.ts : T.tx, fontFamily: FONT }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: muted ? T.ts : T.tx, fontFamily: FONT }}>{value}</span>
      </div>
    );
    return (
      <div style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 18, padding: 18 }}>
        {statement && <div style={{ fontSize: 10.5, fontWeight: 700, color: T.tm, fontFamily: FONT, marginBottom: 8 }}>Statement {statement.id}</div>}
        <div style={{ fontSize: 17, fontWeight: 800, color: T.tx, fontFamily: FONT }}>{iconFor(job.category)} {job.title}</div>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: T.ts, fontFamily: FONT, marginTop: 2, marginBottom: 6 }}>{job.category} · {job.city}</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: T.tm, fontFamily: FONT, marginBottom: 6 }}>Completed {formatShortDate(job.completedAt)}</div>
        {job.actualDurationMin != null && (
          <div style={{ fontSize: 11.5, fontWeight: 600, color: T.tm, fontFamily: FONT, marginBottom: 14 }}>
            ⏱ On the job {job.actualDurationMin} min (est. ~{job.durationMin} min)
          </div>
        )}
        <span style={{ fontSize: 11.5, fontWeight: 700, color: (isInspectionOnly || isMaterialsDeclined) ? T.dxTx : T.pgd, background: (isInspectionOnly || isMaterialsDeclined) ? T.dxBg : T.pgt, border: `1px solid ${(isInspectionOnly || isMaterialsDeclined) ? T.dxBd : "transparent"}`, borderRadius: 9, padding: "5px 10px" }}>
          {isInspectionOnly ? "Inspection Completed" : isMaterialsDeclined ? "Materials declined — job could not be completed" : "Full Repair"}
        </span>

        {job.jobNotes && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: T.ts, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>Job Notes</div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: T.tx, fontFamily: FONT, lineHeight: 1.4 }}>{job.jobNotes}</div>
          </div>
        )}
        {(job.beforePhoto || job.afterPhoto) && (
          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            {job.beforePhoto && <img src={job.beforePhoto} alt="Before" style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover", border: `1px solid ${T.bd}` }} />}
            {job.afterPhoto && <img src={job.afterPhoto} alt="After" style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover", border: `1px solid ${T.bd}` }} />}
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          {row(isInspectionOnly ? "Inspection Visit" : isMaterialsDeclined ? "Convenience Fee" : "Labor Payout", `$${a.gross}`)}
          {a.tip > 0 && row("Tip (100% to you)", `+$${a.tip}`)}
          {a.materials > 0 && row(`Materials Reimbursed (pass-through)${job.materialsReceiptPhoto ? " · receipt on file" : ""}`, `+$${a.materials}`)}
        </div>
        {job.materialsReceiptPhoto && (
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <img src={job.materialsReceiptPhoto} alt="Receipt" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover", border: `1px solid ${T.bd}` }} />
            <span style={{ fontSize: 11.5, fontWeight: 600, color: T.ts, fontFamily: FONT }}>Receipt attached</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 14, marginTop: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: T.tx, fontFamily: FONT }}>TOTAL EARNINGS</span>
          <span style={{ fontSize: 24, fontWeight: 900, color: T.pg, fontFamily: FONT }}>${a.net}</span>
        </div>
      </div>
    );
  }

  function earningsStatementScreen(jobId) {
    const job = completedJobsHistory.find(j => j.id === jobId);
    if (!job) return monthlyBreakdownScreen();
    const statement = earningsStatements.find(s => s.jobId === jobId);
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }} {...swipeBackHandlers(popEarnings)}>
        {backHeader("Job Earnings Statement", popEarnings)}
        <div style={{ padding: "0 20px 32px" }}>
          {earningsStatementBody(job)}

          {statement && (
            <div style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 14, padding: 14, marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: T.tx, fontFamily: FONT }}>Emailed to you</span>
                {statusPill(statement.emailStatus === "sent" ? "verified" : statement.emailStatus === "failed" ? "failed" : "pending")}
              </div>
              <div style={{ fontSize: 11, fontWeight: 500, color: T.tm, fontFamily: FONT, marginBottom: 10 }}>
                Subject: Haven — Earnings statement for {job.title} · {formatShortDate(job.completedAt)}
              </div>
              <button onClick={() => resendEarningsStatement(jobId)} style={{ fontSize: 11.5, fontWeight: 700, color: T.pg, background: "none", border: "none", cursor: "pointer", padding: 0 }}>Email Again</button>
            </div>
          )}
          <div style={{ fontSize: 10.5, fontWeight: 500, color: T.tm, fontFamily: FONT, textAlign: "center", marginTop: 14, lineHeight: 1.5 }}>
            This is a recordkeeping document, not a tax form. Year-end tax documents (e.g. your 1099) will appear separately under Tax Documents once available.
          </div>
        </div>
      </div>
    );
  }

  function earningsScreen() {
    const v = currentEarningsView;
    if (v.view === "monthly") return monthlyBreakdownScreen();
    if (v.view === "calendar") return calendarScreen(v.monthKey);
    if (v.view === "day") return dayDetailScreen(v.dateKey);
    if (v.view === "earningsStatement") return earningsStatementScreen(v.jobId);
    return earningsMainScreen();
  }
  /* ── Shared chat bubble list — used by both the per-job customer thread
     and the support chat, so they look and behave identically. ── */
  function chatBubbles(messages) {
    return messages.map((m, i) => {
      const fromPro = m.from === "pro";
      return (
        <div key={i} style={{ display: "flex", justifyContent: fromPro ? "flex-end" : "flex-start", marginBottom: 8 }}>
          <div style={{
            maxWidth: "75%", background: fromPro ? T.pgb : T.w, color: fromPro ? "#FFFFFF" : T.tx,
            border: fromPro ? "none" : `1px solid ${T.bd}`, borderRadius: 14, padding: "10px 13px",
            fontSize: 13, fontWeight: 500, fontFamily: FONT, lineHeight: 1.4,
          }}>
            {m.text}
          </div>
        </div>
      );
    });
  }

  function chatInputBar(value, onChange, onSend) {
    return (
      <div style={{ display: "flex", gap: 8, padding: "12px 20px", borderTop: `1px solid ${T.bd}`, background: T.bg }}>
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") onSend(); }}
          placeholder="Type a message…"
          style={{ flex: 1, padding: "10px 14px", borderRadius: 20, border: `1px solid ${T.bd}`, background: T.w, color: T.tx, fontSize: 13.5, fontFamily: FONT, outline: "none" }}
        />
        <button onClick={onSend} style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: T.pgb, color: "#fff", fontSize: 16, cursor: "pointer", flexShrink: 0 }}>➤</button>
      </div>
    );
  }

  function messageThreadScreen(jobId) {
    const job = activeJobs.find(j => j.id === jobId);
    if (!job) return messagesListScreen();
    const thread = jobMessages[jobId] || [];
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }} {...swipeBackHandlers(popMessages)}>
        {backHeader(job.customerName, popMessages)}
        <div style={{ fontSize: 11, fontWeight: 600, color: T.tm, fontFamily: FONT, textAlign: "center", marginBottom: 6 }}>{job.title} · {job.category}</div>
        <div className="hp-scroll" style={{ flex: 1, overflowY: "auto", padding: "0 20px 12px" }}>
          {thread.length === 0
            ? <div style={{ textAlign: "center", fontSize: 12.5, fontWeight: 500, color: T.ts, fontFamily: FONT, marginTop: 24 }}>Say hello to {job.customerName} if you have any questions before you arrive.</div>
            : chatBubbles(thread)}
        </div>
        {chatInputBar(messageDraftText, setMessageDraftText, () => sendCustomerMessage(jobId))}
      </div>
    );
  }

  function messagesListScreen() {
    if (activeJobs.length === 0) {
      return (<div style={{ flex: 1, display: "flex", flexDirection: "column" }}>{screenHeader("Messages")}{emptyState("💬", "No conversations yet", "Messages with customers appear here once you accept a job.")}</div>);
    }
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }}>
        {screenHeader("Messages")}
        <div style={{ padding: "0 20px 32px" }}>
          {activeJobs.map(job => {
            const thread = jobMessages[job.id] || [];
            const last = thread[thread.length - 1];
            return (
              <button
                key={job.id}
                onClick={() => pushMessages({ view: "thread", jobId: job.id })}
                style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, background: T.w, border: `1px solid ${T.bd}`, borderRadius: 16, padding: 14, marginBottom: 10, cursor: "pointer", fontFamily: FONT }}
              >
                <div style={{ width: 42, height: 42, borderRadius: "50%", background: T.pgt, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>👤</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: T.tx }}>{job.customerName}</div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: T.ts, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {last ? last.text : `${job.title} · Say hello`}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function messagesScreen() {
    const v = currentMessagesView;
    if (v.view === "thread") return messageThreadScreen(v.jobId);
    return messagesListScreen();
  }

  /* ── Profile — main summary + sub-screens (edit / categories / settings) ── */
  function statCard(value, label) {
    return (
      <div style={{ flex: 1, background: T.w, border: `1px solid ${T.bd}`, borderRadius: 14, padding: "12px 8px", textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: T.tx, fontFamily: FONT }}>{value}</div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: T.ts, fontFamily: FONT, marginTop: 2 }}>{label}</div>
      </div>
    );
  }
  function infoRow(icon, label, status) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", background: T.w, border: `1px solid ${T.bd}`, borderRadius: 14, marginBottom: 8 }}>
        <span style={{ fontSize: 17 }}>{icon}</span>
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: T.tx, fontFamily: FONT }}>{label}</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: T.pg, fontFamily: FONT }}>{status}</span>
      </div>
    );
  }
  function navRow(icon, label, valueText, onClick, soon) {
    return (
      <button
        onClick={onClick}
        disabled={!onClick}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 14px", background: T.w, border: `1px solid ${T.bd}`, borderRadius: 14, marginBottom: 8, cursor: onClick ? "pointer" : "default", opacity: soon ? 0.55 : 1, textAlign: "left", fontFamily: FONT }}
      >
        <span style={{ fontSize: 17 }}>{icon}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: T.tx }}>{label}</div>
          {valueText && <div style={{ fontSize: 12, fontWeight: 500, color: T.ts, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{valueText}</div>}
        </span>
        {soon ? <span style={{ fontSize: 10.5, fontWeight: 700, color: T.tm, background: T.soonBg, borderRadius: 6, padding: "3px 7px" }}>SOON</span> : onClick && <span style={{ color: T.tm, fontSize: 15 }}>›</span>}
      </button>
    );
  }
  function sectionLabel(text) {
    return <div style={{ fontSize: 13, fontWeight: 800, color: T.tx, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 10 }}>{text}</div>;
  }
  /* ── Shared labeled text input — used by every Earnings Setup /
     Verification form so they look and behave identically. ── */
  function formField(label, value, onChange, placeholder, inputMode) {
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: T.ts, fontFamily: FONT, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${T.bd}`, background: T.w, color: T.tx, fontSize: 14, fontFamily: FONT, outline: "none" }}
        />
      </div>
    );
  }
  function subScreenHeader(title, onCancel, onSave, saveLabel) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "28px 20px 16px" }}>
        <button onClick={onCancel} style={{ border: "none", background: "none", color: T.ts, fontWeight: 700, fontSize: 14, fontFamily: FONT, cursor: "pointer" }}>Cancel</button>
        <div style={{ fontSize: 15.5, fontWeight: 800, color: T.tx, fontFamily: FONT }}>{title}</div>
        {onSave ? (
          <button onClick={onSave} style={{ border: "none", background: "none", color: T.pg, fontWeight: 800, fontSize: 14, fontFamily: FONT, cursor: "pointer" }}>{saveLabel || "Save"}</button>
        ) : <div style={{ width: 44 }} />}
      </div>
    );
  }

  /* ── Pure back-navigation header (no draft/save semantics) — used for
     Earnings drill-down screens and Settings. Pairs with swipe-back. ── */
  function backHeader(title, onBack) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "28px 20px 16px" }}>
        <button onClick={onBack} style={{ border: "none", background: "none", color: T.pg, fontSize: 22, fontWeight: 800, cursor: "pointer", padding: "0 4px 0 0", lineHeight: 1 }}>‹</button>
        <div style={{ fontSize: 17, fontWeight: 800, color: T.tx, fontFamily: FONT }}>{title}</div>
      </div>
    );
  }

  function profileMainScreen() {
    const enabled = CATEGORIES.filter(c => workCategories.has(c.name));
    const catSummary = enabled.length === 0 ? "None selected" : enabled.length <= 2 ? enabled.map(c => c.name).join(", ") : `${enabled.slice(0, 2).map(c => c.name).join(", ")} +${enabled.length - 2} more`;
    const hasHistory = completedJobsHistory.length > 0;
    const memberSinceText = accountCreatedAt ? `Member since ${new Date(accountCreatedAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}` : "New member";
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }}>
        {screenHeader("Profile")}
        <div style={{ padding: "4px 20px 32px" }}>
          {/* A. Summary card */}
          <div style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 18, padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
              <div style={{ width: 60, height: 60, borderRadius: "50%", background: T.pgt, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, flexShrink: 0, overflow: "hidden" }}>
                {avatarPhoto ? <img src={avatarPhoto} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : avatarEmoji}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: T.tx, fontFamily: FONT }}>{firstName || "New Pro"} {lastName}</div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: T.tm, fontFamily: FONT, marginTop: 3 }}>{memberSinceText}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {statCard(hasHistory ? "92" : "New", "Trust Score")}
              {statCard(hasHistory ? "4.9 ★" : "New", hasHistory ? "Rating (128)" : "Rating")}
              {statCard(String(completedJobsHistory.length), "Completed")}
            </div>
            {!hasHistory && (
              <div style={{ fontSize: 11, fontWeight: 500, color: T.tm, fontFamily: FONT, marginBottom: 12, lineHeight: 1.4 }}>
                Trust Score and rating build up once you've completed a few jobs.
              </div>
            )}
            <button onClick={openEditProfile} style={{ width: "100%", padding: "12px 0", borderRadius: 12, border: `1px solid ${T.pg}`, background: "transparent", color: T.pg, fontSize: 13.5, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}>Edit Profile</button>
          </div>

          <div style={{ marginBottom: 14 }}>
            {sectionLabel("About")}
            <div style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 14, padding: 14, fontSize: 13, fontWeight: 500, color: T.ts, fontFamily: FONT, lineHeight: 1.55 }}>{about}</div>
          </div>

          {/* Haven Pro Setup — readiness banner, links to the Verification Center */}
          <button
            onClick={() => setProfileView("verificationCenter")}
            style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, background: marketplaceReady ? T.pgt : T.dxBg, border: `1px solid ${marketplaceReady ? T.pg : T.dxBd}`, borderRadius: 14, padding: 14, marginBottom: 14, cursor: "pointer", fontFamily: FONT }}
          >
            <div style={{ fontSize: 20 }}>{marketplaceReady ? "✅" : "🛡️"}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: marketplaceReady ? T.pgd : T.dxTx }}>Haven Pro Setup — {readinessPercent}%</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: marketplaceReady ? T.pgd : T.dxTx, opacity: 0.85, marginTop: 1 }}>{marketplaceReady ? "Marketplace ready" : "Action required before accepting jobs"}</div>
            </div>
            <span style={{ color: marketplaceReady ? T.pgd : T.dxTx, fontSize: 15 }}>›</span>
          </button>

          {/* B. Work setup */}
          <div style={{ marginBottom: 14 }}>
            {sectionLabel("Work Setup")}
            {navRow("🗂️", "Work Categories", catSummary, openManageCategories)}
            <div style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 14, padding: 14, marginBottom: 8 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: T.tx, fontFamily: FONT, marginBottom: 8 }}>Travel Radius</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {RADIUS_OPTIONS.map(r => pill(`${r} mi`, null, travelRadius === r, () => setTravelRadius(r), "radius-" + r))}
              </div>
            </div>
            {navRow("📍", "Service Area", `${homeCity} and surrounding areas`, null)}
          </div>

          {/* C. Verification */}
          <div style={{ marginBottom: 14 }}>
            {sectionLabel("Verification")}
            {navRow("🪪", "Identity", statusLabelText(identityVerification.status), () => setProfileView("identity"))}
            {navRow("✅", "Background Check", statusLabelText(backgroundCheck.status), () => setProfileView("backgroundCheck"))}
            {navRow("📜", "Professional Credentials", `${credentials.filter(c => c.status === "verified").length} verified · ${credentials.length} total`, () => setProfileView("credentials"))}
          </div>

          {/* D. Payouts & Tax */}
          <div style={{ marginBottom: 14 }}>
            {sectionLabel("Payouts & Tax")}
            {navRow("🏦", "Payout Method", statusLabelText(payoutAccount.status), () => setProfileView("payout"))}
            {navRow("🧾", "Tax Information", statusLabelText(taxProfile.status), openTaxInfo)}
          </div>

          {/* E. Settings — single destination */}
          <div style={{ marginBottom: 8 }}>
            {sectionLabel("Settings")}
            {navRow("⚙️", "Settings", "Notifications, Appearance, Help & Support", () => setProfileView("settings"))}
          </div>
        </div>
      </div>
    );
  }

  function manageCategoriesScreen() {
    const draft = categoriesDraft || new Set(workCategories);
    function toggle(name) {
      const next = new Set(draft);
      next.has(name) ? next.delete(name) : next.add(name);
      setCategoriesDraft(next);
    }
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }} {...swipeBackHandlers(cancelCategories)}>
        {subScreenHeader("Work Categories", cancelCategories, saveCategories)}
        <div style={{ padding: "0 20px 32px" }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: T.ts, fontFamily: FONT, marginBottom: 18, lineHeight: 1.5 }}>
            These determine which jobs enter your marketplace pool. Home filters can narrow this further, but jobs outside these categories never appear.
          </div>
          {CATEGORY_GROUPS.map(g => (
            <div key={g.group} style={{ marginBottom: 18 }}>
              {sectionLabel(g.group)}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {g.categories.map(c => pill(c.name, c.icon, draft.has(c.name), () => toggle(c.name), g.group + "-" + c.name))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── Shared status vocabulary — one place mapping every status string
     used across Identity/Background/Credentials/Payouts/Tax to
     a label and a color family, so they all look consistent. ── */
  function statusLabelText(status) {
    const map = {
      not_started: "Not Started", session_created: "Session Created", pending: "Pending", verified: "Verified",
      needs_review: "Needs Review", failed: "Failed", expired: "Expired",
      consent_required: "Consent Required", invited: "Invited", clear: "Clear", consider: "Consider", disputed: "Disputed", suspended: "Suspended",
      self_reported: "Self-Reported", verification_available: "Ready to Verify", unable_to_verify: "Unable to Verify", rejected: "Rejected",
      restricted: "Restricted", enabled: "Enabled",
    };
    return map[status] || status;
  }
  function statusPill(status) {
    const positive = ["verified", "clear", "enabled"].includes(status);
    const negative = ["failed", "rejected", "unable_to_verify", "expired", "suspended", "disputed"].includes(status);
    const warning = ["pending", "session_created", "invited", "needs_review", "restricted", "consent_required", "consider", "verification_available"].includes(status);
    const v = positive
      ? { bg: T.pgt, fg: T.pgd, bd: T.pg }
      : negative
      ? { bg: T.emBg, fg: T.emTx, bd: T.emBd }
      : warning
      ? { bg: T.dxBg, fg: T.dxTx, bd: T.dxBd }
      : { bg: T.soonBg, fg: T.tm, bd: T.bd };
    return <span style={{ fontSize: 11, fontWeight: 700, color: v.fg, background: v.bg, border: `1px solid ${v.bd}`, borderRadius: 8, padding: "4px 10px" }}>{statusLabelText(status)}</span>;
  }
  /* Dev-only test controls simulating a provider webhook result — these do
     NOT exist in the real user-facing flow. Production replaces every one
     of these buttons with the actual provider integration (Persona /
     Checkr / Stripe Connect / a per-credential verification adapter). */
  function devTestPanel(label, options) {
    return (
      <div style={{ marginTop: 18, padding: 12, borderRadius: 10, border: `1px dashed ${T.tm}` }}>
        <div style={{ fontSize: 9.5, fontWeight: 800, color: T.tm, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, fontFamily: "monospace" }}>⚙ Dev Testing — simulate {label} provider webhook</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {options.map((o, i) => (
            <button key={i} onClick={o.onClick} style={{ fontSize: 10, fontWeight: 700, padding: "5px 9px", borderRadius: 7, border: `1px solid ${T.tm}`, background: "transparent", color: T.ts, cursor: "pointer", fontFamily: "monospace" }}>{o.label}</button>
          ))}
        </div>
      </div>
    );
  }

  function identityScreen() {
    const bothCaptured = identityProgress.idCaptured && identityProgress.selfieCaptured;
    const status = identityVerification.status;
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }} {...swipeBackHandlers(() => setProfileView("verificationCenter"))}>
        {backHeader("Identity Verification", () => setProfileView("verificationCenter"))}
        <div style={{ padding: "0 20px 32px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: T.ts, fontFamily: FONT, marginBottom: 6, lineHeight: 1.5 }}>
            Customers trust Haven Pros inside their homes. Identity verification is required before you can accept jobs.
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.tm, fontFamily: FONT, marginBottom: 16 }}>Verified by Persona, Haven's identity partner — Haven never reviews your ID directly.</div>
          <div style={{ marginBottom: 16 }}>{statusPill(status)}</div>

          {status === "not_started" && (
            <button onClick={startIdentityVerification} style={{ width: "100%", padding: "13px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}>
              Start Identity Verification
            </button>
          )}

          {status === "session_created" && (
            <>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: T.ts, fontFamily: FONT, marginBottom: 10 }}>This is what Persona's hosted flow collects — Haven itself never sees or stores the raw images.</div>
              <button onClick={() => setIdentityProgress(p => ({ ...p, idCaptured: true }))} style={{ width: "100%", marginBottom: 8, padding: "12px 0", borderRadius: 12, border: `1px solid ${identityProgress.idCaptured ? T.pg : T.bd}`, background: identityProgress.idCaptured ? T.pgt : T.w, color: identityProgress.idCaptured ? T.pgd : T.tx, fontSize: 13.5, fontWeight: 700, fontFamily: FONT, cursor: "pointer" }}>
                {identityProgress.idCaptured ? "✓ " : ""}Government-Issued ID (via Persona)
              </button>
              <button onClick={() => setIdentityProgress(p => ({ ...p, selfieCaptured: true }))} style={{ width: "100%", marginBottom: 14, padding: "12px 0", borderRadius: 12, border: `1px solid ${identityProgress.selfieCaptured ? T.pg : T.bd}`, background: identityProgress.selfieCaptured ? T.pgt : T.w, color: identityProgress.selfieCaptured ? T.pgd : T.tx, fontSize: 13.5, fontWeight: 700, fontFamily: FONT, cursor: "pointer" }}>
                {identityProgress.selfieCaptured ? "✓ " : ""}Selfie / Liveness Check (via Persona)
              </button>
              <button disabled={!bothCaptured} onClick={submitIdentityVerification} style={{ width: "100%", padding: "13px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: FONT, cursor: bothCaptured ? "pointer" : "default", opacity: bothCaptured ? 1 : 0.5 }}>
                Submit to Persona
              </button>
            </>
          )}

          {status === "pending" && (
            <div style={{ background: T.dxBg, border: `1px solid ${T.dxBd}`, borderRadius: 14, padding: 16, fontSize: 12.5, fontWeight: 600, color: T.dxTx, textAlign: "center" }}>
              ⏳ Persona is reviewing your submission. This is a real wait state in production — Haven doesn't control the timing.
            </div>
          )}
          {status === "verified" && (
            <div style={{ background: T.pgt, border: `1px solid ${T.pg}`, borderRadius: 14, padding: 16, fontSize: 12.5, fontWeight: 600, color: T.pgd, textAlign: "center" }}>✅ Your identity is verified.</div>
          )}
          {["needs_review", "failed", "expired"].includes(status) && (
            <>
              <div style={{ background: T.emBg, border: `1px solid ${T.emBd}`, borderRadius: 14, padding: 16, fontSize: 12.5, fontWeight: 600, color: T.emTx, textAlign: "center", marginBottom: 14 }}>
                {status === "needs_review" && "Persona flagged this for manual review."}
                {status === "failed" && `Persona couldn't verify your identity${identityVerification.failureReasonCode ? ` (${identityVerification.failureReasonCode})` : ""}.`}
                {status === "expired" && "Your identity verification has expired and needs to be redone."}
              </div>
              <button onClick={retryIdentityVerification} style={{ width: "100%", padding: "13px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}>Try Again</button>
            </>
          )}

          {devTestPanel("Persona", [
            { label: "Verified", onClick: () => devSetIdentityStatus("verified") },
            { label: "Pending", onClick: () => devSetIdentityStatus("pending") },
            { label: "Needs Review", onClick: () => devSetIdentityStatus("needs_review") },
            { label: "Failed", onClick: () => devSetIdentityStatus("failed") },
            { label: "Expired", onClick: () => devSetIdentityStatus("expired") },
            { label: "Reset", onClick: retryIdentityVerification },
          ])}
        </div>
      </div>
    );
  }

  function backgroundCheckScreen() {
    const status = backgroundCheck.status;
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }} {...swipeBackHandlers(() => setProfileView("verificationCenter"))}>
        {backHeader("Background Check", () => setProfileView("verificationCenter"))}
        <div style={{ padding: "0 20px 32px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: T.ts, fontFamily: FONT, marginBottom: 6, lineHeight: 1.5 }}>
            Checkr, Haven's FCRA-compliant screening partner, runs this independently of identity verification. Job acceptance is blocked until it comes back clear.
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.tm, fontFamily: FONT, marginBottom: 16 }}>Production launch requires legal review of FCRA disclosures, consent language, and pre-/post-adverse-action procedures — not built here.</div>
          <div style={{ marginBottom: 16 }}>{statusPill(status)}</div>

          {status === "not_started" && (
            <button onClick={startBackgroundCheck} style={{ width: "100%", padding: "13px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}>
              Start Background Check
            </button>
          )}
          {status === "consent_required" && (
            <div style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: T.tx, fontFamily: FONT, marginBottom: 12 }}>Before Checkr can screen you, review and authorize the required disclosures.</div>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", marginBottom: 14 }}>
                <input type="checkbox" checked={backgroundConsent} onChange={e => setBackgroundConsent(e.target.checked)} style={{ marginTop: 2 }} />
                <span style={{ fontSize: 12.5, fontWeight: 500, color: T.ts, fontFamily: FONT, lineHeight: 1.4 }}>
                  I authorize Haven to invite me to a background check through Checkr, its screening provider.
                </span>
              </label>
              <button onClick={authorizeBackgroundCheck} style={{ width: "100%", padding: "13px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}>
                Authorize Background Check
              </button>
            </div>
          )}
          {["invited", "pending"].includes(status) && (
            <div style={{ background: T.dxBg, border: `1px solid ${T.dxBd}`, borderRadius: 14, padding: 16, fontSize: 12.5, fontWeight: 600, color: T.dxTx, textAlign: "center" }}>⏳ Checkr is processing your report.</div>
          )}
          {status === "clear" && (
            <div style={{ background: T.pgt, border: `1px solid ${T.pg}`, borderRadius: 14, padding: 16, fontSize: 12.5, fontWeight: 600, color: T.pgd, textAlign: "center" }}>✅ Your background check came back clear.</div>
          )}
          {["consider", "disputed", "suspended", "expired"].includes(status) && (
            <div style={{ background: T.emBg, border: `1px solid ${T.emBd}`, borderRadius: 14, padding: 16, fontSize: 12.5, fontWeight: 600, color: T.emTx, textAlign: "center" }}>
              {status === "consider" && "Your report needs review — not an automatic disqualification. A real report at this stage requires pre-adverse-action procedures before any final decision."}
              {status === "disputed" && "You've disputed this report — it's under re-investigation with Checkr."}
              {status === "suspended" && "Your account access is suspended pending this report."}
              {status === "expired" && "Your background check has expired and needs to be redone."}
            </div>
          )}

          {devTestPanel("Checkr", [
            { label: "Clear", onClick: () => devSetBackgroundStatus("clear") },
            { label: "Pending", onClick: () => devSetBackgroundStatus("pending") },
            { label: "Consider", onClick: () => devSetBackgroundStatus("consider") },
            { label: "Disputed", onClick: () => devSetBackgroundStatus("disputed") },
            { label: "Reset", onClick: () => { setBackgroundCheck({ provider: "checkr", providerReportId: null, status: "not_started", clearedAt: null }); setBackgroundConsent(false); } },
          ])}
        </div>
      </div>
    );
  }

  function credentialsScreen() {
    const credTypes = ["License", "Certification", "Other"];
    const closeCredentials = () => { setCredentialDraft(null); setProfileView("verificationCenter"); };
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }} {...swipeBackHandlers(closeCredentials)}>
        {backHeader("Professional Credentials", closeCredentials)}
        <div style={{ padding: "0 20px 32px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: T.ts, fontFamily: FONT, marginBottom: 18, lineHeight: 1.5 }}>
            Optional — not required to become a Haven Pro unless a specific job legally requires one. A credential is only ever shown as Verified once an authoritative source (a state registry, or the certifying organization) actually confirms it.
          </div>
          {credentials.length === 0 && <div style={{ fontSize: 12.5, fontWeight: 500, color: T.ts, fontFamily: FONT, marginBottom: 14 }}>No credentials added yet.</div>}
          {credentials.map(c => (
            <div key={c.id} style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 14, padding: 14, marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: T.tx, fontFamily: FONT }}>{c.name}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 500, color: T.ts, fontFamily: FONT, marginTop: 1 }}>
                    {c.type}{c.jurisdiction ? ` · ${c.jurisdiction}` : ""}{c.number ? ` · ${c.number}` : ""}{c.expiration ? ` · Exp. ${c.expiration}` : ""}
                  </div>
                  {c.status === "verified" && c.verificationSource && <div style={{ fontSize: 10.5, fontWeight: 600, color: T.pg, fontFamily: FONT, marginTop: 3 }}>via {c.verificationSource}</div>}
                </div>
                {statusPill(c.status)}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {["self_reported", "verification_available"].includes(c.status) && <button onClick={() => verifyProfessionalCredential(c.id)} style={{ fontSize: 11.5, fontWeight: 700, color: T.pg, background: "none", border: "none", cursor: "pointer", padding: 0 }}>Request Verification</button>}
                {c.status === "pending" && <span style={{ fontSize: 11.5, fontWeight: 600, color: T.tm }}>Verifying…</span>}
                <button onClick={() => removeCredential(c.id)} style={{ fontSize: 11.5, fontWeight: 700, color: T.ts, background: "none", border: "none", cursor: "pointer", padding: 0, marginLeft: "auto" }}>Remove</button>
              </div>
              {devTestPanel("credential source", [
                { label: "Verified", onClick: () => devSetCredentialStatus(c.id, "verified") },
                { label: "Unable to Verify", onClick: () => devSetCredentialStatus(c.id, "unable_to_verify") },
                { label: "Pending", onClick: () => devSetCredentialStatus(c.id, "pending") },
                { label: "Expired", onClick: () => devSetCredentialStatus(c.id, "expired") },
              ])}
            </div>
          ))}

          {credentialDraft ? (
            <div style={{ background: T.w, border: `1px solid ${T.pg}`, borderRadius: 14, padding: 14, marginTop: 8 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {credTypes.map(t => pill(t, null, credentialDraft.type === t, () => setCredentialDraft(p => ({ ...p, type: t })), "credtype-" + t))}
              </div>
              {formField("Name / Title", credentialDraft.name, v => setCredentialDraft(p => ({ ...p, name: v })), "e.g. Florida Plumbing Contractor")}
              {formField("Jurisdiction / State", credentialDraft.jurisdiction, v => setCredentialDraft(p => ({ ...p, jurisdiction: v })), "e.g. FL")}
              {formField("License / Certificate Number", credentialDraft.number, v => setCredentialDraft(p => ({ ...p, number: v })), "optional")}
              {formField("Expiration", credentialDraft.expiration, v => setCredentialDraft(p => ({ ...p, expiration: v })), "e.g. 2027-06")}
              <div style={{ fontSize: 11, fontWeight: 500, color: T.tm, fontFamily: FONT, marginBottom: 12 }}>📎 Document/photo upload — coming soon</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setCredentialDraft(null)} style={{ flex: 1, padding: "11px 0", borderRadius: 12, border: `1px solid ${T.bd}`, background: "transparent", color: T.ts, fontSize: 13, fontWeight: 700, fontFamily: FONT, cursor: "pointer" }}>Cancel</button>
                <button onClick={saveCredential} style={{ flex: 1, padding: "11px 0", borderRadius: 12, border: "none", background: T.pgb, color: "#fff", fontSize: 13, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}>Add Credential</button>
              </div>
            </div>
          ) : (
            <button onClick={() => openAddCredential("License")} style={{ width: "100%", border: `1px dashed ${T.bd}`, background: "transparent", color: T.ts, fontSize: 12.5, fontWeight: 700, fontFamily: FONT, cursor: "pointer", padding: "10px 0", borderRadius: 12 }}>+ Add Credential</button>
          )}
        </div>
      </div>
    );
  }

  function payoutScreen() {
    const status = payoutAccount.status;
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }} {...swipeBackHandlers(() => setProfileView("main"))}>
        {backHeader("Payout Method", () => setProfileView("main"))}
        <div style={{ padding: "0 20px 32px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: T.ts, fontFamily: FONT, marginBottom: 16, lineHeight: 1.5 }}>
            Haven partners with Stripe Connect to handle payouts — your bank details are entered on Stripe's hosted onboarding, never collected directly by Haven.
          </div>
          <div style={{ marginBottom: 16 }}>{statusPill(status)}</div>

          {status === "not_started" && (
            <button onClick={startPayoutSetup} style={{ width: "100%", padding: "13px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}>
              Set Up Payouts with Stripe
            </button>
          )}
          {status === "pending" && (
            <div style={{ background: T.dxBg, border: `1px solid ${T.dxBd}`, borderRadius: 14, padding: 16, fontSize: 12.5, fontWeight: 600, color: T.dxTx, textAlign: "center" }}>
              ⏳ Stripe is verifying your account details.
              {payoutAccount.requirementsDue.length > 0 && <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600 }}>Outstanding: {payoutAccount.requirementsDue.join(", ")}</div>}
            </div>
          )}
          {status === "enabled" && (
            <div style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, fontFamily: FONT, marginBottom: 4 }}>Bank account</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.ts, fontFamily: FONT, marginBottom: 12 }}>•••• {payoutAccount.last4}</div>
              <div style={{ fontSize: 11, fontWeight: 500, color: T.tm, fontFamily: FONT }}>Stripe account: {payoutAccount.providerAccountId}</div>
            </div>
          )}
          {status === "restricted" && (
            <div style={{ background: T.emBg, border: `1px solid ${T.emBd}`, borderRadius: 14, padding: 16, fontSize: 12.5, fontWeight: 600, color: T.emTx, textAlign: "center" }}>⚠️ Stripe needs more information before you can receive funds.</div>
          )}

          {devTestPanel("Stripe Connect", [
            { label: "Enabled", onClick: () => devSetPayoutStatus("enabled") },
            { label: "Pending", onClick: () => devSetPayoutStatus("pending") },
            { label: "Restricted", onClick: () => devSetPayoutStatus("restricted") },
            { label: "Reset", onClick: () => setPayoutAccount({ provider: "stripe", providerAccountId: null, payoutsEnabled: false, requirementsDue: [], status: "not_started", last4: null }) },
          ])}
        </div>
      </div>
    );
  }

  function taxInfoScreen() {
    const d = taxDraft;
    const classifications = ["Individual", "LLC", "Corporation"];
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }} {...swipeBackHandlers(cancelTaxInfo)}>
        {subScreenHeader("Tax Information", cancelTaxInfo, submitTaxInfo, "Submit")}
        <div style={{ padding: "0 20px 32px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: T.ts, fontFamily: FONT, marginBottom: 18, lineHeight: 1.5 }}>
            Used to prepare future tax documents at year end. Haven never collects or stores your SSN or EIN directly — TIN verification runs through Stripe Connect's connected-account tax reporting tooling.
          </div>
          {formField("Legal Name", d.legalName, v => setTaxDraft(p => ({ ...p, legalName: v })), "As it appears on your tax return")}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.ts, fontFamily: FONT, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.3 }}>Tax Classification</div>
            <div style={{ display: "flex", gap: 8 }}>
              {classifications.map(t => pill(t, null, d.classification === t, () => setTaxDraft(p => ({ ...p, classification: t })), "tc-" + t))}
            </div>
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: T.ts, fontFamily: FONT, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.3 }}>Current Status</div>
          <div style={{ marginBottom: 12 }}>{statusPill(taxProfile.status)}</div>
          {devTestPanel("Stripe Connect tax reporting", [
            { label: "Verified", onClick: () => devSetTaxStatus("verified") },
            { label: "Pending", onClick: () => devSetTaxStatus("pending") },
            { label: "Needs Review", onClick: () => devSetTaxStatus("needs_review") },
            { label: "Reset", onClick: () => devSetTaxStatus("not_started") },
          ])}
        </div>
      </div>
    );
  }

  function verificationCenterScreen() {
    const readinessRow = (label, ok) => (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0" }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ts, fontFamily: FONT }}>{label}</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: ok ? T.pg : T.tm, fontFamily: FONT }}>{ok ? "Complete" : "Action Required"}</span>
      </div>
    );
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }} {...swipeBackHandlers(() => setProfileView("main"))}>
        {backHeader("Verification Center", () => setProfileView("main"))}
        <div style={{ padding: "0 20px 32px" }}>
          <div style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 18, padding: 18, marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: T.tx, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 0.3 }}>Haven Pro Setup</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: T.pg, fontFamily: FONT }}>{readinessPercent}%</div>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: T.bd, overflow: "hidden", marginBottom: 14 }}>
              <div style={{ height: "100%", width: `${readinessPercent}%`, background: T.pgb, borderRadius: 4 }} />
            </div>
            {readinessRow("Profile", profileComplete)}
            {readinessRow("Identity", identityVerified)}
            {readinessRow("Background Check", backgroundApproved)}
            {readinessRow("Payouts", payoutEnabled)}
            {readinessRow("Tax Information", taxComplete)}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.bd}` }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: T.tx, fontFamily: FONT }}>Marketplace Access</span>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: marketplaceReady ? T.pg : T.emTx, fontFamily: FONT }}>{marketplaceReady ? "Ready" : "Action Required"}</span>
            </div>
          </div>

          {sectionLabel("Required")}
          {navRow("🪪", "Identity Verification", statusLabelText(identityVerification.status), () => setProfileView("identity"))}
          {navRow("✅", "Background Check", statusLabelText(backgroundCheck.status), () => setProfileView("backgroundCheck"))}

          <div style={{ marginTop: 18 }}>{sectionLabel("Optional / Trust Boosters")}</div>
          {navRow("📜", "Professional Credentials", `${credentials.filter(c => c.status === "verified").length} verified · ${credentials.length} total`, () => setProfileView("credentials"))}
        </div>
      </div>
    );
  }
  function editProfileScreen() {
    const d = editDraft;
    function set(field, value) { setEditDraft(prev => ({ ...prev, [field]: value })); }
    function handlePhotoUpload(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => set("avatarPhoto", reader.result);
      reader.readAsDataURL(file);
    }
    function field(label, value, onChange, placeholder) {
      return (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: T.ts, fontFamily: FONT, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
          <input
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${T.bd}`, background: T.w, color: T.tx, fontSize: 14, fontFamily: FONT, outline: "none" }}
          />
        </div>
      );
    }
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }} {...swipeBackHandlers(cancelEditProfile)}>
        {subScreenHeader("Edit Profile", cancelEditProfile, saveEditProfile)}
        <div style={{ padding: "0 20px 32px" }}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.ts, fontFamily: FONT, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.3 }}>Profile Photo</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: T.pgt, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, overflow: "hidden", flexShrink: 0 }}>
                {d.avatarPhoto ? <img src={d.avatarPhoto} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : d.avatarEmoji}
              </div>
              <label style={{ display: "inline-block", padding: "9px 14px", borderRadius: 10, border: `1px solid ${T.pg}`, color: T.pg, fontSize: 12.5, fontWeight: 700, fontFamily: FONT, cursor: "pointer" }}>
                Upload Photo
                <input type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: "none" }} />
              </label>
              {d.avatarPhoto && (
                <button onClick={() => set("avatarPhoto", null)} style={{ border: "none", background: "none", color: T.ts, fontSize: 12.5, fontWeight: 700, fontFamily: FONT, cursor: "pointer" }}>Remove</button>
              )}
            </div>
            <div style={{ fontSize: 11, fontWeight: 500, color: T.tm, fontFamily: FONT, marginBottom: 10 }}>Or pick an icon instead:</div>
            <div style={{ display: "flex", gap: 8 }}>
              {AVATAR_OPTIONS.map(a => (
                <button key={a} onClick={() => { set("avatarEmoji", a); set("avatarPhoto", null); }} className="hp-chip" style={{ width: 46, height: 46, borderRadius: "50%", border: `2px solid ${!d.avatarPhoto && d.avatarEmoji === a ? T.pg : T.bd}`, background: !d.avatarPhoto && d.avatarEmoji === a ? T.pgt : T.w, fontSize: 20, cursor: "pointer" }}>{a}</button>
              ))}
            </div>
          </div>
          {field("First Name", d.firstName, v => set("firstName", v))}
          {field("Last Name", d.lastName, v => set("lastName", v))}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.ts, fontFamily: FONT, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 }}>About</div>
            <textarea
              value={d.about}
              onChange={e => set("about", e.target.value)}
              rows={4}
              style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${T.bd}`, background: T.w, color: T.tx, fontSize: 14, fontFamily: FONT, outline: "none", resize: "none" }}
            />
          </div>
          {field("Home Operating City", d.homeCity, v => set("homeCity", v), "City, ST")}
          <div style={{ fontSize: 12, fontWeight: 500, color: T.tm, fontFamily: FONT, marginTop: -6 }}>Determines which state's jobs you're eligible for.</div>
        </div>
      </div>
    );
  }

  const FAQ_ITEMS = [
    { q: "How is my payout calculated?", a: "Your labor payout is fixed and shown before you accept a job — it's exactly what you receive, with no fee deducted. Materials reimbursement and tips are 100% yours too." },
  { q: "What happens if a customer declines materials?", a: "The outcome depends on the path. Diagnosis: Inspection Completed + $45 Inspection Visit (Haven $0). Standard: Materials declined — job could not be completed + $30 convenience fee (Haven $0)." },
    { q: "How do I get reimbursed for materials?", a: "Once a customer approves your request, go make the purchase, then submit the actual cost and a receipt photo in the app. You're reimbursed 100% — no platform fee, even if the actual cost differs from your estimate." },
    { q: "Why can't I see certain job categories on my board?", a: "Only jobs in your enabled Work Categories appear. Update them anytime from Profile → Work Categories." },
  ];

  function notificationsScreen() {
    function toggle(key) { setNotifPrefs(prev => ({ ...prev, [key]: !prev[key] })); }
    function row(key, icon, label, desc) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: T.w, border: `1px solid ${T.bd}`, borderRadius: 14, padding: 14, marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 17 }}>{icon}</span>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: T.tx, fontFamily: FONT }}>{label}</div>
              <div style={{ fontSize: 11.5, fontWeight: 500, color: T.ts, fontFamily: FONT, marginTop: 1 }}>{desc}</div>
            </div>
          </div>
          <button className="hp-toggle" onClick={() => toggle(key)} style={{ width: 46, height: 27, borderRadius: 20, background: notifPrefs[key] ? T.pg : T.bd, position: "relative", border: "none", cursor: "pointer", flexShrink: 0 }}>
            <div style={{ position: "absolute", top: 2.5, left: notifPrefs[key] ? 21 : 2.5, width: 22, height: 22, borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 1px 3px rgba(0,0,0,.25)", transition: "left .18s ease" }} />
          </button>
        </div>
      );
    }
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }} {...swipeBackHandlers(() => setProfileView("settings"))}>
        {backHeader("Notifications", () => setProfileView("settings"))}
        <div style={{ padding: "0 20px 32px" }}>
          {row("newJobs", "🧰", "New Job Alerts", "Jobs matching your categories and radius")}
          {row("emergency", "🚨", "Emergency Jobs", "Urgent jobs, even outside your usual hours")}
          {row("materials", "🧾", "Materials Updates", "Customer approvals, declines, and receipt confirmations")}
          {row("earnings", "💰", "Payouts & Earnings", "Completed jobs, tips, and weekly summaries")}
        </div>
      </div>
    );
  }

  function helpSupportScreen() {
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }} {...swipeBackHandlers(() => setProfileView("settings"))}>
        {backHeader("Help & Support", () => setProfileView("settings"))}
        <div style={{ padding: "0 20px 32px" }}>
          <button
            onClick={() => setProfileView("supportChat")}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: T.pgt, border: `1px solid ${T.pg}`, borderRadius: 14, padding: 14, marginBottom: 18, cursor: "pointer", fontFamily: FONT, textAlign: "left" }}
          >
            <span style={{ fontSize: 20 }}>💬</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: T.pgd }}>Chat with Support</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: T.pgd, opacity: 0.8, marginTop: 1 }}>Get quick answers from the Haven team</div>
            </div>
            <span style={{ color: T.pgd, fontSize: 15 }}>›</span>
          </button>
          <div style={{ fontSize: 13, fontWeight: 800, color: T.tx, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 10 }}>Frequently Asked</div>
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 14, padding: 14, marginBottom: 8 }}>
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left", fontFamily: FONT }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: T.tx }}>{item.q}</span>
                <span style={{ fontSize: 16, color: T.tm, flexShrink: 0 }}>{openFaq === i ? "−" : "+"}</span>
              </button>
              {openFaq === i && <div style={{ fontSize: 12.5, fontWeight: 500, color: T.ts, fontFamily: FONT, marginTop: 10, lineHeight: 1.5 }}>{item.a}</div>}
            </div>
          ))}
          <div style={{ fontSize: 13, fontWeight: 800, color: T.tx, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 0.3, margin: "18px 0 10px" }}>Still Need Help?</div>
          <a href="mailto:pro-support@havenpro.example?subject=Haven%20Pro%20Support" style={{ display: "block", textAlign: "center", padding: "13px 0", borderRadius: 14, background: T.pgb, color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: FONT, textDecoration: "none" }}>
            ✉️ Email Support
          </a>
        </div>
      </div>
    );
  }

  function supportChatScreen() {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }} {...swipeBackHandlers(() => setProfileView("helpSupport"))}>
        {backHeader("Support Chat", () => setProfileView("helpSupport"))}
        <div style={{ fontSize: 11, fontWeight: 600, color: T.tm, fontFamily: FONT, textAlign: "center", marginBottom: 6 }}>Demo — replies are simulated for now</div>
        <div className="hp-scroll" style={{ flex: 1, overflowY: "auto", padding: "0 20px 12px" }}>
          {chatBubbles(supportMessages)}
        </div>
        {chatInputBar(supportInput, setSupportInput, sendSupportMessage)}
      </div>
    );
  }

  function settingsScreen() {
    const notifOnCount = Object.values(notifPrefs).filter(Boolean).length;
    return (
      <div className="hp-scroll" style={{ flex: 1, overflowY: "auto" }} {...swipeBackHandlers(() => setProfileView("main"))}>
        {backHeader("Settings", () => setProfileView("main"))}
        <div style={{ padding: "0 20px 32px" }}>
          {navRow("🔔", "Notifications", `${notifOnCount} of ${Object.keys(notifPrefs).length} on`, () => setProfileView("notifications"))}
          <div style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 14, padding: "14px", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: T.tx, fontFamily: FONT }}>Appearance</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: T.ts, fontFamily: FONT, marginTop: 1 }}>{theme === "dark" ? "Dark" : "Light"}</div>
            </div>
            <button
              className="hp-toggle"
              onClick={() => setTheme(t => (t === "dark" ? "light" : "dark"))}
              style={{ width: 46, height: 27, borderRadius: 20, background: theme === "dark" ? T.pg : T.bd, position: "relative", border: "none", cursor: "pointer" }}
            >
              <div style={{ position: "absolute", top: 2.5, left: theme === "dark" ? 21 : 2.5, width: 22, height: 22, borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 1px 3px rgba(0,0,0,.25)", transition: "left .18s ease" }} />
            </button>
          </div>
          {navRow("❓", "Help & Support", `${FAQ_ITEMS.length} common questions answered`, () => setProfileView("helpSupport"))}
          <button disabled style={{ width: "100%", marginTop: 8, padding: "13px 0", borderRadius: 14, border: `1px solid ${T.bd}`, background: "transparent", color: T.tm, fontSize: 14.5, fontWeight: 700, fontFamily: FONT, cursor: "default" }}>Sign Out</button>

          {devTestPanel("account state", [
            { label: "Reset to Fresh Pro", onClick: resetToFreshPro },
            { label: "Load Demo Pro", onClick: loadDemoPro },
            { label: "Jump to Marketplace Ready", onClick: devJumpToMarketplaceReady },
          ])}
        </div>
      </div>
    );
  }

  function profileScreen() {
    if (profileView === "edit" && editDraft) return editProfileScreen();
    if (profileView === "categories" && categoriesDraft) return manageCategoriesScreen();
    if (profileView === "settings") return settingsScreen();
    if (profileView === "notifications") return notificationsScreen();
    if (profileView === "helpSupport") return helpSupportScreen();
    if (profileView === "supportChat") return supportChatScreen();
    if (profileView === "verificationCenter") return verificationCenterScreen();
    if (profileView === "identity") return identityScreen();
    if (profileView === "backgroundCheck") return backgroundCheckScreen();
    if (profileView === "credentials") return credentialsScreen();
    if (profileView === "payout") return payoutScreen();
    if (profileView === "taxInfo" && taxDraft) return taxInfoScreen();
    return profileMainScreen();
  }

  function screenHeader(title) {
    return (
      <div style={{ padding: "28px 20px 16px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.ts, fontFamily: FONT, letterSpacing: 0.2 }}>HAVEN PRO</div>
        <div style={{ fontSize: 24, fontWeight: 900, color: T.tx, fontFamily: FONT, marginTop: 2 }}>{title}</div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════
     ONBOARDING WIZARD — the true first-time experience. Deliberately
     reuses the same production-shaped verification primitives
     (identityVerification/backgroundCheck/payoutAccount/taxProfile,
     their real actions, and their DEV Testing panels) rather than a
     separate simplified onboarding-only verification model — a pro
     experiences the real thing from day one, not a preview of it.
     Provider steps let the pro Continue once they've taken the primary
     action (status !== "not_started"), not only once fully verified —
     a real background check can take days; onboarding shouldn't block
     on that, only Accept Job should (via the existing readiness gate).
     ══════════════════════════════════════════════════════════════════ */
  const ONBOARDING_STEPS = ["welcome", "createAccount", "verifyContact", "createProfile", "chooseCategories", "serviceArea", "identity", "background", "payout", "tax", "credentials", "ready"];
  function onboardingBack() {
    const idx = ONBOARDING_STEPS.indexOf(onboardingStep);
    if (idx > 0) setOnboardingStep(ONBOARDING_STEPS[idx - 1]);
  }
  function onboardingNext() {
    const idx = ONBOARDING_STEPS.indexOf(onboardingStep);
    setOnboardingStep(ONBOARDING_STEPS[idx + 1]);
  }
  function onboardingChrome(title, subtitle, body, continueProps) {
    const idx = ONBOARDING_STEPS.indexOf(onboardingStep);
    const total = ONBOARDING_STEPS.length - 2; // welcome and ready are bookends, not progress ticks
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: T.bg }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 20px 0" }}>
          <button onClick={onboardingBack} style={{ background: "none", border: "none", fontSize: 20, color: T.tx, cursor: "pointer", padding: 0 }}>‹</button>
          <div style={{ flex: 1, height: 5, borderRadius: 3, background: T.bd, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, Math.round((idx / total) * 100))}%`, background: T.pgb, borderRadius: 3, transition: "width .2s ease" }} />
          </div>
        </div>
        <div className="hp-scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 20px 12px" }}>
          <div style={{ fontSize: 21, fontWeight: 900, color: T.tx, fontFamily: FONT, marginBottom: subtitle ? 4 : 16 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12.5, fontWeight: 500, color: T.ts, fontFamily: FONT, marginBottom: 18, lineHeight: 1.5 }}>{subtitle}</div>}
          {body}
        </div>
        {continueProps && (
          <div style={{ padding: "10px 20px 22px" }}>
            <button
              disabled={!continueProps.enabled}
              onClick={continueProps.onClick || onboardingNext}
              style={{ width: "100%", padding: "14px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 15, fontWeight: 800, fontFamily: FONT, cursor: continueProps.enabled ? "pointer" : "default", opacity: continueProps.enabled ? 1 : 0.4 }}
            >
              {continueProps.label || "Continue"}
            </button>
          </div>
        )}
      </div>
    );
  }

  function onboardingWelcomeScreen() {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", background: `linear-gradient(180deg, ${T.pgt} 0%, ${T.bg} 55%)`, padding: "48px 24px 28px" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 900, color: T.pgd, letterSpacing: 1.5, fontFamily: FONT, marginBottom: 4 }}>HAVEN PRO</div>
          <div style={{ fontSize: 30, fontWeight: 900, color: T.tx, fontFamily: FONT, lineHeight: 1.15, marginBottom: 26 }}>Work on<br />your terms.</div>
          {[
            ["📍", "Find nearby work"],
            ["✅", "Choose what you want to take"],
            ["💵", "Know your payout before accepting"],
            ["⏰", "Work when you want"],
          ].map(([icon, text], i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <span style={{ fontSize: 20 }}>{icon}</span>
              <span style={{ fontSize: 14.5, fontWeight: 700, color: T.tx, fontFamily: FONT }}>{text}</span>
            </div>
          ))}
        </div>
        <div>
          <button onClick={() => { setOnboardingStatus("in_progress"); setOnboardingStep("createAccount"); }} style={{ width: "100%", padding: "15px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 15, fontWeight: 800, fontFamily: FONT, cursor: "pointer", marginBottom: 10 }}>
            Create Account
          </button>
          <button onClick={loadDemoPro} style={{ width: "100%", padding: "13px 0", borderRadius: 14, border: `1px solid ${T.bd}`, background: "transparent", color: T.tx, fontSize: 14, fontWeight: 700, fontFamily: FONT, cursor: "pointer" }}>
            Sign In
          </button>
          <div style={{ marginTop: 18, padding: 10, borderRadius: 10, border: `1px dashed ${T.tm}`, textAlign: "center" }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: T.tm, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "monospace", marginBottom: 6 }}>⚙ Dev Testing</div>
            <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
              <button onClick={loadDemoPro} style={{ fontSize: 10.5, fontWeight: 700, padding: "5px 9px", borderRadius: 7, border: `1px solid ${T.tm}`, background: "transparent", color: T.ts, cursor: "pointer", fontFamily: "monospace" }}>Load Demo Pro</button>
              <button onClick={devJumpToMarketplaceReady} style={{ fontSize: 10.5, fontWeight: 700, padding: "5px 9px", borderRadius: 7, border: `1px solid ${T.tm}`, background: "transparent", color: T.ts, cursor: "pointer", fontFamily: "monospace" }}>Jump to Marketplace Ready</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function onboardingCreateAccountScreen() {
    const d = signUpDraft;
    const set = (k, v) => setSignUpDraft(p => ({ ...p, [k]: v }));
    const valid = d.firstName.trim() && d.lastName.trim() && d.email.trim() && d.phone.trim() && d.password.length >= 6 && d.password === d.confirm;
    function submit() {
      if (!d.firstName.trim() || !d.lastName.trim()) { showToast("Enter your first and last name"); return; }
      if (!d.email.trim() || !d.phone.trim()) { showToast("Enter your email and phone number"); return; }
      if (d.password.length < 6) { showToast("Password must be at least 6 characters"); return; }
      if (d.password !== d.confirm) { showToast("Passwords don't match"); return; }
      setFirstName(d.firstName.trim());
      setLastName(d.lastName.trim());
      setAccountEmail(d.email.trim());
      setAccountPhone(d.phone.trim());
      setAccountStatus("signed_in");
      setAccountCreatedAt(Date.now());
      setEmailVerifyStatus("pending");
      setPhoneVerifyStatus("pending");
      onboardingNext();
    }
    return onboardingChrome("Create Account", null, (
      <>
        {formField("First Name", d.firstName, v => set("firstName", v), "Jordan")}
        {formField("Last Name", d.lastName, v => set("lastName", v), "Ellis")}
        {formField("Email", d.email, v => set("email", v), "you@example.com")}
        {formField("Phone Number", d.phone, v => set("phone", v), "(555) 123-4567")}
        {formField("Password", d.password, v => set("password", v), "At least 6 characters")}
        {d.password.length > 0 && d.password.length < 6 && (
          <div style={{ fontSize: 11, fontWeight: 600, color: T.emTx, fontFamily: FONT, marginTop: 4 }}>
            Password must be at least 6 characters
          </div>
        )}
        {formField("Confirm Password", d.confirm, v => set("confirm", v), "Re-enter your password")}
        {d.confirm.length > 0 && d.password !== d.confirm && (
          <div style={{ fontSize: 11, fontWeight: 600, color: T.emTx, fontFamily: FONT, marginTop: 4 }}>
            Passwords don't match
          </div>
        )}
      </>
    ), { enabled: !!valid, onClick: submit });
  }

  function onboardingVerifyContactScreen() {
    const bothVerified = emailVerifyStatus === "verified" && phoneVerifyStatus === "verified";
    const row = (label, value, status, onVerify) => (
      <div style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 14, padding: 14, marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: status === "verified" ? 0 : 10 }}>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.ts, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.tx, fontFamily: FONT, marginTop: 2 }}>{value}</div>
          </div>
          {statusPill(status === "verified" ? "verified" : "pending")}
        </div>
        {status !== "verified" && (
          <button onClick={onVerify} style={{ width: "100%", padding: "11px 0", borderRadius: 12, border: "none", background: T.pgb, color: "#fff", fontSize: 13, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}>
            Verify {label}
          </button>
        )}
      </div>
    );
    return onboardingChrome("Verify Your Contact Info", "This usually arrives by text or email — tap to confirm for this demo.", (
      <>
        {row("Email", accountEmail, emailVerifyStatus, () => setEmailVerifyStatus("verified"))}
        {row("Phone", accountPhone, phoneVerifyStatus, () => setPhoneVerifyStatus("verified"))}
      </>
    ), { enabled: bothVerified });
  }

  function onboardingCreateProfileScreen() {
    function handlePhotoUpload(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => setAvatarPhoto(ev.target.result);
      reader.readAsDataURL(file);
    }
    return onboardingChrome("Create Your Profile", "Haven Pro represents you as an individual — no business info needed.", (
      <>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
          <label style={{ cursor: "pointer" }}>
            <input type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: "none" }} />
            <div style={{ width: 84, height: 84, borderRadius: "50%", background: T.pgt, border: `2px dashed ${T.pg}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, overflow: "hidden" }}>
              {avatarPhoto ? <img src={avatarPhoto} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : avatarEmoji}
            </div>
            <div style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: T.pg, fontFamily: FONT, marginTop: 6 }}>Add Photo (Optional)</div>
          </label>
        </div>
        {formField("Home Operating City", homeCity, setHomeCity, "e.g. Orlando, FL")}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: T.ts, fontFamily: FONT, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 }}>About (Optional)</div>
          <textarea
            value={about}
            onChange={e => setAbout(e.target.value)}
            placeholder="A sentence or two about your experience"
            rows={3}
            style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${T.bd}`, background: T.w, color: T.tx, fontSize: 13.5, fontFamily: FONT, outline: "none", resize: "none" }}
          />
        </div>
      </>
    ), { enabled: !!homeCity.trim() });
  }

  function onboardingChooseCategoriesScreen() {
    function toggle(name) {
      setWorkCategories(prev => {
        const next = new Set(prev);
        next.has(name) ? next.delete(name) : next.add(name);
        return next;
      });
    }
    return onboardingChrome("What kind of work do you want to see?", "Pick the categories you're comfortable performing — this shapes which jobs show up on your board.", (
      <>
        {CATEGORY_GROUPS.map(group => (
          <div key={group.group} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: T.tm, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 8 }}>{group.group}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {group.categories.map(c => pill(c.name, c.icon, workCategories.has(c.name), () => toggle(c.name), "onb-cat-" + c.name))}
            </div>
          </div>
        ))}
      </>
    ), { enabled: workCategories.size > 0 });
  }

  function onboardingServiceAreaScreen() {
    return onboardingChrome("How far will you travel?", `Based out of ${homeCity || "your home city"}.`, (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {RADIUS_OPTIONS.map(r => pill(`${r} mi`, null, travelRadius === r, () => setTravelRadius(r), "onb-radius-" + r))}
      </div>
    ), { enabled: true });
  }

  function onboardingIdentityScreen() {
    const status = identityVerification.status;
    const bothCaptured = identityProgress.idCaptured && identityProgress.selfieCaptured;
    return onboardingChrome("Verify Your Identity", "Customers trust Haven Pros inside their homes. Verified by Persona, Haven's identity partner.", (
      <>
        <div style={{ marginBottom: 16 }}>{statusPill(status)}</div>
        {status === "not_started" && (
          <button onClick={startIdentityVerification} style={{ width: "100%", padding: "13px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}>Start Identity Verification</button>
        )}
        {status === "session_created" && (
          <>
            <button onClick={() => setIdentityProgress(p => ({ ...p, idCaptured: true }))} style={{ width: "100%", marginBottom: 8, padding: "12px 0", borderRadius: 12, border: `1px solid ${identityProgress.idCaptured ? T.pg : T.bd}`, background: identityProgress.idCaptured ? T.pgt : T.w, color: identityProgress.idCaptured ? T.pgd : T.tx, fontSize: 13.5, fontWeight: 700, fontFamily: FONT, cursor: "pointer" }}>{identityProgress.idCaptured ? "✓ " : ""}Government-Issued ID (via Persona)</button>
            <button onClick={() => setIdentityProgress(p => ({ ...p, selfieCaptured: true }))} style={{ width: "100%", marginBottom: 14, padding: "12px 0", borderRadius: 12, border: `1px solid ${identityProgress.selfieCaptured ? T.pg : T.bd}`, background: identityProgress.selfieCaptured ? T.pgt : T.w, color: identityProgress.selfieCaptured ? T.pgd : T.tx, fontSize: 13.5, fontWeight: 700, fontFamily: FONT, cursor: "pointer" }}>{identityProgress.selfieCaptured ? "✓ " : ""}Selfie / Liveness Check (via Persona)</button>
            <button disabled={!bothCaptured} onClick={submitIdentityVerification} style={{ width: "100%", padding: "13px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: FONT, cursor: bothCaptured ? "pointer" : "default", opacity: bothCaptured ? 1 : 0.5 }}>Submit to Persona</button>
          </>
        )}
        {status === "pending" && <div style={{ background: T.dxBg, border: `1px solid ${T.dxBd}`, borderRadius: 14, padding: 16, fontSize: 12.5, fontWeight: 600, color: T.dxTx, textAlign: "center" }}>⏳ Persona is reviewing your submission.</div>}
        {status === "verified" && <div style={{ background: T.pgt, border: `1px solid ${T.pg}`, borderRadius: 14, padding: 16, fontSize: 12.5, fontWeight: 600, color: T.pgd, textAlign: "center" }}>✅ Your identity is verified.</div>}
        {["needs_review", "failed", "expired"].includes(status) && (
          <>
            <div style={{ background: T.emBg, border: `1px solid ${T.emBd}`, borderRadius: 14, padding: 16, fontSize: 12.5, fontWeight: 600, color: T.emTx, textAlign: "center", marginBottom: 14 }}>Persona flagged this one — you can try again.</div>
            <button onClick={retryIdentityVerification} style={{ width: "100%", padding: "13px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}>Try Again</button>
          </>
        )}
        {devTestPanel("Persona", [
          { label: "Verified", onClick: () => devSetIdentityStatus("verified") },
          { label: "Needs Review", onClick: () => devSetIdentityStatus("needs_review") },
          { label: "Failed", onClick: () => devSetIdentityStatus("failed") },
        ])}
      </>
    ), { enabled: status !== "not_started", label: status === "verified" ? "Continue" : status === "not_started" ? "Start above to continue" : "Continue — I'll finish this later" });
  }

  function onboardingBackgroundScreen() {
    const status = backgroundCheck.status;
    return onboardingChrome("Background Check", "Checkr, Haven's screening partner, runs this independently of identity verification.", (
      <>
        <div style={{ marginBottom: 16 }}>{statusPill(status)}</div>
        {status === "not_started" && (
          <button onClick={startBackgroundCheck} style={{ width: "100%", padding: "13px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}>Start Background Check</button>
        )}
        {status === "consent_required" && (
          <div style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 14, padding: 16 }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", marginBottom: 14 }}>
              <input type="checkbox" checked={backgroundConsent} onChange={e => setBackgroundConsent(e.target.checked)} style={{ marginTop: 2 }} />
              <span style={{ fontSize: 12.5, fontWeight: 500, color: T.ts, fontFamily: FONT, lineHeight: 1.4 }}>I authorize Haven to invite me to a background check through Checkr.</span>
            </label>
            <button onClick={authorizeBackgroundCheck} style={{ width: "100%", padding: "13px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}>Authorize Background Check</button>
          </div>
        )}
        {["invited", "pending"].includes(status) && <div style={{ background: T.dxBg, border: `1px solid ${T.dxBd}`, borderRadius: 14, padding: 16, fontSize: 12.5, fontWeight: 600, color: T.dxTx, textAlign: "center" }}>⏳ Checkr is processing your report.</div>}
        {status === "clear" && <div style={{ background: T.pgt, border: `1px solid ${T.pg}`, borderRadius: 14, padding: 16, fontSize: 12.5, fontWeight: 600, color: T.pgd, textAlign: "center" }}>✅ Your background check came back clear.</div>}
        {["consider", "disputed", "suspended", "expired"].includes(status) && <div style={{ background: T.emBg, border: `1px solid ${T.emBd}`, borderRadius: 14, padding: 16, fontSize: 12.5, fontWeight: 600, color: T.emTx, textAlign: "center" }}>This needs a closer look — not an automatic disqualification.</div>}
        {devTestPanel("Checkr", [
          { label: "Clear", onClick: () => devSetBackgroundStatus("clear") },
          { label: "Consider", onClick: () => devSetBackgroundStatus("consider") },
        ])}
      </>
    ), { enabled: status !== "not_started", label: status === "clear" ? "Continue" : status === "not_started" ? "Start above to continue" : "Continue — I'll finish this later" });
  }

  function onboardingPayoutScreen() {
    const status = payoutAccount.status;
    return onboardingChrome("Set Up Payouts", "Haven partners with Stripe Connect — your bank details go directly to Stripe, never to Haven.", (
      <>
        <div style={{ marginBottom: 16 }}>{statusPill(status)}</div>
        {status === "not_started" && (
          <button onClick={startPayoutSetup} style={{ width: "100%", padding: "13px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}>Set Up Payouts with Stripe</button>
        )}
        {status === "pending" && <div style={{ background: T.dxBg, border: `1px solid ${T.dxBd}`, borderRadius: 14, padding: 16, fontSize: 12.5, fontWeight: 600, color: T.dxTx, textAlign: "center" }}>⏳ Stripe is verifying your account details.</div>}
        {status === "enabled" && (
          <div style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, fontFamily: FONT, marginBottom: 4 }}>Bank account</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.ts, fontFamily: FONT }}>•••• {payoutAccount.last4}</div>
          </div>
        )}
        {devTestPanel("Stripe Connect", [{ label: "Enabled", onClick: () => devSetPayoutStatus("enabled") }])}
      </>
    ), { enabled: status !== "not_started", label: status === "enabled" ? "Continue" : status === "not_started" ? "Start above to continue" : "Continue — I'll finish this later" });
  }

  function onboardingTaxScreen() {
    return onboardingChrome("Tax Information", "Haven never collects your SSN or EIN directly — this runs through Stripe Connect's tax reporting tooling.", (
      <>
        {formField("Legal Name", taxLegalName, setTaxLegalName, "As it appears on your tax return")}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: T.ts, fontFamily: FONT, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.3 }}>Tax Classification</div>
          <div style={{ display: "flex", gap: 8 }}>
            {["Individual", "LLC", "Corporation"].map(t => pill(t, null, taxClassification === t, () => setTaxClassification(t), "onb-tc-" + t))}
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>{statusPill(taxProfile.status)}</div>
        {taxProfile.status === "not_started" && (
          <button
            onClick={() => { if (!taxLegalName.trim()) { showToast("Enter your legal name"); return; } setTaxProfile(v => ({ ...v, status: "pending", providerReference: `tax_demo_${Math.floor(1000 + Math.random() * 8999)}` })); }}
            style={{ width: "100%", padding: "13px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 14.5, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}
          >
            Submit
          </button>
        )}
        {devTestPanel("Stripe Connect tax reporting", [{ label: "Verified", onClick: () => devSetTaxStatus("verified") }])}
      </>
    ), { enabled: taxProfile.status !== "not_started", label: taxProfile.status === "verified" ? "Continue" : taxProfile.status === "not_started" ? "Start above to continue" : "Continue — I'll finish this later" });
  }

  function onboardingCredentialsScreen() {
    return onboardingChrome("Add Credentials", "Optional — verified credentials can help customers feel more confident choosing you.", (
      <>
        {credentials.length === 0 && <div style={{ fontSize: 12.5, fontWeight: 500, color: T.ts, fontFamily: FONT, marginBottom: 14 }}>No credentials added yet — that's okay, you can add these anytime from Profile.</div>}
        {credentials.map(c => (
          <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: T.w, border: `1px solid ${T.bd}`, borderRadius: 14, padding: 14, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: T.tx, fontFamily: FONT }}>{c.name}</div>
              <div style={{ fontSize: 11.5, fontWeight: 500, color: T.ts, fontFamily: FONT }}>{c.type}</div>
            </div>
            {statusPill(c.status)}
          </div>
        ))}
        {credentialDraft ? (
          <div style={{ background: T.w, border: `1px solid ${T.pg}`, borderRadius: 14, padding: 14, marginTop: 8 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {["License", "Certification", "Other"].map(t => pill(t, null, credentialDraft.type === t, () => setCredentialDraft(p => ({ ...p, type: t })), "onb-credtype-" + t))}
            </div>
            {formField("Name / Title", credentialDraft.name, v => setCredentialDraft(p => ({ ...p, name: v })), "e.g. Florida Plumbing Contractor")}
            {formField("Jurisdiction / State", credentialDraft.jurisdiction, v => setCredentialDraft(p => ({ ...p, jurisdiction: v })), "e.g. FL")}
            {formField("License / Certificate Number", credentialDraft.number, v => setCredentialDraft(p => ({ ...p, number: v })), "optional")}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setCredentialDraft(null)} style={{ flex: 1, padding: "11px 0", borderRadius: 12, border: `1px solid ${T.bd}`, background: "transparent", color: T.ts, fontSize: 13, fontWeight: 700, fontFamily: FONT, cursor: "pointer" }}>Cancel</button>
              <button onClick={saveCredential} style={{ flex: 1, padding: "11px 0", borderRadius: 12, border: "none", background: T.pgb, color: "#fff", fontSize: 13, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}>Add Credential</button>
            </div>
          </div>
        ) : (
          <button onClick={() => openAddCredential("License")} style={{ width: "100%", border: `1px dashed ${T.bd}`, background: "transparent", color: T.ts, fontSize: 12.5, fontWeight: 700, fontFamily: FONT, cursor: "pointer", padding: "10px 0", borderRadius: 12 }}>+ Add Credential</button>
        )}
      </>
    ), { enabled: true, label: "Skip / Continue" });
  }

  function onboardingReadyScreen() {
    const readinessRow = (label, ok) => (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0" }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ts, fontFamily: FONT }}>{label}</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: ok ? T.pg : T.tm, fontFamily: FONT }}>{ok ? "Complete" : "Pending"}</span>
      </div>
    );
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "40px 24px 28px" }}>
        <div>
          <div style={{ fontSize: 40, marginBottom: 14, textAlign: "center" }}>{marketplaceReady ? "🎉" : "🛠️"}</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: T.tx, fontFamily: FONT, textAlign: "center", marginBottom: 8 }}>
            {marketplaceReady ? "You're ready to find work." : "One more step before you can accept jobs."}
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: T.ts, fontFamily: FONT, textAlign: "center", marginBottom: 24, lineHeight: 1.5 }}>
            {marketplaceReady ? "Go online whenever you want, browse jobs, and accept what fits." : "You can still browse jobs on your board — you just can't accept one until everything below is complete."}
          </div>
          <div style={{ background: T.w, border: `1px solid ${T.bd}`, borderRadius: 18, padding: 18 }}>
            {readinessRow("Profile", profileComplete)}
            {readinessRow("Identity", identityVerified)}
            {readinessRow("Background Check", backgroundApproved)}
            {readinessRow("Payouts", payoutEnabled)}
            {readinessRow("Tax Information", taxComplete)}
          </div>
        </div>
        <button
          onClick={() => { setOnboardingStatus("completed"); setOnboardingStep("done"); goTab("home"); }}
          style={{ width: "100%", padding: "15px 0", borderRadius: 14, border: "none", background: T.pgb, color: "#fff", fontSize: 15, fontWeight: 800, fontFamily: FONT, cursor: "pointer" }}
        >
          {marketplaceReady ? "Find Work" : "Go to Job Board"}
        </button>
      </div>
    );
  }

  function onboardingScreen() {
    if (onboardingStep === "welcome") return onboardingWelcomeScreen();
    if (onboardingStep === "createAccount") return onboardingCreateAccountScreen();
    if (onboardingStep === "verifyContact") return onboardingVerifyContactScreen();
    if (onboardingStep === "createProfile") return onboardingCreateProfileScreen();
    if (onboardingStep === "chooseCategories") return onboardingChooseCategoriesScreen();
    if (onboardingStep === "serviceArea") return onboardingServiceAreaScreen();
    if (onboardingStep === "identity") return onboardingIdentityScreen();
    if (onboardingStep === "background") return onboardingBackgroundScreen();
    if (onboardingStep === "payout") return onboardingPayoutScreen();
    if (onboardingStep === "tax") return onboardingTaxScreen();
    if (onboardingStep === "credentials") return onboardingCredentialsScreen();
    return onboardingReadyScreen();
  }

  function toastEl() {
    if (!toast) return null;
    return (
      <div style={{ position: "absolute", bottom: 96, left: "50%", transform: "translateX(-50%)", background: T.pgd, color: "#FFFFFF", fontFamily: FONT, fontSize: 13, fontWeight: 700, padding: "11px 18px", borderRadius: 12, boxShadow: "0 10px 24px rgba(10,79,56,.35)", whiteSpace: "nowrap", animation: "havenProToastIn .2s ease", zIndex: 40 }}>
        {toast}
      </div>
    );
  }

  const CSS = `
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    body { margin: 0; }
    .haven-pro-frame-outer { padding: 20px; }
    /* App-wide: this is meant to feel like a native app, not a webpage — text
       selection and iOS's long-press callout menu should never trigger from
       normal taps or holds. Inputs/textareas are explicitly exempted since
       people still need to select/edit what they type. */
    button, .hp-phone-frame { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
    input, textarea { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }
    @keyframes havenProToastIn { from { opacity:0; transform:translate(-50%,8px);} to { opacity:1; transform:translate(-50%,0);} }
    .hp-scroll::-webkit-scrollbar { display:none; }
    .hp-scroll { scrollbar-width: none; padding-bottom: calc(84px + env(safe-area-inset-bottom)) !important; }
    .hp-tab-btn { background:none; border:none; cursor:pointer; }
    .hp-accept-btn:active { transform: scale(0.97); }
    .hp-toggle:active { transform: scale(0.98); }
    .hp-chip:active { transform: scale(0.96); }
    .hp-nav-btn:active { transform: scale(0.92); }
  `;

  // Compute outer and inner frame styles to support full-bleed on phones
  const outerStyle = showFrameChrome
    ? { minHeight: "100vh", background: "linear-gradient(155deg,#C7D2CB 0%,#B9C7BE 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT }
    : {
        minHeight: "100dvh",
        background: T.bg,
        display: "flex",
        flexDirection: "column",
        fontFamily: FONT,
        padding: 0,
        // Respect iOS safe areas when launched standalone
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      };
  const frameStyle = showFrameChrome
    ? { width: 390, height: 844, background: T.bg, borderRadius: 46, overflow: "hidden", boxShadow: "0 32px 80px rgba(15,26,23,.30), 0 0 0 1px rgba(15,26,23,.08)", display: "flex", flexDirection: "column", position: "relative" }
    : { width: "100%", height: "100dvh", background: T.bg, borderRadius: 0, overflow: "hidden", display: "flex", flexDirection: "column", position: "relative", boxShadow: "none" };

  return (
    <>
      <style>{CSS}</style>
      <div className="haven-pro-frame-outer" style={outerStyle}>
        <div className="hp-phone-frame" style={frameStyle}>
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {needsOnboarding ? onboardingScreen() : (
              <>
                {tab === "home" && homeScreen()}
                {tab === "jobs" && jobsScreen()}
                {tab === "earnings" && earningsScreen()}
                {tab === "messages" && messagesScreen()}
                {tab === "profile" && profileScreen()}
              </>
            )}
          </div>
          {!needsOnboarding && bottomNav()}
          {toastEl()}
        </div>
      </div>
    </>
  );
}
