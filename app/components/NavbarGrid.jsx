// app/components/NavbarGrid.jsx

import NavbarCard from "./NavbarCard";

const designs = [
  {
    id: 1,
    name: "Minimal Clean",
    desc: "Simple & elegant",
    isPro: false,
  },
  {
    id: 2,
    name: "Modern Glass",
    desc: "Glass UI navbar",
    isPro: true,
  },
  {
    id: 3,
    name: "Bold Dark",
    desc: "Dark premium style",
    isPro: true,
  },
  {
    id: 4,
    name: "Gradient Pro",
    desc: "Colorful navbar",
    isPro: true,
  },
  {
    id: 5,
    name: "Luxury Gold",
    desc: "Premium look",
    isPro: true,
  },
];

export default function NavbarGrid() {
  return (
    <div style={gridStyle}>
      {designs.map((d) => (
        <NavbarCard key={d.id} design={d} />
      ))}
    </div>
  );
}

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
  gap: "20px",
};