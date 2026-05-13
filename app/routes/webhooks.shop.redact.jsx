import { verifyShopifyWebhook } from "../utils/webhookHmac.server";

/**
 * GDPR Webhook: shop/redact
 *
 * Triggered 48 hours after a store uninstalls your app. You MUST permanently
 * delete ALL data associated with this store (sessions, configs, etc).
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

  const shop =
    request.headers.get("X-Shopify-Shop-Domain") ||
    payload?.domain ||
    payload?.myshopify_domain;
  const topic = request.headers.get("X-Shopify-Topic") || "shop/redact";

  console.log(`[GDPR COMPLIANCE] ✅ HMAC verified — Received ${topic} for ${shop}`);
  console.log("[GDPR] Shop redact payload:", JSON.stringify(payload, null, 2));

  // ── STEP 3: Purge ALL shop data ───────────────────────────────────────────
  // Delete every record associated with this shop from every table.
  try {
    // Dynamic import keeps db.server out of the client bundle (React Router v7 requirement).
    const { default: db } = await import("../db.server.js");

    // Delete all authenticated sessions for this shop.
    const deletedSessions = await db.session.deleteMany({ where: { shop } });
    console.log(
      `[GDPR] Deleted ${deletedSessions.count} session(s) for shop: ${shop}`
    );

    // Delete all navbar configurations for this shop.
    // This is the primary app data stored for each merchant.
    const deletedNavbars = await db.navbar.deleteMany({ where: { shop } });
    console.log(
      `[GDPR] Deleted ${deletedNavbars.count} navbar config(s) for shop: ${shop}`
    );

    // ── Add any future models here ─────────────────────────────────────────
    // If you add new Prisma models tied to a shop, purge them here:
    //   await db.yourNewModel.deleteMany({ where: { shop } });

    console.log(`[GDPR] ✅ All data purged successfully for shop: ${shop}`);
  } catch (error) {
    // Log the error but still return 200 — Shopify will not retry on 200.
    // Failing silently here prevents infinite retry loops.
    console.error(`[GDPR] ❌ Error purging data for shop ${shop}:`, error);
  }

  // ── STEP 4: Acknowledge receipt ───────────────────────────────────────────
  return new Response("OK", { status: 200 });
};
