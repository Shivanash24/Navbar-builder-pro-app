import { redirect, Form, useLoaderData } from "react-router";

import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  const { login } = await import("../../shopify.server.js");
  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      {/* Background Orbs */}
      <div className={styles.orb1}></div>
      <div className={styles.orb2}></div>

      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.logo}>Navbar Builder Pro</div>
        </header>

        <main className={styles.main}>
          <section className={styles.hero}>
            <h1 className={styles.heading}>
              Elevate Your Shopify <span className={styles.highlight}>Navigation</span>
            </h1>
            <p className={styles.text}>
              Transform your store's header into a high-converting, professional navigation experience in seconds.
            </p>

            {showForm && (
              <div className={styles.formContainer}>
                <Form className={styles.form} method="post" action="/auth/login">
                  <div className={styles.inputGroup}>
                    <label htmlFor="shop" className={styles.label}>
                      Shopify Domain
                    </label>
                    <input
                      id="shop"
                      className={styles.input}
                      type="text"
                      name="shop"
                      placeholder="my-store.myshopify.com"
                      required
                    />
                  </div>
                  <button className={styles.button} type="submit">
                    Install App
                  </button>
                </Form>
              </div>
            )}
          </section>

          <section className={styles.features}>
            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>✨</div>
              <h3 className={styles.featureTitle}>Premium Designs</h3>
              <p className={styles.featureText}>
                Choose from highly optimized, modern navbar templates built for conversion.
              </p>
            </div>
            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>📱</div>
              <h3 className={styles.featureTitle}>Fully Responsive</h3>
              <p className={styles.featureText}>
                Flawless navigation on desktop, tablet, and mobile devices.
              </p>
            </div>
            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>⚡</div>
              <h3 className={styles.featureTitle}>Zero Coding</h3>
              <p className={styles.featureText}>
                Apply stunning headers instantly without touching your theme code.
              </p>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
