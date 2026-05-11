// app/components/NavbarCard.jsx

import { Card, Text, Badge, Button } from "@shopify/polaris";

export default function NavbarCard({ design }) {
  return (
    <div style={cardWrapper}>
      <Card>
        <div style={preview}>
          <div style={fakePreview}>
            {design.name}
          </div>

          {design.isPro && (
            <div style={overlay}>
              🔒
            </div>
          )}
        </div>

        <div style={{ paddingTop: "10px" }}>
          <Text variant="headingMd">{design.name}</Text>
          <Text tone="subdued">{design.desc}</Text>

          <div style={{ marginTop: "8px" }}>
            <Badge tone={design.isPro ? "warning" : "success"}>
              {design.isPro ? "PRO" : "FREE"}
            </Badge>
          </div>

          <div style={{ marginTop: "10px" }}>
            <Button
              fullWidth
              disabled={design.isPro}
              variant="primary"
            >
              {design.isPro ? "Locked" : "Use This Design"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

const cardWrapper = {
  transition: "0.3s",
};

const preview = {
  position: "relative",
};

const fakePreview = {
  height: "120px",
  background: "#111",
  borderRadius: "8px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#fff",
};

const overlay = {
  position: "absolute",
  inset: 0,
  backdropFilter: "blur(4px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "24px",
};