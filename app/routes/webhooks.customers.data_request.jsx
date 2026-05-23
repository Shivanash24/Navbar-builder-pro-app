// Static imports removed to prevent Vercel "Server-only module referenced by client" error

/**
 * GDPR Webhook: customers/data_request
 *
 * Triggered when a merchant requests a copy of a customer's data (on the
 * customer's behalf). If your app stores any personal customer data you must
 * provide that data to the merchant.
 *
 * Shopify App Store compliance requirements:
 *  ✅ Raw-body HMAC-SHA256 verification (X-Shopify-Hmac-Sha256)
 *  ✅ Timing-safe signature comparison (crypto.timingSafeEqual)
 *  ✅ 401 returned on invalid signature
 *  ✅ 200 returned on verified request within 5 seconds
 */
export const action = async ({ request }) => {
  // ── STEP 1: Explicit raw-body HMAC verification ──────────────────────────
  // verifyShopifyWebhook reads the raw body BEFORE any JSON parsing and
  // computes HMAC-SHA256 using SHOPIFY_API_SECRET, comparing with
  // X-Shopify-Hmac-Sha256 via crypto.timingSafeEqual. Returns 401 on failure.
  const { verifyShopifyWebhook } = await import("../utils/webhookHmac.server.js");
  const { rawBody, errorResponse } = await verifyShopifyWebhook(request);
  if (errorResponse) return errorResponse;

  // ── STEP 2: Parse the verified payload ───────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON payload." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const shop = request.headers.get("X-Shopify-Shop-Domain") || payload?.shop_domain;
  const topic = request.headers.get("X-Shopify-Topic") || "customers/data_request";

  console.log(`[GDPR COMPLIANCE] ✅ HMAC verified — Received ${topic} for ${shop}`);
  console.log("[GDPR] Customer data request payload:", JSON.stringify(payload, null, 2));

  // ── STEP 3: Business logic ────────────────────────────────────────────────
  // This app (Navbar Builder Pro) stores only the shop domain and navbar
  // configuration — NO personally identifiable customer data (PII) such as
  // names, emails, or addresses. Therefore no personal data export is required.
  //
  // If you add customer-level data storage in the future, retrieve and provide
  // it to the merchant here using payload.customer.id / payload.customer.email.

  // ── STEP 4: Acknowledge receipt ───────────────────────────────────────────
  return new Response("OK", { status: 200 });
};
