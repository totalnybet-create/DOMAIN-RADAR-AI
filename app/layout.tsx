import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "DomenaGo — znajdź i kup domenę",
    template: "%s | DomenaGo",
  },
  description: "Sprawdź dostępność domen, porównaj rozszerzenia i przejdź do zakupu wybranej domeny.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
