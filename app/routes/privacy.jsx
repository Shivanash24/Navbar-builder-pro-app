export const meta = () => {
  return [{ title: "Privacy Policy - Navbar Builder Pro" }];
};

export default function PrivacyPolicy() {
  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui, -apple-system, sans-serif", lineHeight: "1.6", maxWidth: "800px", margin: "0 auto", color: "#333" }}>
      <h1 style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>Privacy Policy</h1>
      <p style={{ color: "#666", marginBottom: "2rem" }}>Last updated: May 2026</p>

      <h2>1. Information We Collect</h2>
      <p>
        When you install the Navbar Builder Pro App, we are automatically able to access certain types of information from your Shopify account:
      </p>
      <ul>
        <li>Basic shop information (domain, shop ID, email)</li>
        <li>Theme and storefront data required to inject and preview navigation bars</li>
      </ul>
      <p>
        <strong>We do not collect or store any personally identifiable information (PII) of your customers.</strong>
      </p>

      <h2>2. How We Use Your Information</h2>
      <p>We use the information we collect to:</p>
      <ul>
        <li>Provide, operate, and maintain our App.</li>
        <li>Improve, personalize, and expand our App's functionality.</li>
        <li>Understand and analyze how you use our App.</li>
        <li>Process your subscription billing via Shopify's Billing API.</li>
      </ul>

      <h2>3. Sharing Your Information</h2>
      <p>
        We do not share your personal information with third parties except as necessary to provide the App's services or to comply with legal obligations. We share necessary data with Shopify to ensure the proper functioning of the app and billing.
      </p>

      <h2>4. Data Retention and Deletion</h2>
      <p>
        We retain your shop's configuration data as long as the App is installed. 
        Upon uninstallation, all of your associated data (including custom navbar configurations) is permanently deleted from our servers within 48 hours in accordance with Shopify's data redaction policies.
      </p>

      <h2>5. Your Rights</h2>
      <p>
        If you are a European resident, you have the right to access personal information we hold about you and to ask that your personal information be corrected, updated, or deleted. If you would like to exercise this right, please contact us.
      </p>

      <h2>6. Changes</h2>
      <p>
        We may update this privacy policy from time to time in order to reflect, for example, changes to our practices or for other operational, legal, or regulatory reasons.
      </p>

      <h2>7. Contact Us</h2>
      <p>
        For more information about our privacy practices, if you have questions, or if you would like to make a complaint, please contact us by email at shivpareek220@gmail.com.
      </p>
    </div>
  );
}
