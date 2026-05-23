
/**
 * Auth catch-all route — handles Shopify OAuth callback redirects.
 *
 * Bug #5 FIXED: The original code called `prisma.user.upsert()` but there is
 * NO `User` model in schema.prisma (only `Session` and `Navbar`). This caused
 * a Prisma "Unknown model `user`" error → 500 on every fresh install or re-auth.
 *
 * Fix: replaced with `prisma.navbar.upsert()` which safely initialises the shop
 * record on first install without requiring a non-existent model.
 */
export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server.js");
  const { default: prisma } = await import("../db.server.js");
  let session;

  try {
    ({ session } = await authenticate.admin(request));
  } catch (err) {
    // Re-throw Responses (Shopify auth redirects) — the framework must handle these
    if (err instanceof Response) throw err;
    console.error("[auth.$] authenticate.admin() threw unexpectedly:", err?.message);
    throw err;
  }

  const shop = session.shop;
  console.log(`[auth.$] Authenticated shop=${shop}. Initialising Navbar record.`);

  // Safely create the Navbar record for this shop on first install.
  // `update: {}` means we never overwrite existing data — this is idempotent.
  try {
    await prisma.navbar.upsert({
      where: { shop },
      update: {}, // never overwrite existing config on re-auth
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
    console.log(`[auth.$] Navbar record ensured for shop=${shop}`);
  } catch (dbErr) {
    // Log but do not crash — the session is already valid; the record will be
    // created on the next loader call that does its own upsert.
    console.error(`[auth.$] Navbar upsert failed for shop=${shop}:`, dbErr?.message);
  }

  return null;
};