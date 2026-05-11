import { authenticate } from "../shopify.server";

/**
 * GDPR Webhook: customers/redact
 * 
 * Purpose: This webhook is triggered when a store owner requests that a 
 * customer's personal data be deleted. You must permanently delete all 
 * associated personal data for this customer from your database.
 * 
 * Shopify Review Compliance: Must return a 200 OK within 5 seconds.
 */
export const action = async ({ request }) => {
  // HMAC Verification: authenticate.webhook strictly validates the request signature
  // ensuring it originated securely from Shopify.
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[GDPR COMPLIANCE] Received ${topic} webhook for ${shop}`);
  console.log("Customer redact payload:", JSON.stringify(payload, null, 2));

  // If your app stores customer data (e.g. tracking specific users, orders), 
  // you MUST delete that data here using the payload.customer.id.
  
  // Respond with 200 OK immediately to acknowledge receipt and prevent retries.
  return new Response("OK", { status: 200 });
};
