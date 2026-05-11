export default function NavbarPreview({ design, menu }) {

    // 🔥 DESIGN 1 (FREE)
    if (design === "design1") {
      return (
        <nav style={{ background: "#0f172a", padding: "12px" }}>
          {menu.map((item) => (
            <a key={item.title} href={item.link} style={{ margin: "10px", color: "#fff" }}>
              {item.title}
            </a>
          ))}
        </nav>
      );
    }
  
    // 💎 DESIGN 2 (GRADIENT PREMIUM)
    if (design === "design2") {
      return (
        <nav style={{
          background: "linear-gradient(90deg,#ff7e5f,#feb47b)",
          padding: "15px",
          borderRadius: "10px"
        }}>
          {menu.map((item) => (
            <button key={item.title} style={{ margin: "10px" }}>
              {item.title}
            </button>
          ))}
        </nav>
      );
    }
  
    // 💎 DESIGN 3 (GLASSMORPHISM)
    if (design === "design3") {
      return (
        <nav style={{
          backdropFilter: "blur(10px)",
          background: "rgba(255,255,255,0.1)",
          padding: "15px",
          borderRadius: "12px"
        }}>
          {menu.map((item) => (
            <span key={item.title} style={{ margin: "10px", color: "#fff" }}>
              {item.title}
            </span>
          ))}
        </nav>
      );
    }
  
    return null;
  }