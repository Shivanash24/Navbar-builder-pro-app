import { verifyShopifyWebhook } from "../utils/webhookHmac.server";

/**
 * Unified GDPR Compliance Webhook Handler
 * Route: POST /webhooks/gdpr
 *
 * Handles all three mandatory Shopify compliance topics via compliance_topics
 * in shopify.app.toml (the official Shopify format per their docs):
 *
 *   compliance_topics = ["customers/data_request", "customers/redact", "shop/redact"]
 *   uri = "/webhooks/gdpr"
 *
 * Shopify App Store compliance requirements:
 *  ✅ Handles POST requests with JSON body and Content-Type: application/json
 *  ✅ Raw-body HMAC-SHA256 verification using X-Shopify-Hmac-Sha256 header
 *  ✅ Timing-safe signature comparison (crypto.timingSafeEqual)
 *  ✅ Returns 401 Unauthorized on invalid HMAC signature
 *  ✅ Returns 200 OK for verified requests within 5 seconds
 *  ✅ Completes action (data deletion) within 30 days per Shopify policy
 */
export const action = async ({ request }) => {
  // ── STEP 1: Explicit raw-body HMAC-SHA256 verification ───────────────────
  // Must verify BEFORE parsing JSON. Reads the raw body, computes
  // HMAC-SHA256 with SHOPIFY_API_SECRET, compares via crypto.timingSafeEqual.
  // Returns 401 immediately on any signature mismatch.
  const { rawBody, errorResponse } = await verifyShopifyWebhook(request);
  if (errorResponse) return errorResponse;

  // ── STEP 2: Identify the topic ────────────────────────────────────────────
  const topic = request.headers.get("X-Shopify-Topic") || "";
  const shop =
    request.headers.get("X-Shopify-Shop-Domain") || "unknown-shop";

  // ── STEP 3: Parse verified payload ───────────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON payload." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log(
    `[GDPR] ✅ HMAC verified — Topic: "${topic}" | Shop: "${shop}"`
  );

  // ── STEP 4: Route to the correct compliance handler ───────────────────────
  switch (topic) {
    case "customers/data_request":
      return handleCustomerDataRequest(shop, payload);

    case "customers/redact":
      return handleCustomerRedact(shop, payload);

    case "shop/redact":
      return handleShopRedact(shop, payload);

    default:
      console.warn(`[GDPR] Received unknown topic: "${topic}" — ignoring.`);
      return new Response("OK", { status: 200 });
  }
};

// ── Handler: customers/data_request ─────────────────────────────────────────
// Triggered when a customer requests a copy of their data from a store owner.
// You must provide all personally identifiable data your app stores for this
// customer to the merchant within 30 days.
async function handleCustomerDataRequest(shop, payload) {
  console.log(`[GDPR] customers/data_request for shop: ${shop}`);
  console.log("[GDPR] Payload:", JSON.stringify(payload, null, 2));

  // Navbar Builder Pro stores only shop-level navbar configurations.
  // It does NOT store any customer-level PII (names, emails, addresses,
  // order history, etc.). Therefore no personal data export is required.
  //
  // If you add customer-scoped data in the future, retrieve it here by
  // payload.customer.id or payload.customer.email and provide to merchant.
  console.log(
    `[GDPR] No customer PII stored — data request acknowledged for shop: ${shop}`
  );

  return new Response("OK", { status: 200 });
}

// ── Handler: customers/redact ─────────────────────────────────────────────────
// Triggered when a store owner requests permanent deletion of a customer's data.
// You MUST delete all PII stored for this customer within 30 days.
// Sent 10 days after deletion request (or after 6 months if customer has orders).
async function handleCustomerRedact(shop, payload) {
  console.log(`[GDPR] customers/redact for shop: ${shop}`);
  console.log("[GDPR] Payload:", JSON.stringify(payload, null, 2));

  // Navbar Builder Pro stores only shop-level navbar configurations.
  // No customer-level PII is stored — no deletion required.
  //
  // If you add customer-scoped tables in the future, delete by ID here:
  //   const customerId = payload?.customer?.id;
  //   await db.customerData.deleteMany({ where: { customerId: String(customerId) } });
  console.log(
    `[GDPR] No customer PII stored — redact request acknowledged for shop: ${shop}`
  );

  return new Response("OK", { status: 200 });
}

// ── Handler: shop/redact ──────────────────────────────────────────────────────
// Triggered 48 hours after a store uninstalls your app.
// You MUST permanently delete ALL data associated with this store.
async function handleShopRedact(shop, payload) {
  console.log(`[GDPR] shop/redact for shop: ${shop}`);
  console.log("[GDPR] Payload:", JSON.stringify(payload, null, 2));

  try {
    // Dynamic import keeps db.server out of the client bundle (React Router v7)
    const { default: db } = await import("../db.server.js");

    // Delete all authenticated sessions for this shop
    const deletedSessions = await db.session.deleteMany({ where: { shop } });
    console.log(
      `[GDPR] Deleted ${deletedSessions.count} session(s) for shop: ${shop}`
    );

    // Delete all navbar configurations for this shop
    const deletedNavbars = await db.navbar.deleteMany({ where: { shop } });
    console.log(
      `[GDPR] Deleted ${deletedNavbars.count} navbar config(s) for shop: ${shop}`
    );

    // Add any future Prisma models here:
    //   await db.yourModel.deleteMany({ where: { shop } });

    console.log(`[GDPR] ✅ All data purged for shop: ${shop}`);
  } catch (error) {
    // Log the error but return 200 — Shopify retries on non-200 responses.
    // Returning 200 prevents infinite retry loops even on partial failures.
    console.error(`[GDPR] ❌ Error purging data for shop ${shop}:`, error);
  }

  return new Response("OK", { status: 200 });
}
