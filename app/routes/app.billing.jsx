import { json, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getPlanFromBilling } from "../utils/planAccess";

// ─── Loader ────────────────────────────────────────────────────────────────────
// Runs when Shopify redirects back after the merchant approves/declines billing.
export async function loader({ request }) {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;

  console.log(`[billing loader] Processing return for shop: ${shop}`);

  try {
    const billingCheck = await billing.check({
      plans: ["Starter Plan", "Pro Plan"],
      isTest: process.env.NODE_ENV !== "production",
    });

    const plan = getPlanFromBilling(billingCheck);
    console.log(`[billing loader] shop=${shop} confirmed_plan=${plan}`);

    // Persist/Sync plan to DB
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

    // If no active payment and we expected one, maybe log it
    if (!billingCheck.hasActivePayment) {
      console.warn(`[billing loader] shop=${shop} has no active payment after redirect.`);
    }

  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("[billing loader] error:", error?.message || error);
  }
  
  // Always redirect back to the app dashboard
  return redirect("/app");
}

// ─── Action ────────────────────────────────────────────────────────────────────
// Called when user clicks an "Upgrade" button.
export async function action({ request }) {
  console.log(`[billing action] Incoming request: ${request.method} ${request.url}`);
  console.log(`[billing action] Authorization header: ${request.headers.get("Authorization") ? "Present" : "Missing"}`);

  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const planType = formData.get("planType"); // "starter" | "pro"

  if (!planType) {
    return json({ success: false, error: "Plan type is required" }, { status: 400 });
  }

  const planName = planType === "starter" ? "Starter Plan" : "Pro Plan";

  console.log(`[billing action] shop=${shop} requesting_plan=${planName}`);

  try {
    // ── 1. Check current status ──────────────────────────────────────────────
    const billingCheck = await billing.check({
      plans: ["Starter Plan", "Pro Plan"],
      isTest: process.env.NODE_ENV !== "production",
    });

    const currentPlan = getPlanFromBilling(billingCheck);

    if (currentPlan === planType) {
      return json({
        success: true,
        message: `You are already on the ${planName}.`,
      });
    }

    // ── 2. Request the new plan (triggers App Bridge top-level redirect) ────────
    const url = new URL(request.url);
    const returnUrl = `https://${url.host}/app/billing?shop=${shop}`;

    return await billing.request({
      plan: planName,
      isTest: process.env.NODE_ENV !== "production",
      returnUrl,
    });

  } catch (error) {
    // IMPORTANT: billing.request() throws a Response redirect — we MUST re-throw it 
    // so that Remix/App Bridge can handle the top-level redirect.
    if (error instanceof Response) throw error;

    console.error("[billing action] error:", error?.message || error);
    return json({
      success: false,
      error: error.message || "Billing failed. Please try again.",
    }, { status: 500 });
  }
}