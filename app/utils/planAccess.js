/**
 * planAccess.js — Navbar Builder Pro
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SINGLE SOURCE OF TRUTH for all plan → design access control.
 *
 * Architecture: STRICT ISOLATION
 *   Each plan owns exactly its assigned designs.
 *   Higher plans do NOT inherit lower-plan designs.
 *   This is intentional — it enforces hard feature boundaries between tiers.
 *
 * Plan structure:
 * Plan structure:
 *   FREE    ($0/mo) → Designs: 1
 *   STARTER ($49/mo)→ Designs: 1, 2, 3
 *   PRO     ($99/mo)→ Designs: 1, 4, 5, 6
 *
 * Adding a new plan or design:
 *   1. Add the design ID to the correct array in PLAN_DESIGNS below.
 *   2. Add the design to the DESIGNS array in app._index.jsx.
 *   3. Add a MiniPreview case in app._index.jsx.
 *   4. Add a billing plan entry in shopify.server.js (if it is a new paid plan).
 *   Nothing else needs to change — all helpers derive from PLAN_DESIGNS.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Plan → Design Mapping ────────────────────────────────────────────────────
/**
 * Strict, isolated per-plan design lists.
 * A design ID must appear in EXACTLY ONE plan's list.
 * There is NO inheritance — Pro does not include Starter designs.
 *
 * @type {Record<string, string[]>}
 */
export const DESIGN_OWNERSHIP = {
  "1": "free",
  "2": "starter",
  "3": "starter",
  "4": "pro",
  "5": "pro",
  "6": "pro",
};

export const PLAN_DESIGNS = {
  free:    ["1"],
  starter: ["1", "2", "3"],
  pro:     ["1", "4", "5", "6"],
};

// ─── All valid design IDs ─────────────────────────────────────────────────────
/**
 * Derived set of every known design ID.
 * Used by the backend guard to reject unknown/spoofed design IDs.
 *
 * @type {Set<string>}
 */
export const ALL_DESIGN_IDS = new Set(Object.keys(DESIGN_OWNERSHIP));

// ─── Valid plan names ─────────────────────────────────────────────────────────
/** @type {Set<string>} */
export const ALL_PLANS = new Set(Object.keys(PLAN_DESIGNS));


// ─── Core Access Guard ────────────────────────────────────────────────────────
/**
 * Returns true if the given plan is allowed to access the given designId.
 *
 * This is the ONLY function that should be called for access checks — both
 * server-side (in route actions/loaders) and client-side (for UI rendering).
 *
 * Strict isolation: a Pro user CANNOT access Starter or Free designs.
 *
 * @param {string} designId - e.g. "3"
 * @param {string} plan     - "free" | "starter" | "pro"
 * @returns {boolean}
 */
export function canAccessDesign(designId, plan) {
  if (!ALL_PLANS.has(plan)) return false;           // reject unknown plans
  if (!ALL_DESIGN_IDS.has(String(designId))) return false; // reject unknown designs
  const allowed = PLAN_DESIGNS[plan] ?? [];
  return allowed.includes(String(designId));
}

/**
 * Server-side guard that validates BOTH the plan and the designId before
 * any database write. Returns an error string on failure or null on success.
 *
 * Usage in route action:
 *   const err = validateDesignAccess(designId, plan);
 *   if (err) return Response.json({ success: false, error: err }, { status: 403 });
 *
 * @param {unknown} designId - Raw value from formData (may be null/malformed)
 * @param {string}  plan     - Resolved plan from Shopify billing API
 * @returns {string | null}  - Error message, or null if access is allowed
 */
export function validateDesignAccess(designId, plan) {
  const id = String(designId ?? "").trim();

  // 1. Design ID must be a known value — reject spoofed / unknown IDs
  if (!ALL_DESIGN_IDS.has(id)) {
    return `Design "${id}" does not exist.`;
  }

  // 2. Plan must be recognised
  if (!ALL_PLANS.has(plan)) {
    return `Plan "${plan}" is not recognised.`;
  }

  // 3. Access check
  if (!canAccessDesign(id, plan)) {
    const required = getRequiredPlan(id);
    return `Design ${id} requires the ${required} plan. Your current plan is ${plan}.`;
  }

  return null; // access granted
}


// ─── Plan Lookup Helpers ──────────────────────────────────────────────────────
/**
 * Returns which plan owns the given designId.
 * Derived from DESIGN_PLAN_MAP — always consistent with PLAN_DESIGNS.
 *
 * @param {string} designId
 * @returns {"free" | "starter" | "pro"}
 */
export function getRequiredPlan(designId) {
  return DESIGN_OWNERSHIP[String(designId)] ?? "free";
}

/**
 * Determines the merchant's current plan from a Shopify billing.check() result.
 * Falls through to "free" when no active subscription is found.
 *
 * @param {object} billingCheck - Result of billing.check({ plans: [...] })
 * @returns {"free" | "starter" | "pro"}
 */
export function getPlanFromBilling(billingCheck) {
  if (!billingCheck?.hasActivePayment) return "free";

  const activeSub = billingCheck.appSubscriptions?.[0];
  if (!activeSub) return "free";

  const name = activeSub.name?.toLowerCase() ?? "";
  if (name.includes("pro")) return "pro";
  if (name.includes("starter")) return "starter";
  return "free";
}

/**
 * Returns a human-readable label for a plan key.
 * @param {"free"|"starter"|"pro"} plan
 * @returns {string}
 */
export function getPlanLabel(plan) {
  return { free: "Free", starter: "Starter", pro: "Pro" }[plan] ?? plan;
}

/**
 * Returns the designs assigned to a given plan.
 * Use this for UI rendering (e.g. showing a plan's included features).
 *
 * @param {"free"|"starter"|"pro"} plan
 * @returns {string[]}
 */
export function getDesignsForPlan(plan) {
  return PLAN_DESIGNS[plan] ?? [];
}
