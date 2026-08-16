"use client";

import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Domeny", icon: "search" },
  { href: "/radar", label: "Radar", icon: "radar" },
  { href: "/sniper", label: "Sniper", icon: "target" },
  { href: "/connections/aftermarket", label: "Połącz", icon: "plug" },
  { href: "/#po-zakupie", label: "Usługi", icon: "grid" },
] as const;

function Icon({ type }: { type: (typeof items)[number]["icon"] }) {
  if (type === "search") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>;
  }
  if (type === "radar") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 12 19 5"/></svg>;
  }
  if (type === "target") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></svg>;
  }
  if (type === "plug") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-6 6v4M9 21h6"/></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>;
}

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav" aria-label="Nawigacja aplikacji">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" || pathname === "/domains" : pathname === item.href;
        return (
          <a key={item.label} className={active ? "nav-item active" : "nav-item"} href={item.href}>
            <Icon type={item.icon} />
            <span>{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
