// Static imports removed to prevent Vercel "Server-only module referenced by client" error

export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server.js");
  const { default: db } = await import("../db.server.js");
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
