import { useEffect, useState, useCallback } from "react";
import { useActionData, useLoaderData, useNavigation, useSubmit, useRevalidator } from "react-router";
import { Page, Layout, Card, Button, Text, BlockStack, InlineStack, Box, Badge, Grid, TextField, Icon, Modal, Banner, Toast, Frame, Spinner } from "@shopify/polaris";
import { DeleteIcon, LockIcon, ViewIcon, StarFilledIcon } from "@shopify/polaris-icons";
import {
  getPlanFromBilling,
  canAccessDesign,
  getRequiredPlan,
  validateDesignAccess,
  getPlanLabel,
} from "../utils/planAccess";

// ─── Loader ───────────────────────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server.js");
  const { default: prisma } = await import("../db.server.js");
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;

  // Step 1: Fetch the DB record first (always available, even if billing API fails)
  let navbar = await prisma.navbar.findUnique({ where: { shop } });
  if (!navbar) {
    navbar = {
      designId: "1",
      menuItems: [
        { id: "1", label: "Home", link: "/" },
        { id: "2", label: "Catalog", link: "/collections/all" },
        { id: "3", label: "Contact", link: "/pages/contact" },
      ],
      plan: "free",
    };
  }

  // Step 2: Check Shopify billing — use DB plan as fallback if billing.check() fails
  let plan = navbar.plan || "free"; // Start with DB value
  let billingSucceeded = false;

  try {
    const billingCheck = await billing.check({
      plans: ["Starter Plan", "Pro Plan"],
      isTest: process.env.SHOPIFY_BILLING_TEST !== "false",
    });
    plan = getPlanFromBilling(billingCheck);
    billingSucceeded = true;
    console.log(`[index loader] shop=${shop} billing_plan=${plan} hasActivePayment=${billingCheck.hasActivePayment}`);
  } catch (e) {
    if (e instanceof Response) throw e;
    // billing.check() failed — fall back to DB plan to avoid wrongly showing "free"
    console.error(`[index loader] billing check failed, using DB plan="${plan}":`, e?.message);
  }

  // Step 3: Sync billing result to DB (only when billing succeeded and value changed)
  if (billingSucceeded && navbar.id && navbar.plan !== plan) {
    try {
      await prisma.navbar.update({ where: { shop }, data: { plan } });
      console.log(`[index loader] DB synced shop=${shop} plan=${plan}`);
    } catch (dbErr) {
      console.error("[index loader] DB sync failed:", dbErr?.message);
    }
  }

  const menuItems = typeof navbar.menuItems === "string"
    ? JSON.parse(navbar.menuItems)
    : (navbar.menuItems || []);

  return Response.json({ navbar: { ...navbar, menuItems }, plan });
};


// ─── Action ───────────────────────────────────────────────────────────────────
export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server.js");
  const { default: prisma } = await import("../db.server.js");
  const { session, admin, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const designId = formData.get("designId");
  const menuItemsRaw = formData.get("menuItems");
  const actionType = formData.get("actionType");
  const menuItems = JSON.parse(menuItemsRaw);

  if (actionType === "apply") {
    // ── Server-side billing check ─────────────────────────────────────────────
    // Always resolve plan from Shopify API — never trust client-submitted values.
    let plan = "free";
    try {
      const billingCheck = await billing.check({
        plans: ["Starter Plan", "Pro Plan"],
        isTest: process.env.SHOPIFY_BILLING_TEST !== "false",
      });
      plan = getPlanFromBilling(billingCheck);
      console.log(`[index action] shop=${shop} resolved_plan=${plan} designId=${designId}`);
    } catch (e) {
      if (e instanceof Response) throw e;
      // If billing.check() fails, keep plan="free" to enforce the strictest access.
      // This prevents billing API downtime from accidentally granting premium access.
      console.error(`[index action] billing.check() failed for shop=${shop}. Defaulting to free. Error:`, e?.message);
    }

    // ── Centralized server-side access guard ──────────────────────────────────
    // validateDesignAccess() checks:
    //   1. designId is a known/valid ID (rejects spoofed unknown IDs)
    //   2. plan is a recognised plan key
    //   3. The plan's PLAN_DESIGNS list includes this designId (strict isolation)
    const accessError = validateDesignAccess(designId, plan);
    if (accessError) {
      console.warn(
        `[index action] ACCESS DENIED — shop=${shop} plan=${plan} designId=${designId} reason="${accessError}"`
      );
      return Response.json(
        {
          success: false,
          error: accessError,
          requiredPlan: getRequiredPlan(designId),
          currentPlan: plan,
          currentPlanLabel: getPlanLabel(plan),
          requiredPlanLabel: getPlanLabel(getRequiredPlan(designId)),
        },
        { status: 403 }
      );
    }

    // ── Persist to DB ─────────────────────────────────────────────────────────
    await prisma.navbar.upsert({
      where: { shop },
      update: { designId, menuItems: JSON.stringify(menuItems), plan },
      create: { shop, designId, menuItems: JSON.stringify(menuItems), plan },
    });

    // ── Push config to Shopify metafields (storefront reads this) ─────────────
    const shopQuery = await admin.graphql(`{ shop { id } }`);
    const shopData = await shopQuery.json();
    const shopId = shopData.data.shop.id;
    await admin.graphql(
      `mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { key namespace value } userErrors { field message } } }`,
      { variables: { metafields: [{ ownerId: shopId, namespace: "navbar_builder", key: "config", type: "json", value: JSON.stringify({ designId, menuItems }) }] } }
    );

    console.log(`[index action] SUCCESS — shop=${shop} plan=${plan} applied designId=${designId}`);
    return Response.json({ success: true, message: "Design Applied Successfully!" });
  }
  return Response.json({ success: false });
};

// ─── Design Definitions ───────────────────────────────────────────────────────
// MUST stay in sync with PLAN_DESIGNS in utils/planAccess.js.
// requiredPlan here is for UI rendering ONLY — the authoritative access check
// always happens server-side via validateDesignAccess() in the route action.
//
// Plan mapping (strict isolation — no inheritance):
//   FREE    ($0)  → Design 1
//   STARTER ($49) → Designs 2, 3
//   PRO     ($99) → Designs 4, 5, 6
const DESIGNS = [
  // ── Free (1 design) ────────────────────────────────────────────────────────
  { id:"1", name:"Classic Left Logo",     requiredPlan:"free",    tag:"FREE",    popular:false },
  // ── Starter (2 designs) ────────────────────────────────────────────────────
  { id:"2", name:"Centered Split",        requiredPlan:"starter", tag:"STARTER", popular:true  },
  { id:"3", name:"Minimal Transparent",   requiredPlan:"starter", tag:"STARTER", popular:false },
  // ── Pro (3 designs) ────────────────────────────────────────────────────────
  { id:"4", name:"Mega Menu",             requiredPlan:"pro",     tag:"PRO",     popular:false },
  { id:"5", name:"Modern Dark",           requiredPlan:"pro",     tag:"PRO",     popular:false },
  { id:"6", name:"Ultra Sticky Header",   requiredPlan:"pro",     tag:"PRO",     popular:true  },
];

const BADGE_TONE = { free:"success", starter:"info", pro:"warning" };
const PLAN_LABEL = { free:"Free", starter:"Starter", pro:"Pro" };
const PLAN_BADGE_TONE = { free:"subdued", starter:"info", pro:"success" };

// ─── Mini Previews ────────────────────────────────────────────────────────────
function MiniPreview({ id }) {
  const base = { width:"100%", height:160, background:"#f9fafb", display:"flex", justifyContent:"space-between", alignItems:"center", padding:"0 20px", borderBottom:"1px solid #e5e7eb", position:"relative", overflow:"hidden" };
  const logo = { width:32, height:32, background:"#cbd5e1", borderRadius:"50%" };
  const links = { display:"flex", gap:12 };
  const link  = { width:24, height:4, background:"#cbd5e1", borderRadius:2 };
  switch(id) {
    case "1": return <div style={base}><div style={logo}/><div style={links}><div style={link}/><div style={link}/><div style={link}/></div></div>;
    case "2": return <div style={{...base,justifyContent:"center",gap:20}}><div style={links}><div style={link}/><div style={link}/></div><div style={logo}/><div style={links}><div style={link}/><div style={link}/></div></div>;
    case "3": return <div style={{...base,background:"transparent",borderBottom:"none"}}><div style={{...logo,background:"#9ca3af"}}/><div style={links}><div style={{...link,background:"#9ca3af"}}/><div style={{...link,background:"#9ca3af"}}/><div style={{...link,background:"#9ca3af"}}/></div></div>;
    case "4": return <div style={{...base,flexDirection:"column",padding:0}}><div style={{display:"flex",justifyContent:"space-between",padding:10,borderBottom:"1px solid #e5e7eb",width:"100%"}}><div style={{...logo,width:16,height:16}}/><div style={{display:"flex",gap:5}}><div style={{...link,width:10}}/><div style={{...link,width:10}}/></div></div><div style={{display:"flex",justifyContent:"center",padding:8,background:"#f3f4f6",width:"100%"}}><div style={links}><div style={link}/><div style={link}/><div style={link}/></div></div></div>;
    case "5": return <div style={{...base,background:"#111827"}}><div style={{...logo,background:"#475569"}}/><div style={links}><div style={{...link,background:"#475569",width:25}}/><div style={{...link,background:"#475569",width:25}}/><div style={{...link,background:"#475569",width:25}}/></div></div>;
    case "6": return (
      <div style={{...base,flexDirection:"column",padding:0}}>
        <div style={{width:"100%",padding:"10px 20px",background:"linear-gradient(90deg,#4f46e5,#7c3aed)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{...logo,width:22,height:22,background:"rgba(255,255,255,0.3)"}}/>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            <div style={{...link,background:"rgba(255,255,255,0.5)",width:18}}/>
            <div style={{...link,background:"rgba(255,255,255,0.5)",width:18}}/>
            <div style={{width:36,height:16,borderRadius:8,background:"#fff"}}/>
          </div>
        </div>
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"#9ca3af",fontSize:11,background:"#fafafa"}}>Page Content</div>
      </div>
    );
    default: return null;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { navbar, plan } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const revalidator = useRevalidator();

  const [selectedDesign, setSelectedDesign] = useState(navbar.designId || "1");
  const [menuItems, setMenuItems] = useState(navbar.menuItems || []);
  const [isMenuModalOpen, setIsMenuModalOpen] = useState(false);
  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [upgradeModal, setUpgradeModal] = useState({ open:false, requiredPlan:null });
  const [previewDesign, setPreviewDesign] = useState(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);

  const toggleToast = useCallback(() => setToastActive(v => !v), []);
  const isSaving = navigation.state === "submitting";

  useEffect(() => {
    if (previewDesign) {
      setIsPreviewLoading(true);
      const t = setTimeout(() => setIsPreviewLoading(false), 600);
      return () => clearTimeout(t);
    }
  }, [previewDesign]);

  useEffect(() => {
    const pendingDesign = sessionStorage.getItem("pendingDesignId");
    if (pendingDesign && canAccessDesign(pendingDesign, plan)) {
      sessionStorage.removeItem("pendingDesignId");
      const fd = new FormData();
      fd.append("designId", pendingDesign); fd.append("menuItems", JSON.stringify(menuItems)); fd.append("actionType", "apply");
      submit(fd, { method:"post" });
    }
  }, [plan, menuItems, submit]);

  useEffect(() => {
    if (!actionData) return;
    // Note: billing redirect is now handled server-side by re-throwing the Response.
    // This block only handles explicit { redirectUrl } JSON responses (legacy fallback).
    if (actionData?.redirectUrl && typeof window !== "undefined") {
      if (window.shopify?.redirectToExternalUrl) {
        window.shopify.redirectToExternalUrl({ url: actionData.redirectUrl });
      } else if (window.shopify?.openExternalUrl) {
        window.shopify.openExternalUrl(actionData.redirectUrl);
      } else {
        window.parent.location.href = actionData.redirectUrl;
      }
      return;
    }
    if (actionData?.success) { setToastMessage(actionData.message || "Done!"); setToastActive(true); }
    else if (actionData?.error) { setToastMessage(actionData.error); setToastActive(true); }
  }, [actionData]);

  const handleApply = async (design) => {
    if (!canAccessDesign(design.id, plan)) {
      setUpgradeModal({ open:true, requiredPlan: design.requiredPlan });
      return;
    }
    setSelectedDesign(design.id);
    const fd = new FormData();
    fd.append("designId", design.id); fd.append("menuItems", JSON.stringify(menuItems)); fd.append("actionType", "apply");
    
    const token = await window.shopify.idToken();
    submit(fd, { method:"post", action: `/app?id_token=${token}` });
  };

  const confirmUpgrade = async () => {
    const { requiredPlan } = upgradeModal;
    setUpgradeModal({ open: false, requiredPlan: null });
    setBillingLoading(true);

    const fd = new FormData();
    fd.append("planType", requiredPlan);

    try {
      // Get a fresh session token so authenticate.admin() succeeds server-side.
      // The billing action will re-throw the Shopify billing redirect Response,
      // which React Router will handle as a top-level navigation.
      const token = await window.shopify.idToken();
      submit(fd, { method: "post", action: `/app/billing?id_token=${token}` });
    } catch (e) {
      console.error("[confirmUpgrade] Failed to get idToken:", e);
      // Fallback: submit without token
      submit(fd, { method: "post", action: "/app/billing" });
    }
  };

  const renderLivePreview = () => {
    if (!previewDesign) return null;
    const menuEls = menuItems.map((item,i) => <div key={i} style={{fontWeight:500,cursor:"pointer"}}>{item.label}</div>);
    const commonWrap = (children, style={}) => (
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"20px 5%",borderBottom:"1px solid #eaeaea",...style}}>{children}</div>
    );
    const logo = <div style={{fontSize:24,fontWeight:"bold"}}>Store Logo</div>;
    const navEl = (() => {
      switch(previewDesign.id) {
        case "1": return commonWrap(<>{logo}<div style={{display:"flex",gap:25}}>{menuEls}</div></>);
        case "2": { const h=Math.ceil(menuItems.length/2); return <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"center",padding:"20px 5%",background:"white",borderBottom:"1px solid #eaeaea"}}><div style={{display:"flex",gap:25,justifyContent:"flex-end",paddingRight:30}}>{menuItems.slice(0,h).map((it,i)=><div key={i} style={{fontWeight:500}}>{it.label}</div>)}</div>{logo}<div style={{display:"flex",gap:25,justifyContent:"flex-start",paddingLeft:30}}>{menuItems.slice(h).map((it,i)=><div key={i} style={{fontWeight:500}}>{it.label}</div>)}</div></div>; }
        case "3": return commonWrap(<>{logo}<div style={{display:"flex",gap:25}}>{menuEls}</div></>, {background:"transparent"});
        case "4": return <div style={{flexDirection:"column",display:"flex",borderBottom:"1px solid #eaeaea"}}>{commonWrap(<>{logo}<div style={{display:"flex",gap:15}}><div>Search</div><div>Cart</div></div></>,{borderBottom:"1px solid #f0f0f0"})}<div style={{display:"flex",justifyContent:"center",padding:"10px 5%",background:"#f9f9f9"}}><div style={{display:"flex",gap:30}}>{menuEls}</div></div></div>;
        case "5": return commonWrap(<>{logo}<div style={{display:"flex",gap:25}}>{menuItems.map((it,i)=><div key={i} style={{fontWeight:500,color:"white",textTransform:"uppercase",letterSpacing:1,fontSize:14}}>{it.label}</div>)}</div></>, {background:"#121212",color:"white"});
        // PRO — Design 6: Ultra Sticky Header
        case "6": return (
          <div style={{flexDirection:"column",display:"flex",boxShadow:"0 2px 8px rgba(0,0,0,0.1)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 5%",background:"linear-gradient(90deg,#4f46e5,#7c3aed)"}}>
              {<div style={{fontSize:22,fontWeight:"bold",color:"#fff"}}>Store Logo</div>}
              <div style={{display:"flex",gap:24,alignItems:"center"}}>
                {menuItems.map((it,i) => <div key={i} style={{fontWeight:500,color:"rgba(255,255,255,0.85)",fontSize:14}}>{it.label}</div>)}
                <div style={{background:"#fff",color:"#4f46e5",padding:"6px 16px",borderRadius:20,fontWeight:700,fontSize:13,cursor:"pointer"}}>Shop Now</div>
              </div>
            </div>
          </div>
        );
        default: return null;
      }
    })();
    return (
      <Modal open={!!previewDesign} onClose={()=>setPreviewDesign(null)} title={`Live Preview: ${previewDesign.name}`} large>
        <Modal.Section>
          <div style={{width:"100%",height:400,background:"#f4f6f8",borderRadius:8,overflow:"hidden"}}>
            <div style={{height:30,background:"#e1e3e5",display:"flex",alignItems:"center",padding:"0 10px",gap:6}}>
              {["#ff5f56","#ffbd2e","#27c93f"].map(c=><div key={c} style={{width:12,height:12,borderRadius:"50%",background:c}}/>)}
            </div>
            {isPreviewLoading ? <div style={{display:"flex",justifyContent:"center",alignItems:"center",height:100,background:"white"}}><Spinner size="large"/></div> : navEl}
            <div style={{padding:40,textAlign:"center",color:"#6d7175"}}>
              <h1>Your Stunning Storefront</h1>
              <p>The navbar above is exactly how it will appear to your customers.</p>
            </div>
          </div>
        </Modal.Section>
      </Modal>
    );
  };

  const planUpgradeMap = { free:"Upgrade to Starter or Pro", starter:"Upgrade to Pro", pro:null };

  return (
    <Frame>
      <style>{`
        .page-fade-in { animation: fadeIn 0.5s ease-out; }
        @keyframes fadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        .design-card { transition:all 0.3s cubic-bezier(0.4,0,0.2,1); border-radius:16px; overflow:hidden; background:#fff; border:1px solid #e5e7eb; position:relative; display:flex; flex-direction:column; height:100%; }
        .design-card:hover { transform:translateY(-6px); box-shadow:0 20px 25px -5px rgba(0,0,0,0.1); }
        .design-card.starter-card { background:linear-gradient(145deg,#fff,#f0f7ff); }
        .design-card.pro-card { background:linear-gradient(145deg,#fff,#fdf8ff); }
        .design-card.selected-card { border:2px solid #6366F1; box-shadow:0 0 0 4px rgba(99,102,241,0.1); }
        .popular-badge { position:absolute; top:12px; right:12px; background:linear-gradient(90deg,#F59E0B,#ef4444); color:white; padding:4px 10px; border-radius:20px; font-size:11px; font-weight:bold; z-index:10; }
        .lock-overlay { position:absolute; inset:0; background:rgba(0,0,0,0.35); display:flex; align-items:center; justify-content:center; backdrop-filter:blur(1px); }
        .lock-icon-wrap { background:rgba(255,255,255,0.15); border-radius:50%; padding:12px; }
        .mn-logo { width:32px; height:32px; background:#cbd5e1; border-radius:50%; }
        .mn-links { display:flex; gap:12px; }
        .mn-link { width:24px; height:4px; background:#cbd5e1; border-radius:2px; }
        .hover-link:hover { color:#6366F1; }
      `}</style>
      <Page
        title="Navbar Builder Pro"
        subtitle="Elevate your storefront with premium navigation designs"
        primaryAction={{ content:"Manage Menu Links", onAction:()=>setIsMenuModalOpen(true), icon:ViewIcon }}
      >
        <div className="page-fade-in">
          <BlockStack gap="500">

            {/* Plan status bar */}
            <Card>
              <Box padding="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="300" blockAlign="center">
                    <Text variant="headingSm">Current Plan:</Text>
                    <Badge tone={PLAN_BADGE_TONE[plan]} size="large">{PLAN_LABEL[plan]}</Badge>
                  </InlineStack>
                  {plan !== "pro" && (
                    <Button url="/app/pricing" variant="primary">
                      {planUpgradeMap[plan]} →
                    </Button>
                  )}
                </InlineStack>
              </Box>
            </Card>

            {plan === "free" && (
              <Banner title="Unlock Premium Navbar Designs" tone="info">
                <p>Choose the <strong>Starter Plan ($49/mo)</strong> for Designs 2 &amp; 3, or the <strong>Pro Plan ($99/mo)</strong> for Designs 4, 5 &amp; 6.</p>
              </Banner>
            )}
            {plan === "starter" && (
              <Banner title="Upgrade to Pro for Exclusive Premium Designs" tone="warning">
                <p>Unlock 3 premium designs (4, 5 &amp; 6) including the Ultra Sticky Header with the <strong>Pro Plan ($99/mo)</strong>.</p>
              </Banner>
            )}

            <Layout>
              <Layout.Section>
                <Grid>
                  {DESIGNS.map((design) => {
                    const isSelected = selectedDesign === design.id;
                    const hasAccess = canAccessDesign(design.id, plan);
                    const isApplying = isSaving && selectedDesign === design.id;
                    const cardClass = `design-card ${design.requiredPlan === "starter" ? "starter-card" : design.requiredPlan === "pro" ? "pro-card" : ""} ${isSelected ? "selected-card" : ""}`;

                    return (
                      <Grid.Cell key={design.id} columnSpan={{ xs:6, sm:6, md:4, lg:4, xl:4 }}>
                        <div className={cardClass}>
                          {design.popular && <div className="popular-badge">MOST POPULAR ✨</div>}

                          {/* Mini Preview */}
                          <div style={{ position:"relative" }}>
                            <MiniPreview id={design.id} />
                            {!hasAccess && (
                              <div className="lock-overlay">
                                <div className="lock-icon-wrap">
                                  <Icon source={LockIcon} tone="base" />
                                </div>
                              </div>
                            )}
                            {isSelected && hasAccess && (
                              <div style={{ position:"absolute", bottom:10, right:10 }}>
                                <Badge tone="info">Active</Badge>
                              </div>
                            )}
                          </div>

                          {/* Card Content */}
                          <div style={{ padding:20, display:"flex", flexDirection:"column", flexGrow:1 }}>
                            <InlineStack align="space-between" blockAlign="center">
                              <Text variant="headingMd" as="h3">{design.name}</Text>
                              <Badge tone={BADGE_TONE[design.requiredPlan]}>{design.tag}</Badge>
                            </InlineStack>

                            <div style={{ marginTop:"auto", paddingTop:16 }}>
                              <BlockStack gap="200">
                                <Button fullWidth onClick={()=>setPreviewDesign(design)} icon={ViewIcon}>Live Preview</Button>
                                {hasAccess ? (
                                  <Button fullWidth variant="primary" onClick={()=>handleApply(design)} loading={isApplying}>
                                    {isSelected ? "✓ Applied" : "Apply Design"}
                                  </Button>
                                ) : (
                                  <Button fullWidth variant="primary" tone="success" onClick={()=>handleApply(design)}>
                                    🔒 Upgrade to {PLAN_LABEL[design.requiredPlan]}
                                  </Button>
                                )}
                              </BlockStack>
                            </div>
                          </div>
                        </div>
                      </Grid.Cell>
                    );
                  })}
                </Grid>
              </Layout.Section>
            </Layout>
          </BlockStack>
        </div>

        {/* Menu Manager Modal */}
        <Modal open={isMenuModalOpen} onClose={()=>setIsMenuModalOpen(false)} title="Manage Menu Links"
          primaryAction={{ content:"Done", onAction:()=>setIsMenuModalOpen(false) }}
          secondaryActions={[{ content:"Add New Link", onAction:()=>setMenuItems([...menuItems,{id:Date.now().toString(),label:"New Link",link:"/"}]) }]}>
          <Modal.Section>
            <BlockStack gap="400">
              <Text variant="bodyMd" tone="subdued">These links will appear in your active navbar design.</Text>
              {menuItems.map((item) => (
                <div key={item.id} style={{ display:"flex", gap:12, alignItems:"center", background:"#f4f6f8", padding:16, borderRadius:12 }}>
                  <div style={{ flex:1 }}><TextField label="Menu Label" value={item.label} onChange={(v)=>setMenuItems(menuItems.map(m=>m.id===item.id?{...m,label:v}:m))} autoComplete="off"/></div>
                  <div style={{ flex:1 }}><TextField label="URL / Link" value={item.link} onChange={(v)=>setMenuItems(menuItems.map(m=>m.id===item.id?{...m,link:v}:m))} autoComplete="off"/></div>
                  <div style={{ marginTop:24 }}><Button icon={DeleteIcon} tone="critical" variant="plain" onClick={()=>setMenuItems(menuItems.filter(m=>m.id!==item.id))}/></div>
                </div>
              ))}
            </BlockStack>
          </Modal.Section>
        </Modal>

        {/* Upgrade Modal */}
        <Modal open={upgradeModal.open} onClose={()=>setUpgradeModal({open:false,requiredPlan:null})}
          title={`Upgrade to ${PLAN_LABEL[upgradeModal.requiredPlan] || ""} Plan`}
          primaryAction={{ content: billingLoading ? "Processing..." : `Upgrade Now — $${upgradeModal.requiredPlan==="starter"?"49":"99"}/mo`, onAction:confirmUpgrade, loading:billingLoading }}
          secondaryActions={[{ content:"View All Plans", url:"/app/pricing" },{ content:"Cancel", onAction:()=>setUpgradeModal({open:false,requiredPlan:null}) }]}>
          <Modal.Section>
            <BlockStack gap="400">
              <div style={{ textAlign:"center", padding:"20px 0" }}>
                <Icon source={StarFilledIcon} tone="warning" />
                <Text variant="headingLg" as="h2">
                  {upgradeModal.requiredPlan === "starter" ? "Starter Plan — $49/mo" : "Pro Plan — $99/mo"}
                </Text>
                <Box paddingBlockStart="200">
                  <Text variant="bodyLg">
                    {upgradeModal.requiredPlan === "starter"
                      ? "Unlock Designs 2 & 3 — Centered Split and Minimal Transparent."
                      : "Unlock Designs 4, 5 & 6 — Mega Menu, Modern Dark, and Ultra Sticky Header."}
                  </Text>
                </Box>
              </div>
            </BlockStack>
          </Modal.Section>
        </Modal>

        {renderLivePreview()}
        {toastActive && <Toast content={toastMessage} onDismiss={toggleToast} />}
      </Page>
    </Frame>
  );
}
