/**
 * Alias route: /webhooks/shop-redact (hyphenated)
 *
 * This route exists to handle stale webhook registrations in the Shopify
 * Partner Dashboard that were configured with a hyphen URL before the
 * shopify.app.toml was updated to use /webhooks/gdpr.
 *
 * Internally delegates to the same GDPR handler logic.
 */
import { verifyShopifyWebhook } from "../utils/webhookHmac.server";

export const action = async ({ request }) => {
  // ── HMAC Verification ────────────────────────────────────────────────────
  const { rawBody, errorResponse } = await verifyShopifyWebhook(request);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON payload." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const shop =
    request.headers.get("X-Shopify-Shop-Domain") ||
    payload?.domain ||
    payload?.myshopify_domain ||
    payload?.shop_domain;

  console.log(`[GDPR] ✅ HMAC verified — shop/redact (alias route) for shop: ${shop}`);
  console.log("[GDPR] Payload:", JSON.stringify(payload, null, 2));

  // ── Purge ALL shop data ───────────────────────────────────────────────────
  try {
    const { default: db } = await import("../db.server.js");

    const deletedSessions = await db.session.deleteMany({ where: { shop } });
    console.log(`[GDPR] Deleted ${deletedSessions.count} session(s) for shop: ${shop}`);

    const deletedNavbars = await db.navbar.deleteMany({ where: { shop } });
    console.log(`[GDPR] Deleted ${deletedNavbars.count} navbar config(s) for shop: ${shop}`);

    console.log(`[GDPR] ✅ All data purged for shop: ${shop}`);
  } catch (error) {
    console.error(`[GDPR] ❌ Error purging data for shop ${shop}:`, error);
  }

  return new Response("OK", { status: 200 });
};
