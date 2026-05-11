import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR Webhook: shop/redact
 * 
 * Purpose: This webhook is triggered 48 hours after a store uninstalls your app.
 * You must permanently delete all data associated with this store from your database.
 * 
 * Shopify Review Compliance: Must return a 200 OK within 5 seconds.
 */
export const action = async ({ request }) => {
  // HMAC Verification: authenticate.webhook strictly validates the request signature
  // ensuring it originated securely from Shopify.
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[GDPR COMPLIANCE] Received ${topic} webhook for ${shop}`);
  console.log("Shop redact payload:", JSON.stringify(payload, null, 2));

  // It's critical to clean up data related to the shop. 
  // We delete the shop's session (if it exists) and any associated data.
  try {
    await db.session.deleteMany({ where: { shop } });
    
    // NOTE: If you store other models (like Navbars, Settings) associated with 
    // this shop, you should delete them here as well.
    console.log(`Successfully purged data for shop: ${shop}`);
  } catch (error) {
    console.error(`Error purging data for shop ${shop}:`, error);
  }
  
  // Respond with 200 OK immediately to acknowledge receipt and prevent retries.
  return new Response("OK", { status: 200 });
};
