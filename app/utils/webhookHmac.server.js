/**
 * webhookHmac.server.js
 *
 * Explicit raw-body HMAC-SHA256 verification for Shopify webhooks.
 *
 * WHY THIS EXISTS:
 * Shopify's App Store automated review scanner checks that webhook handlers:
 *   1. Read the RAW request body (not parsed JSON) for HMAC computation.
 *   2. Use `X-Shopify-Hmac-Sha256` header as the expected signature.
 *   3. Compute HMAC-SHA256 with the Shopify API Secret.
 *   4. Compare signatures using timing-safe equality (prevents timing attacks).
 *   5. Return 401 on any signature mismatch.
 *
 * The `@shopify/shopify-app-react-router` SDK's `authenticate.webhook()` also
 * verifies HMAC internally, but this explicit utility ensures the verification
 * is auditable, visible, and scanner-compliant.
 *
 * USAGE:
 *   import { verifyShopifyWebhook } from "../utils/webhookHmac.server";
 *
 *   export const action = async ({ request }) => {
 *     const { rawBody, errorResponse } = await verifyShopifyWebhook(request);
 *     if (errorResponse) return errorResponse;          // 401 on bad HMAC
 *     const payload = JSON.parse(rawBody);              // safe to parse now
 *     ...
 *   };
 */

import crypto from "crypto";

/**
 * Verifies a Shopify webhook request using raw-body HMAC-SHA256.
 *
 * @param {Request} request - The incoming Fetch API Request object.
 * @returns {Promise<{ rawBody: string, errorResponse: Response | null }>}
 *   - `rawBody`       — The raw request body string (use this to parse JSON).
 *   - `errorResponse` — A 401 Response if HMAC is invalid, or null if valid.
 */
export async function verifyShopifyWebhook(request) {
  // ── Step 1: Extract the HMAC signature from the request header ──────────
  // Shopify sends the HMAC as a Base64-encoded string in this header.
  const shopifyHmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");

  if (!shopifyHmacHeader) {
    console.error("[WEBHOOK HMAC] Missing X-Shopify-Hmac-Sha256 header.");
    return {
      rawBody: "",
      errorResponse: new Response(
        JSON.stringify({ error: "Unauthorized: Missing HMAC signature header." }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      ),
    };
  }

  // ── Step 2: Read the RAW body as text (MUST happen before any JSON parse) ─
  // Shopify computes the HMAC over the exact raw bytes of the request body.
  // Parsing JSON first changes whitespace/ordering and will break verification.
  const rawBody = await request.text();

  // ── Step 3: Retrieve the Shopify API Secret from the environment ──────────
  const apiSecret = process.env.SHOPIFY_API_SECRET;

  if (!apiSecret) {
    console.error(
      "[WEBHOOK HMAC] SHOPIFY_API_SECRET environment variable is not set."
    );
    return {
      rawBody: "",
      errorResponse: new Response(
        JSON.stringify({ error: "Server misconfiguration: API secret missing." }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      ),
    };
  }

  // ── Step 4: Compute expected HMAC-SHA256 signature ────────────────────────
  // Use the raw body bytes and the API secret as the HMAC key.
  const computedDigest = crypto
    .createHmac("sha256", apiSecret)
    .update(rawBody, "utf8")
    .digest("base64");

  // ── Step 5: Timing-safe comparison ───────────────────────────────────────
  // `crypto.timingSafeEqual` prevents timing-based side-channel attacks.
  // Both buffers must be equal length — pad/compare as Buffers.
  let isValid = false;
  try {
    const headerBuffer = Buffer.from(shopifyHmacHeader, "base64");
    const computedBuffer = Buffer.from(computedDigest, "base64");

    // Lengths must match for timingSafeEqual (avoids early-exit attacks).
    if (headerBuffer.length === computedBuffer.length) {
      isValid = crypto.timingSafeEqual(headerBuffer, computedBuffer);
    }
  } catch (err) {
    console.error("[WEBHOOK HMAC] Error during signature comparison:", err);
    isValid = false;
  }

  // ── Step 6: Reject invalid signatures with 401 ───────────────────────────
  if (!isValid) {
    console.error(
      "[WEBHOOK HMAC] Signature mismatch — request rejected.",
      {
        receivedHmac: shopifyHmacHeader,
        computedHmac: computedDigest,
      }
    );
    return {
      rawBody: "",
      errorResponse: new Response(
        JSON.stringify({ error: "Unauthorized: HMAC signature verification failed." }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      ),
    };
  }

  // ── Step 7: Signature is valid — return raw body for downstream use ───────
  console.log("[WEBHOOK HMAC] Signature verified successfully.");
  return { rawBody, errorResponse: null };
}
