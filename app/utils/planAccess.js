/**
 * planAccess.js — Navbar Builder Pro
 * Central source of truth for plan-to-design mapping and access control.
 */

// Which designs each plan can access (design IDs as strings)
export const PLAN_DESIGNS = {
  free:    ["1"],
  starter: ["1", "2", "3"],
  pro:     ["1", "4", "5", "6"],
};

/**
 * Returns true if the given plan allows access to the given designId.
 * @param {string} designId - e.g. "2"
 * @param {string} plan     - "free" | "starter" | "pro"
 */
export function canAccessDesign(designId, plan) {
  const allowed = PLAN_DESIGNS[plan] ?? PLAN_DESIGNS.free;
  return allowed.includes(String(designId));
}

/**
 * Determines the user's current plan from a Shopify billing check result.
 * Checks most-privileged plan first.
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
 * Returns which plan is required to access a given design.
 * @param {string} designId
 * @returns {"free" | "starter" | "pro"}
 */
export function getRequiredPlan(designId) {
  const id = String(designId);
  if (["2", "3"].includes(id)) return "starter";
  if (["4", "5", "6"].includes(id)) return "pro";
  return "free";
}
