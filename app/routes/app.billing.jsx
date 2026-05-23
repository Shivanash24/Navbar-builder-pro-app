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

// ─── Loader ───────────────────────────────────────────────────────────────
// NOTE: The billing RETURN from Shopify is now handled by the standalone
// /billing/callback route (billing.callback.jsx).
//
// This loader handles the rare case where the merchant or a redirect lands
// directly on /app/billing from within the embedded app context.  In that
// case authenticate.admin() works fine (iframe → session token present) and
// we simply send them to the Pricing page.
export async function loader({ request }) {
  console.log(`[billing loader] Direct navigation to /app/billing — redirecting to /app/pricing`);

  try {
    // Authenticate only to ensure the session is valid before redirecting.
    // This is only reached from inside the embedded app (iframe context), so
    // authenticate.admin() will succeed without triggering the login page.
    await authenticate.admin(request);
  } catch (authErr) {
    if (authErr instanceof Response) throw authErr;
    console.error("[billing loader] authenticate.admin() error:", authErr?.message);
  }

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

  // CRITICAL FIX: returnUrl now points to /billing/callback — a STANDALONE route
  // outside the /app/* hierarchy.
  //
  // Previously: /app/billing?shop=xxx
  //   → The parent layout (app.jsx) calls authenticate.admin() on this top-level
  //     request.  No embedded session exists → library redirects to /auth/login
  //     (the "Shop domain" form).  Merchant has to type their store name again.
  //
  // Now: /billing/callback?shop=xxx
  //   → No parent layout, no authenticate.admin() call.
  //   → Uses unauthenticated.admin(shop) (stored offline token) to check billing.
  //   → Redirects merchant to Shopify Admin embedded URL — already authenticated.
  const returnUrl = `${appUrl}/billing/callback?shop=${encodeURIComponent(shop)}`;
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