import { useEffect, useState, useCallback } from "react";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "react-router";
import {
  Page, Card, Text, BlockStack, InlineStack, Box,
  Badge, Frame, Toast, Banner,
} from "@shopify/polaris";
import { getPlanFromBilling } from "../utils/planAccess";

// ─── Loader ────────────────────────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server.js");
  const { default: prisma } = await import("../db.server.js");
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;

  // Fetch DB record first as baseline
  const navbarRecord = await prisma.navbar.findUnique({ where: { shop } });
  let plan = navbarRecord?.plan || "free"; // DB value as starting point

  try {
    const billingCheck = await billing.check({
      plans: ["Starter Plan", "Pro Plan"],
      isTest: process.env.SHOPIFY_BILLING_TEST !== "false",
    });
    plan = getPlanFromBilling(billingCheck);
    console.log(`[pricing loader] shop=${shop} plan=${plan} hasActivePayment=${billingCheck.hasActivePayment}`);

    // Sync confirmed plan to DB
    await prisma.navbar.upsert({
      where: { shop },
      update: { plan },
      create: {
        shop,
        plan,
        designId: "1",
        menuItems: JSON.stringify([{ id: "1", label: "Home", link: "/" }]),
      },
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    // billing.check() failed — we'll display the DB plan value instead of forcing "free"
    console.error(`[pricing loader] billing check failed, using DB plan="${plan}":`, e?.message);
  }

  return Response.json({ plan });
};


// ─── Action ────────────────────────────────────────────────────────────────────
export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server.js");
  console.log(`[pricing action] ${request.method} ${request.url}`);

  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const planType = formData.get("planType");

  if (!planType || !["starter", "pro"].includes(planType)) {
    return Response.json(
      { success: false, error: "Invalid plan type." },
      { status: 400 }
    );
  }

  const planName = planType === "starter" ? "Starter Plan" : "Pro Plan";
  console.log(`[pricing action] shop=${shop} requesting_plan=${planName}`);

  // Build returnUrl from SHOPIFY_APP_URL — NEVER use request.url host
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) {
    console.error("[pricing action] SHOPIFY_APP_URL is not set!");
    return Response.json(
      { success: false, error: "App configuration error. Please contact support." },
      { status: 500 }
    );
  }
  // CRITICAL FIX: returnUrl now points to /billing/callback — a STANDALONE route
  // outside the /app/* hierarchy.  See billing.callback.jsx for full explanation.
  //
  // Previously /app/billing?shop= triggered the /app layout's authenticate.admin()
  // on a top-level (non-iframe) request → no embedded session → /auth/login shown.
  //
  // Now /billing/callback?shop= uses unauthenticated.admin(shop) (offline token)
  // and redirects the merchant back to Shopify Admin's embedded URL — no login form.
  const returnUrl = `${appUrl}/billing/callback?shop=${encodeURIComponent(shop)}`;
  console.log(`[pricing action] returnUrl=${returnUrl}`);

  try {
    await billing.request({
      plan: planName,
      isTest: process.env.SHOPIFY_BILLING_TEST !== "false",
      returnUrl,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      // Extract the Shopify billing URL — NEVER re-throw this Response.
      // Re-throwing causes React Router to follow the 302 inside the iframe,
      // which breaks App Bridge top-level navigation to the billing page.
      const location = error.headers.get("Location");
      console.log(`[pricing action] Billing redirect URL: ${location ?? "none"} (status=${error.status})`);

      if (location) {
        return Response.json({ redirectUrl: location });
      }

      // Re-auth redirect from Shopify
      const reAuthUrl = error.headers.get("X-Shopify-API-Request-Failure-Reauthorize-Url");
      if (reAuthUrl) {
        return Response.json({ redirectUrl: reAuthUrl });
      }

      throw error; // Truly unrecognised Response — propagate
    }

    console.error("[pricing action] Unexpected error:", error?.message || error);
    return Response.json(
      {
        success: false,
        error: error?.message || "Billing request failed. Please try again.",
      },
      { status: 500 }
    );
  }
};

// ─── Component ─────────────────────────────────────────────────────────────────
export default function PricingPage() {
  const { plan } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [toastActive, setToastActive] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const toggleToast = useCallback(() => setToastActive((v) => !v), []);
  const isLoading = navigation.state === "submitting";

  useEffect(() => {
    if (!actionData) return;

    // The pricing action now returns { redirectUrl } (the Shopify billing page URL).
    // We must use App Bridge's redirectToExternalUrl to navigate the TOP-LEVEL window.
    // Using window.open or iframe navigation breaks the embedded app context.
    if (actionData.redirectUrl) {
      console.log("[pricing page] Redirecting to Shopify billing:", actionData.redirectUrl);
      if (typeof window !== "undefined") {
        if (window.shopify?.redirectToExternalUrl) {
          window.shopify.redirectToExternalUrl({ url: actionData.redirectUrl });
        } else if (window.shopify?.openExternalUrl) {
          window.shopify.openExternalUrl(actionData.redirectUrl);
        } else {
          window.parent.location.href = actionData.redirectUrl;
        }
      }
      return;
    }

    if (actionData.message) {
      setToastMsg(actionData.message);
      setToastActive(true);
    }
    if (actionData.error) {
      setToastMsg(actionData.error);
      setToastActive(true);
    }
  }, [actionData]);

  const upgrade = async (planType) => {
    const fd = new FormData();
    fd.append("planType", planType);

    // Inject the Shopify session token so authenticate.admin() works
    // even when App Bridge doesn't auto-inject it into fetch requests.
    try {
      const token = await window.shopify.idToken();
      submit(fd, { method: "post", action: `/app/pricing?id_token=${token}` });
    } catch (e) {
      console.error("[pricing] Failed to get idToken:", e);
      // Fallback: submit without token (may work if session cookie is valid)
      submit(fd, { method: "post" });
    }
  };

  const planLabel = { free: "Free", starter: "Starter", pro: "Pro" }[plan] ?? "Free";
  const planColor = { free: "subdued", starter: "info", pro: "success" }[plan] ?? "subdued";

  const starterFeatures = [
    "3 Exclusive Starter Designs (Designs 2, 3 & 4)",
    "Centered Split — balanced logo-centered layout",
    "Minimal Transparent — clean, overlay-friendly bar",
    "Mega Menu — dual-row with category navigation",
    "Mobile Responsive & Fast Loading",
    "24/7 Support",
  ];
  const proFeatures = [
    "3 Exclusive Pro Designs (Designs 5, 6 & 7)",
    "Modern Dark — sleek dark-mode premium navbar",
    "Sidebar / Hamburger — off-canvas slide-out menu",
    "Ultra Sticky Header — gradient bar with CTA button",
    "Advanced Animations & Premium Layout Control",
    "Priority Support",
  ];

  return (
    <Frame>
      <style>{`
        .pricing-page { animation: fadeIn 0.5s ease-out; }
        @keyframes fadeIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        .pricing-card {
          border-radius: 20px;
          border: 1.5px solid #e5e7eb;
          background: #fff;
          padding: 36px 32px;
          display: flex;
          flex-direction: column;
          gap: 20px;
          transition: box-shadow 0.3s, transform 0.3s;
          position: relative;
          height: 100%;
        }
        .pricing-card:hover { box-shadow: 0 20px 40px rgba(0,0,0,0.10); transform: translateY(-4px); }
        .pricing-card.pro-card {
          background: linear-gradient(145deg, #0f172a, #1e293b);
          border-color: #6366f1;
          box-shadow: 0 8px 32px rgba(99,102,241,0.25);
          color: #f1f5f9;
        }
        .pro-card .pricing-price { color: #a5b4fc; }
        .pro-card .pricing-period { color: #94a3b8; }
        .recommended-badge {
          position: absolute;
          top: -14px;
          left: 50%;
          transform: translateX(-50%);
          background: linear-gradient(90deg,#6366f1,#8b5cf6);
          color: #fff;
          padding: 4px 18px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.5px;
          white-space: nowrap;
        }
        .pricing-feature {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 14px;
          padding: 6px 0;
        }
        .feature-check {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: linear-gradient(135deg,#10b981,#059669);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 11px;
          color: white;
          font-weight: bold;
        }
        .pro-card .feature-check { background: linear-gradient(135deg,#6366f1,#8b5cf6); }
        .pricing-divider { height: 1px; background: #e5e7eb; margin: 8px 0; }
        .pro-card .pricing-divider { background: #334155; }
        .pricing-price { font-size: 48px; font-weight: 800; line-height: 1; color: #111827; }
        .pricing-period { font-size: 14px; color: #6b7280; margin-top: 4px; }
        .plan-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
        @media (max-width: 700px) { .plan-grid { grid-template-columns: 1fr; } }
        .current-badge {
          display: inline-flex; align-items: center; gap: 6px;
          background: #d1fae5; color: #065f46; border-radius: 20px;
          padding: 4px 14px; font-size: 13px; font-weight: 600; margin-top: 8px;
        }
        .upgrade-btn {
          width: 100%; padding: 14px; border-radius: 12px; border: none; cursor: pointer;
          font-size: 16px; font-weight: 700; transition: all 0.2s;
        }
        .upgrade-btn-starter {
          background: linear-gradient(135deg,#6366f1,#4f46e5);
          color: white;
        }
        .upgrade-btn-starter:hover { box-shadow: 0 8px 20px rgba(99,102,241,0.4); transform: scale(1.02); }
        .upgrade-btn-pro {
          background: linear-gradient(135deg,#a5b4fc,#818cf8);
          color: #0f172a;
        }
        .upgrade-btn-pro:hover { box-shadow: 0 8px 20px rgba(165,180,252,0.4); transform: scale(1.02); }
        .upgrade-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none !important; }
      `}</style>

      <Page
        title="Pricing & Plans"
        subtitle="Choose the plan that fits your store. Upgrade or switch anytime."
        backAction={{ content: "Dashboard", url: "/app" }}
      >
        <div className="pricing-page">
          <BlockStack gap="600">

            {/* Current plan status */}
            <Card>
              <Box padding="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingMd">Your Current Plan</Text>
                    <Text variant="bodyMd" tone="subdued">
                      {plan === "free"    && "You're on the Free plan. Upgrade to unlock premium designs."}
                      {plan === "starter" && "You're on the Starter plan. Designs 2, 3 & 4 are unlocked!"}
                      {plan === "pro"     && "You're on the Pro plan. Designs 5, 6 & 7 are fully unlocked!"}
                    </Text>
                  </BlockStack>
                  <Badge tone={planColor} size="large">{planLabel} Plan</Badge>
                </InlineStack>
              </Box>
            </Card>

            {plan === "pro" && (
              <Banner tone="success" title="You have the Pro Plan — exclusive premium designs unlocked!">
                <p>Designs 5 (Modern Dark), 6 (Sidebar / Hamburger) &amp; 7 (Ultra Sticky Header) are active for your store.</p>
              </Banner>
            )}

            {/* Pricing Cards */}
            <div className="plan-grid">

              {/* ── Starter Card ── */}
              <div className="pricing-card">
                <div>
                  <Text variant="headingLg" as="h2">Starter Plan</Text>
                  <div className="pricing-price">$49</div>
                  <div className="pricing-period">per month</div>
                </div>
                <div className="pricing-divider" />
                <div>
                  {starterFeatures.map((f, i) => (
                    <div className="pricing-feature" key={i}>
                      <span className="feature-check">✓</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                <div className="pricing-divider" />
                {plan === "starter" ? (
                  <div className="current-badge">✓ Current Plan</div>
                ) : plan === "pro" ? (
                  <button
                    className="upgrade-btn upgrade-btn-starter"
                    onClick={() => upgrade("starter")}
                    disabled={isLoading}
                  >
                    {isLoading ? "Processing..." : "Switch to Starter"}
                  </button>
                ) : (
                  <button
                    className="upgrade-btn upgrade-btn-starter"
                    onClick={() => upgrade("starter")}
                    disabled={isLoading}
                  >
                    {isLoading ? "Processing..." : "Upgrade to Starter →"}
                  </button>
                )}
              </div>

              {/* ── Pro Card (highlighted) ── */}
              <div className="pricing-card pro-card">
                <div className="recommended-badge">⭐ RECOMMENDED</div>
                <div>
                  <Text variant="headingLg" as="h2" tone="inherit">Pro Plan</Text>
                  <div className="pricing-price">$99</div>
                  <div className="pricing-period">per month</div>
                </div>
                <div className="pricing-divider" />
                <div>
                  {proFeatures.map((f, i) => (
                    <div className="pricing-feature" key={i} style={{ color: "#e2e8f0" }}>
                      <span className="feature-check">✓</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                <div className="pricing-divider" />
                {plan === "pro" ? (
                  <div className="current-badge" style={{ background: "#312e81", color: "#a5b4fc" }}>
                    ✓ Current Plan
                  </div>
                ) : (
                  <button
                    className="upgrade-btn upgrade-btn-pro"
                    onClick={() => upgrade("pro")}
                    disabled={isLoading}
                  >
                    {isLoading ? "Processing..." : "Upgrade to Pro →"}
                  </button>
                )}
              </div>

            </div>

            {/* Free plan note */}
            <Card>
              <Box padding="400">
                <BlockStack gap="200">
                  <Text variant="headingSm">Free Plan (Always Included)</Text>
                  <Text variant="bodyMd" tone="subdued">
                    Design 1 (Classic Left Logo) is always free — no subscription required.
                    Your store always has at least one beautiful navbar.
                  </Text>
                </BlockStack>
              </Box>
            </Card>

          </BlockStack>
        </div>

        {toastActive && <Toast content={toastMsg} onDismiss={toggleToast} />}
      </Page>
    </Frame>
  );
}
