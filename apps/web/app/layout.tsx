// Technical shell only. The product's design system (typography, layout,
// color, components for the 13 screens) is chosen WITH the user before
// the UI phase — nothing here is a design decision.
import type { ReactNode } from "react";

export const metadata = {
  title: "AutoCourt",
  description:
    "Evidence-based used-vehicle verification, adjudicated on GenLayer.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
