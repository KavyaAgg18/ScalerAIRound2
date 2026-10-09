import "@cloudscape-design/global-styles/index.css";
import "./globals.css";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

export const metadata: Metadata = {
  title: "Route 53 | Global",
  description: "Amazon Route 53 console clone (demo)",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Pages read query params (useSearchParams); static export needs a Suspense boundary. */}
        <Suspense>{children}</Suspense>
      </body>
    </html>
  );
}
