import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Domain Radar AI",
  description: "AI-assisted brand and domain discovery with live availability checks.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
