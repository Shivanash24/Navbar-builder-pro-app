import { authenticate } from "../shopify.server";

/**
 * GDPR Webhook: customers/data_request
 * 
 * Purpose: This webhook is triggered when a store owner requests a copy of a 
 * customer's data on behalf of the customer. You must provide this data to the 
 * store owner if your app stores any personal customer data.
 * 
 * Shopify Review Compliance: Must return a 200 OK within 5 seconds.
 */
export const action = async ({ request }) => {
  // HMAC Verification: authenticate.webhook strictly validates the request signature
  // ensuring it originated securely from Shopify.
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[GDPR COMPLIANCE] Received ${topic} webhook for ${shop}`);
  console.log("Customer data request payload:", JSON.stringify(payload, null, 2));

  // If your app stores customer data (e.g. emails, addresses), implement logic here
  // to package that data and provide it to the merchant.
  
  // Respond with 200 OK immediately to acknowledge receipt and prevent retries.
  return new Response("OK", { status: 200 });
};
