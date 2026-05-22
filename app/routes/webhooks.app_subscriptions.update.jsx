import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getPlanFromBilling } from "../utils/planAccess";

/**
 * Webhook: app_subscriptions/update
 *
 * Fired by Shopify whenever a merchant's app subscription changes status:
 * - ACTIVE → CANCELLED (merchant cancels from Shopify admin)
 * - ACTIVE → DECLINED  (payment failed)
 * - ACTIVE → EXPIRED   (trial ended without conversion)
 * - PENDING → ACTIVE   (merchant just approved billing)
 *
 * This ensures the DB plan is always in sync with Shopify's billing state,
 * even if the merchant manages subscriptions from outside the app.
 */
export const action = async ({ request }) => {
  let shop, payload, topic;

  try {
    ({ shop, payload, topic } = await authenticate.webhook(request));
  } catch (error) {
    console.error("[webhook app_subscriptions/update] Auth failed:", error?.message);
    return new Response("Webhook authentication failed", { status: 401 });
  }

  console.log(`[webhook ${topic}] shop=${shop}`);
  console.log(`[webhook ${topic}] payload=${JSON.stringify(payload)}`);

  try {
    const status = payload?.app_subscription?.status?.toUpperCase();
    const planName = payload?.app_subscription?.name ?? "";

    console.log(`[webhook ${topic}] plan="${planName}" status="${status}"`);

    if (status === "ACTIVE") {
      // Subscription is now active — determine which plan
      const plan = planName.toLowerCase().includes("pro")
        ? "pro"
        : planName.toLowerCase().includes("starter")
          ? "starter"
          : "free";

      console.log(`[webhook ${topic}] Activating plan="${plan}" for shop=${shop}`);

      await prisma.navbar.upsert({
        where: { shop },
        update: { plan },
        create: {
          shop,
          plan,
          designId: "1",
          menuItems: JSON.stringify([
            { id: "1", label: "Home", link: "/" },
            { id: "2", label: "Catalog", link: "/collections/all" },
            { id: "3", label: "Contact", link: "/pages/contact" },
          ]),
        },
      });

      console.log(`[webhook ${topic}] DB updated: shop=${shop} plan=${plan}`);
    } else if (
      status === "CANCELLED" ||
      status === "DECLINED" ||
      status === "EXPIRED" ||
      status === "FROZEN"
    ) {
      // Subscription is no longer active — downgrade to free
      console.log(
        `[webhook ${topic}] Downgrading shop=${shop} to free (status=${status})`
      );

      await prisma.navbar.upsert({
        where: { shop },
        update: { plan: "free" },
        create: {
          shop,
          plan: "free",
          designId: "1",
          menuItems: JSON.stringify([
            { id: "1", label: "Home", link: "/" },
            { id: "2", label: "Catalog", link: "/collections/all" },
            { id: "3", label: "Contact", link: "/pages/contact" },
          ]),
        },
      });

      console.log(`[webhook ${topic}] DB updated: shop=${shop} plan=free (downgraded)`);
    } else {
      // PENDING or unknown — no action needed
      console.log(`[webhook ${topic}] No DB change for status="${status}"`);
    }
  } catch (error) {
    // Log but still return 200 — Shopify will retry on non-2xx responses,
    // which could cause repeated webhook delivery loops.
    console.error(`[webhook ${topic}] Error processing webhook:`, error?.message || error);
  }

  return new Response(null, { status: 200 });
};
