import { Page, Layout } from "@shopify/polaris";
import NavbarGrid from "../components/NavbarGrid";

export default function NavbarPage() {
  return (
    <Page title="Navbar Design Selector">
      <Layout>
        <Layout.Section>
          <NavbarGrid />
        </Layout.Section>
      </Layout>
    </Page>
  );
}