// Static imports removed to prevent Vercel "Server-only module referenced by client" error

export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server.js");
  const { default: db } = await import("../db.server.js");
  const { payload, session, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  const current = payload.current;

  if (session) {
    await db.session.update({
      where: {
        id: session.id,
      },
      data: {
        scope: current.toString(),
      },
    });
  }

  return new Response();
};
