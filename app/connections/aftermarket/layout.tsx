import type { ReactNode } from "react";
import GoogleAccountBar from "./GoogleAccountBar";

export default function AftermarketConnectionLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <GoogleAccountBar />
      {children}
    </>
  );
}
