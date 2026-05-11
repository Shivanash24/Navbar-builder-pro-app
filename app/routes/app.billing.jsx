import { json, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getPlanFromBilling } from "../utils/planAccess";

// ─── Loader ────────────────────────────────────────────────────────────────────
// Runs when Shopify redirects back after the merchant approves/declines billing.
// We re-check billing, persist the plan to DB, and send the user home.
export async function loader({ request }) {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const billingCheck = await billing.check({
      plans: ["Starter Plan", "Pro Plan"],
      isTest: true,
    });

    const plan = getPlanFromBilling(billingCheck);
    console.log(`[billing loader] shop=${shop} plan=${plan}`);

    // Persist plan to DB
    await prisma.navbar.upsert({
      where: { shop },
      update: { plan },
      create: {
        shop,
        plan,
        designId: "1",
        menuItems: JSON.stringify([
          { id: "1", label: "Home", link: "/" },
          { id: "2", label: "Catalog", link: "/collections/all" },
          { id: "3", label: "Contact", link: "/pages/contact" },
        ]),
      },
    });
  } catch (error) {
    console.error("[billing loader] error:", error?.message || error);
  }
  
  return redirect("/app");
}

// ─── Action ────────────────────────────────────────────────────────────────────
// Called when user clicks an "Upgrade" button on the pricing page / dashboard.
// Expects FormData field: planType = "starter" | "pro"
export async function action({ request }) {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const planType = formData.get("planType"); // "starter" | "pro"

  const planName = planType === "starter" ? "Starter Plan" : "Pro Plan";
  const otherPlanName = planType === "starter" ? "Pro Plan" : "Starter Plan";

  try {
    // ── 1. Check if already on the requested plan ──────────────────────────────
    const billingCheck = await billing.check({
      plans: ["Starter Plan", "Pro Plan"],
      isTest: true,
    });

    const currentPlan = getPlanFromBilling(billingCheck);

    if (currentPlan === planType) {
      return json({
        success: true,
        message: `You are already on the ${planName}.`,
      });
    }

    // ── 2. Cancel the OTHER plan if currently active (plan switching) ──────────
    if (billingCheck.hasActivePayment) {
      const activeSubs = billingCheck.appSubscriptions ?? [];
      for (const sub of activeSubs) {
        const subNameLower = (sub.name ?? "").toLowerCase();
        const otherNameLower = otherPlanName.toLowerCase();
        if (subNameLower.includes(otherNameLower.split(" ")[0])) {
          try {
            await billing.cancel({
              subscriptionId: sub.id,
              isTest: true,
              prorate: true,
            });
            console.log(`[billing action] Cancelled old subscription: ${sub.name}`);
          } catch (cancelError) {
            console.warn("[billing action] Could not cancel old sub:", cancelError?.message);
          }
        }
      }
    }

    // ── 3. Request the new plan (triggers Shopify payment page) ────────────────
    return await billing.request({
      plan: planName,
      isTest: true,
      returnUrl: `https://${new URL(request.url).host}/app/billing`,
    });

  } catch (error) {
    // billing.request() throws a Response redirect — re-throw it
    if (error instanceof Response) throw error;

    console.error("[billing action] error:", error?.message || error);
    return json({
      success: false,
      error: error.message || "Billing failed. Please try again.",
    });
  }
}