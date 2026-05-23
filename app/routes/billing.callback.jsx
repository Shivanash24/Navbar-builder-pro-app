/**
 * billing.callback — Standalone billing return handler
 *
 * WHY THIS ROUTE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * When Shopify redirects the merchant back after billing approval, the browser
 * makes a TOP-LEVEL navigation to the returnUrl we supplied.  That request:
 *
 *   • Is NOT inside the Shopify Admin iframe
 *   • Has no App Bridge session token
 *   • Has no embedded-app session cookie
 *   • Only carries  ?shop=xxx&charge_id=yyy  in the URL
 *
 * If this request hits any route under /app/* (e.g. /app/billing) the PARENT
 * layout (app.jsx) immediately calls authenticate.admin(request).  Because
 * there is no embedded-app session, the library falls through to /auth/login —
 * the "Shop domain" form the merchant should NEVER see again after installation.
 *
 * THE FIX
 * ─────────────────────────────────────────────────────────────────────────────
 * This route lives at /billing/callback — OUTSIDE the /app hierarchy.
 * It bypasses the embedded auth entirely by using unauthenticated.admin(shop),
 * which retrieves the stored offline access token from the Prisma session table
 * without requiring any embedded context.
 *
 * After confirming (or noting) the subscription it redirects the merchant to the
 * Shopify Admin embedded app URL.  Because the merchant is already logged into
 * Shopify Admin, the app loads normally inside the iframe with full auth.
 */

import { redirect } from "react-router";
// Static imports of .server files removed to prevent Vercel client build errors.

// ─── Constants ─────────────────────────────────────────────────────────────────
const MAX_ATTEMPTS  = 6;   // total GraphQL poll attempts
const BASE_DELAY_MS = 1000; // delay multiplier: 1s, 2s, 3s, 4s, 5s, 6s

// ─── GraphQL subscription check with retry ─────────────────────────────────────
/**
 * Polls Shopify for activeSubscriptions via GraphQL.
 *
 * Shopify can take 1-5 seconds to mark a subscription ACTIVE after the merchant
 * clicks Approve.  We retry with linear back-off rather than a single check.
 *
 * @param {object} admin - GraphQL admin client from unauthenticated.admin()
 * @returns {Array}       - Active subscription objects (empty if declined/still pending)
 */
async function getActiveSubscriptionsWithRetry(admin) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const delayMs = BASE_DELAY_MS * attempt;
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    try {
      const response = await admin.graphql(`#graphql
        {
          currentAppInstallation {
            activeSubscriptions {
              id
              name
              status
            }
          }
        }
      `);

      const { data } = await response.json();
      const subs = data?.currentAppInstallation?.activeSubscriptions ?? [];

      if (subs.length > 0) {
        console.log(
          `[billing/callback] Active subscription found on attempt ${attempt}: "${subs[0].name}" (${subs[0].status})`
        );
        return subs;
      }

      console.log(
        `[billing/callback] Attempt ${attempt}/${MAX_ATTEMPTS}: subscription still PENDING. Retrying in ${BASE_DELAY_MS * (attempt + 1)}ms…`
      );
    } catch (err) {
      console.error(
        `[billing/callback] GraphQL error on attempt ${attempt}:`, err?.message
      );
    }
  }

  console.warn(
    `[billing/callback] No ACTIVE subscription after ${MAX_ATTEMPTS} attempts. Merchant may have declined.`
  );
  return [];
}

// ─── Plan derivation ──────────────────────────────────────────────────────────
/**
 * Derives internal plan key from the subscription name Shopify returns.
 * Must match the plan names defined in shopify.server.js billing config.
 *
 * @param {Array} subscriptions - activeSubscriptions from GraphQL
 * @returns {"free"|"starter"|"pro"}
 */
function planFromSubscriptions(subscriptions) {
  if (!subscriptions?.length) return "free";
  const name = subscriptions[0].name?.toLowerCase() ?? "";
  if (name.includes("pro")) return "pro";
  if (name.includes("starter")) return "starter";
  return "free";
}

// ─── Loader ───────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { unauthenticated } = await import("../shopify.server.js");
  const { default: prisma } = await import("../db.server.js");

  const url    = new URL(request.url);
  const shop   = url.searchParams.get("shop");
  const chargeId = url.searchParams.get("charge_id");

  console.log(
    `[billing/callback] Incoming: shop=${shop ?? "MISSING"} charge_id=${chargeId ?? "none"}`
  );

  // ── Guard: shop is required ─────────────────────────────────────────────────
  if (!shop) {
    console.error("[billing/callback] Missing ?shop= — cannot process billing return.");
    // No shop → fall back to login form so the merchant can identify themselves
    return redirect("/auth/login");
  }

  // ── Embedded return URL ─────────────────────────────────────────────────────
  // After processing we send the merchant here.  This URL opens the app inside
  // the Shopify Admin iframe.  The merchant is already logged into Shopify Admin
  // so no re-authentication is required — App Bridge handles it automatically.
  //
  // Format: https://{shop}/admin/apps/{client_id}
  // The Shopify Admin will embed the app and navigate to the root /app route.
  const apiKey = process.env.SHOPIFY_API_KEY;
  const embeddedAppUrl = `https://${shop}/admin/apps/${apiKey}`;

  // ── Obtain admin client via stored offline token ────────────────────────────
  // unauthenticated.admin(shop) retrieves the offline access token that was
  // stored in our Prisma Session table during app installation.
  // It does NOT need an embedded session — that is exactly what we need here.
  let admin;
  try {
    ({ admin } = await unauthenticated.admin(shop));
    console.log(`[billing/callback] Got admin client for shop=${shop}`);
  } catch (err) {
    // If the offline session is missing or expired we can't do billing check.
    // Redirect to the embedded app anyway — the app's own loaders will do
    // billing.check() once the merchant is back inside the iframe.
    console.error(
      `[billing/callback] unauthenticated.admin() failed for shop=${shop}:`,
      err?.message
    );
    return redirect(embeddedAppUrl);
  }

  // ── Check subscription status with retry ────────────────────────────────────
  let plan = "free";
  try {
    const subs = await getActiveSubscriptionsWithRetry(admin);
    plan = planFromSubscriptions(subs);
    console.log(`[billing/callback] Confirmed plan="${plan}" for shop=${shop}`);
  } catch (err) {
    // Don't crash — plan stays "free" and will self-heal on the next loader run
    console.error("[billing/callback] Subscription check error:", err?.message);
  }

  // ── Persist plan to database ────────────────────────────────────────────────
  try {
    await prisma.navbar.upsert({
      where:  { shop },
      update: { plan },
      create: {
        shop,
        plan,
        designId:  "1",
        menuItems: JSON.stringify([
          { id: "1", label: "Home",    link: "/" },
          { id: "2", label: "Catalog", link: "/collections/all" },
          { id: "3", label: "Contact", link: "/pages/contact"   },
        ]),
      },
    });
    console.log(`[billing/callback] DB updated: shop=${shop} plan=${plan}`);
  } catch (dbErr) {
    // Log and continue — plan will self-heal on next loader run via billing.check()
    console.error("[billing/callback] DB upsert failed:", dbErr?.message);
  }

  // ── Return merchant to the embedded Shopify Admin app ──────────────────────
  // The Shopify Admin URL is visited top-level by the merchant's browser.
  // Shopify Admin authenticates them (they're already logged in) and loads
  // the app in an iframe.  From there, the app operates normally.
  console.log(`[billing/callback] Redirecting to embedded app: ${embeddedAppUrl}`);
  return redirect(embeddedAppUrl);
}

// Required: React Router requires a default export for every route file.
// This component is never rendered — the loader always issues a redirect.
export default function BillingCallbackPage() {
  return null;
}
