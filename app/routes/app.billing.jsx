import { redirect } from "@remix-run/node";
import { useEffect } from "react";
import { useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import { isTestBilling } from "../shopify.server";
import prisma from "../db.server";
import { getPlanFromBilling } from "../utils/planAccess";

// ─── Loader ────────────────────────────────────────────────────────────────────
// Runs when Shopify redirects the merchant back after approving/declining billing.
// Shopify appends ?charge_id=xxx to the returnUrl we supplied.
export async function loader({ request }) {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const chargeId = url.searchParams.get("charge_id");
  console.log(`[billing loader] shop=${shop} charge_id=${chargeId ?? "none"}`);

  try {
    // 500ms delay — gives Shopify time to mark the subscription as ACTIVE
    // before we call billing.check() (rare but real race condition)
    await new Promise((resolve) => setTimeout(resolve, 500));

    const billingCheck = await billing.check({
      plans: ["Starter Plan", "Pro Plan"],
      isTest: isTestBilling,
    });

    const plan = getPlanFromBilling(billingCheck);
    console.log(
      `[billing loader] shop=${shop} hasActivePayment=${billingCheck.hasActivePayment} confirmed_plan=${plan}`
    );

    if (!billingCheck.hasActivePayment) {
      console.warn(
        `[billing loader] WARNING: shop=${shop} has no active payment after return. ` +
        `Merchant may have declined. charge_id=${chargeId}`
      );
    }

    // Persist the confirmed plan to DB
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

    console.log(`[billing loader] DB updated shop=${shop} plan=${plan}`);
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("[billing loader] error syncing plan:", error?.message || error);
  }

  // Redirect to Pricing page so the merchant sees their updated plan immediately
  return redirect("/app/pricing");
}

// ─── Action ────────────────────────────────────────────────────────────────────
// Called when confirmUpgrade on the Dashboard submits here.
export async function action({ request }) {
  console.log(`[billing action] ${request.method} ${request.url}`);

  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const planType = formData.get("planType"); // "starter" | "pro"

  if (!planType || !["starter", "pro"].includes(planType)) {
    return Response.json(
      { success: false, error: "Invalid plan type. Must be 'starter' or 'pro'." },
      { status: 400 }
    );
  }

  const planName = planType === "starter" ? "Starter Plan" : "Pro Plan";
  const appUrl = process.env.SHOPIFY_APP_URL;

  if (!appUrl) {
    console.error("[billing action] SHOPIFY_APP_URL is not set!");
    return Response.json(
      { success: false, error: "App configuration error. Please contact support." },
      { status: 500 }
    );
  }

  // The returnUrl must use the PUBLIC app URL — never request.url host
  const returnUrl = `${appUrl}/app/billing`;
  console.log(`[billing action] shop=${shop} plan=${planName} isTest=${isTestBilling} returnUrl=${returnUrl}`);

  try {
    await billing.request({
      plan: planName,
      isTest: isTestBilling,
      returnUrl,
    });

    // Normally billing.request() throws — if it somehow returns, treat as success
    return Response.json({ success: true });

  } catch (error) {
    if (error instanceof Response) {
      // billing.request() throws a Response whose Location header IS the Shopify billing URL.
      // We MUST extract it and return as JSON — do NOT re-throw.
      // Re-throwing causes React Router to follow the redirect in the iframe,
      // which breaks App Bridge and prevents the billing page from loading properly.
      const location = error.headers.get("Location");
      console.log(`[billing action] Billing redirect URL: ${location ?? "none"} (status=${error.status})`);

      if (location) {
        return Response.json({ redirectUrl: location });
      }

      // Re-auth redirect (no Location header means it's an auth error, not billing)
      const reAuthUrl = error.headers.get("X-Shopify-API-Request-Failure-Reauthorize-Url");
      if (reAuthUrl) {
        return Response.json({ redirectUrl: reAuthUrl });
      }

      throw error; // Truly unrecognised Response — propagate
    }

    console.error("[billing action] Unexpected error:", error?.message || error);
    return Response.json(
      {
        success: false,
        error: error?.message || "Billing request failed. Please try again.",
      },
      { status: 500 }
    );
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
// Required: without a default export, React Router cannot render this route
// after the action returns JSON. This component handles the billing redirect
// for upgrades triggered from the Dashboard.
export default function BillingPage() {
  const actionData = useActionData();

  useEffect(() => {
    if (!actionData?.redirectUrl) return;

    console.log("[billing page] Redirecting to Shopify billing:", actionData.redirectUrl);

    // Use App Bridge's redirectToExternalUrl to navigate the TOP-LEVEL window
    // (not just the embedded iframe) to the Shopify billing confirmation page.
    if (typeof window !== "undefined") {
      if (window.shopify?.redirectToExternalUrl) {
        window.shopify.redirectToExternalUrl({ url: actionData.redirectUrl });
      } else if (window.shopify?.openExternalUrl) {
        window.shopify.openExternalUrl(actionData.redirectUrl);
      } else {
        // Fallback for non-embedded context
        window.parent.location.href = actionData.redirectUrl;
      }
    }
  }, [actionData]);

  // Show a minimal loading state while the App Bridge redirect fires
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      gap: 16,
      fontFamily: "sans-serif",
      color: "#6b7280",
    }}>
      <div style={{
        width: 40,
        height: 40,
        border: "3px solid #e5e7eb",
        borderTop: "3px solid #6366f1",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ margin: 0, fontSize: 14 }}>Redirecting to Shopify billing…</p>
    </div>
  );
}