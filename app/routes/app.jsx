import { Outlet, useLoaderData, useRouteError, Link } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";


export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server.js");
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

// Patch for React Router history state bug in embedded iframes
if (typeof window !== "undefined" && window.history && window.history.state === null) {
  window.history.replaceState({ key: "default" }, "");
}

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={polarisTranslations}>
        <ShopPersister />
        <ui-nav-menu>
          <Link to="/app" rel="home">Dashboard</Link>
          <Link to="/app/pricing">Pricing &amp; Plans</Link>
        </ui-nav-menu>
        <Outlet />
      </PolarisAppProvider>
    </AppProvider>
  );
}

/**
 * Persists the current shop domain to sessionStorage so the ErrorBoundary
 * can always build a valid /auth?shop= URL — even after billing redirects
 * strip the ?shop= param from the URL.
 */
function ShopPersister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const shop =
        new URL(window.location.href).searchParams.get("shop") ||
        window.__shopify_shop__; // set by App Bridge in some contexts
      if (shop) sessionStorage.setItem("shopify_shop", shop);
    } catch (_) { /* ignore */ }
  }, []);
  return null;
}

// Bug #4 FIXED: Safely extract shop from multiple sources so we never redirect
// to /auth with no shop param (which causes an infinite auth loop).
// Priority order: current URL → document referrer → sessionStorage fallback.
export function ErrorBoundary() {
  const error = useRouteError();
  console.error("ErrorBoundary caught:", error);

  if (error?.status === 401 && typeof window !== "undefined") {
    // 1. Try current URL search params first
    let shop = new URL(window.location.href).searchParams.get("shop");

    // 2. Fall back to the referring page URL (e.g. after a billing redirect)
    if (!shop && document.referrer) {
      try {
        shop = new URL(document.referrer).searchParams.get("shop");
      } catch (_) { /* ignore malformed referrer */ }
    }

    // 3. Fall back to sessionStorage if we stored it during a previous load
    if (!shop) {
      try { shop = sessionStorage.getItem("shopify_shop") || ""; } catch (_) { /**/ }
    }

    const authUrl = `/auth${shop ? `?shop=${encodeURIComponent(shop)}` : ""}`;
    console.log(`[ErrorBoundary] 401 → redirecting to ${authUrl}`);

    if (window.shopify) {
      window.open(authUrl, "_top");
    } else {
      window.parent.location.href = authUrl;
    }
    return null;
  }

  return boundary.error(error);
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
