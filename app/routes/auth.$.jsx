import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // 🔥 USER CREATE / UPDATE
  await prisma.user.upsert({
    where: { shop },
    update: {},
    create: {
      shop,
      purchasedDesigns: ["design1"], // free by default
    },
  });

  return null;
};