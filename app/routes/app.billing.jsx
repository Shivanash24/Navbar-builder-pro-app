// Bug #1 FIXED: was `import { redirect } from "@remix-run/node"` which is wrong for
// React Router v7. That mismatched Response object caused the 500 Internal Server Error.
import { redirect } from "react-router";
import { useEffect } from "react";
import { useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import { isTestBilling } from "../shopify.server";
import prisma from "../db.server";
import { getPlanFromBilling } from "../utils/planAccess";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Retry billing.check() with exponential backoff.
 *
 * Shopify can take 2-3 seconds to transition a subscription from PENDING → ACTIVE
 * after the merchant clicks Approve. A single attempt with a 500ms delay is not
 * reliable. We retry up to `maxAttempts` times before giving up.
 *
 * Bug #6 FIXED: replaced the single 500ms setTimeout with this retry helper.
 */
async function checkBillingWithRetry(billing, maxAttempts = 5, baseDelayMs = 800) {
  let lastResult = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Wait before each attempt (doubles each time: 800ms, 1600ms, 2400ms …)
    const delay = baseDelayMs * attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      const billingCheck = await billing.check({
        plans: ["Starter Plan", "Pro Plan"],
        isTest: isTestBilling,
      });
      lastResult = billingCheck;

      if (billingCheck.hasActivePayment) {
        console.log(
          `[billing loader] Billing confirmed on attempt ${attempt}/${maxAttempts}`
        );
        return billingCheck;
      }

      console.log(
        `[billing loader] Attempt ${attempt}/${maxAttempts}: no active payment yet. Retrying…`
      );
    } catch (err) {
      // Re-throw Responses (auth redirects) immediately — do not retry those
      if (err instanceof Response) throw err;
      console.error(`[billing loader] billing.check() error on attempt ${attempt}:`, err?.message);
      lastResult = null;
    }
  }

  // Return last known result even if hasActivePayment is false (merchant may have declined)
  return lastResult;
}

// ─── Loader ────────────────────────────────────────────────────────────────────
// Runs when Shopify redirects the merchant back after approving/declining billing.
// Shopify appends ?charge_id=xxx&shop=xxx to the returnUrl we supplied.
export async function loader({ request }) {
  console.log(`[billing loader] Incoming request: ${request.url}`);

  let session, billing;
  try {
    ({ session, billing } = await authenticate.admin(request));
  } catch (authErr) {
    // Re-throw Responses (Shopify will redirect to OAuth) — do NOT catch these
    if (authErr instanceof Response) throw authErr;
    console.error("[billing loader] authenticate.admin() threw:", authErr?.message);
    // If auth fails for any other reason, send to /auth with the shop param so
    // the merchant is NOT asked to type their store name again.
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop") || "";
    return redirect(`/auth${shop ? `?shop=${encodeURIComponent(shop)}` : ""}`);
  }

  const shop = session.shop;
  const url = new URL(request.url);
  const chargeId = url.searchParams.get("charge_id");
  console.log(`[billing loader] shop=${shop} charge_id=${chargeId ?? "none"}`);

  try {
    // Bug #6 FIXED: retry with backoff instead of a single unreliable 500ms delay
    const billingCheck = await checkBillingWithRetry(billing);
    const plan = getPlanFromBilling(billingCheck);

    console.log(
      `[billing loader] shop=${shop} hasActivePayment=${billingCheck?.hasActivePayment} confirmed_plan=${plan}`
    );

    if (!billingCheck?.hasActivePayment) {
      console.warn(
        `[billing loader] WARNING: shop=${shop} has no active payment after ${5} retries. ` +
          `Merchant may have declined. charge_id=${chargeId ?? "none"}`
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

    console.log(`[billing loader] DB updated: shop=${shop} plan=${plan}`);
  } catch (error) {
    // Re-throw Responses (auth redirects from Shopify library) — never swallow these
    if (error instanceof Response) throw error;
    console.error("[billing loader] Error syncing plan:", error?.message || error);
    // Continue to redirect even on DB error — plan will self-heal on next load
  }

  // Redirect to Pricing page so the merchant sees their updated plan immediately
  return redirect("/app/pricing");
}

// ─── Action ────────────────────────────────────────────────────────────────────
// Called when the Dashboard's upgrade modal submits here.
export async function action({ request }) {
  console.log(`[billing action] ${request.method} ${request.url}`);

  let session, billing;
  try {
    ({ session, billing } = await authenticate.admin(request));
  } catch (authErr) {
    if (authErr instanceof Response) throw authErr;
    console.error("[billing action] authenticate.admin() threw:", authErr?.message);
    return Response.json(
      { success: false, error: "Authentication failed. Please refresh and try again." },
      { status: 401 }
    );
  }

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

  // Bug #2 FIXED: include ?shop= so the auth middleware can find the session
  // when Shopify redirects the top-level window back to this URL after approval.
  // Without ?shop=, the middleware starts a brand-new OAuth flow → login re-prompt.
  const returnUrl = `${appUrl}/app/billing?shop=${encodeURIComponent(shop)}`;
  console.log(
    `[billing action] shop=${shop} plan=${planName} isTest=${isTestBilling} returnUrl=${returnUrl}`
  );

  try {
    await billing.request({
      plan: planName,
      isTest: isTestBilling,
      returnUrl,
    });

    // Normally billing.request() throws a redirect Response — if it somehow returns, treat as success
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      // billing.request() throws a Response whose Location header IS the Shopify billing URL.
      // We MUST extract it and return as JSON — do NOT re-throw.
      // Re-throwing causes React Router to follow the redirect inside the embedded iframe,
      // which breaks App Bridge and prevents the billing approval page from loading properly.
      const location = error.headers.get("Location");
      console.log(
        `[billing action] Shopify billing redirect URL: ${location ?? "none"} (status=${error.status})`
      );

      if (location) {
        return Response.json({ redirectUrl: location });
      }

      // Re-auth redirect (missing Location means it is an auth error, not billing)
      const reAuthUrl = error.headers.get(
        "X-Shopify-API-Request-Failure-Reauthorize-Url"
      );
      if (reAuthUrl) {
        console.warn(`[billing action] Re-auth required for shop=${shop}: ${reAuthUrl}`);
        return Response.json({ redirectUrl: reAuthUrl });
      }

      // Truly unrecognised Response — propagate so the framework handles it
      throw error;
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

// ─── Component ─────────────────────────────────────────────────────────────────
// Required: without a default export React Router cannot render this route
// when the action returns a JSON response. This handles upgrade redirects
// triggered from the Dashboard upgrade modal.
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
        // Fallback: navigate parent frame for non-embedded contexts
        window.parent.location.href = actionData.redirectUrl;
      }
    }
  }, [actionData]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        gap: 16,
        fontFamily: "sans-serif",
        color: "#6b7280",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          border: "3px solid #e5e7eb",
          borderTop: "3px solid #6366f1",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ margin: 0, fontSize: 14 }}>Redirecting to Shopify billing…</p>
    </div>
  );
}