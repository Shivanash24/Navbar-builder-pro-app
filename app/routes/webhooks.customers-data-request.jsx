/**
 * Alias route: /webhooks/customers-data-request (hyphenated)
 *
 * Handles stale webhook registrations with hyphenated URL format.
 * Delegates to the same GDPR handler logic as /webhooks/gdpr.
 */
// Static imports removed to prevent Vercel "Server-only module referenced by client" error

export const action = async ({ request }) => {
  const { verifyShopifyWebhook } = await import("../utils/webhookHmac.server.js");
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
    request.headers.get("X-Shopify-Shop-Domain") || payload?.shop_domain;
  const topic = request.headers.get("X-Shopify-Topic") || "customers/data_request";

  console.log(`[GDPR] ✅ HMAC verified — ${topic} (alias route) for shop: ${shop}`);
  console.log("[GDPR] No customer PII stored — data request acknowledged.");

  return new Response("OK", { status: 200 });
};
