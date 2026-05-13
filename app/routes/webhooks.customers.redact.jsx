import { verifyShopifyWebhook } from "../utils/webhookHmac.server";

/**
 * GDPR Webhook: customers/redact
 *
 * Triggered when a merchant requests permanent deletion of a customer's
 * personal data. You MUST delete all PII stored for this customer.
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
  const topic = request.headers.get("X-Shopify-Topic") || "customers/redact";

  console.log(`[GDPR COMPLIANCE] ✅ HMAC verified — Received ${topic} for ${shop}`);
  console.log("[GDPR] Customer redact payload:", JSON.stringify(payload, null, 2));

  // ── STEP 3: Delete customer PII ───────────────────────────────────────────
  // This app (Navbar Builder Pro) stores only shop-level navbar config — it
  // does NOT store any customer-level PII (no emails, addresses, or order data).
  //
  // If you add customer-level tables in the future, delete by customer ID here:
  //   const customerId = payload?.customer?.id;
  //   await db.customerData.deleteMany({ where: { customerId: String(customerId) } });
  //
  // Sessions are indexed by shop, not by individual customer ID — no action needed.

  try {
    console.log(
      `[GDPR] No customer PII stored for shop "${shop}" — redact request acknowledged.`
    );
  } catch (error) {
    // Log errors but still return 200 so Shopify does not retry indefinitely.
    console.error(`[GDPR] Error during customer redact for shop ${shop}:`, error);
  }

  // ── STEP 4: Acknowledge receipt ───────────────────────────────────────────
  return new Response("OK", { status: 200 });
};
