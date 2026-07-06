import React from "react";
import type { Metadata, Viewport } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import DashboardLayout from "@/components/DashboardLayout";
import "./globals.css";

export const metadata: Metadata = {
  title: "Coneeko",
  description:
    "Point of sale, AI phone ordering, and kitchen operations for restaurants.",
  // iOS "Add to Home Screen": launch fullscreen with no Safari chrome.
  appleWebApp: {
    capable: true,
    title: "Coneeko",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#001529",
  width: "device-width",
  initialScale: 1,
  // POS is a fixed-layout touch app — pinch zoom breaks the register feel.
  maximumScale: 1,
  userScalable: false,
  // Draw under the iPad notch/home-indicator in standalone mode.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang='en'>
      <body>
        <AntdRegistry>
          <DashboardLayout>{children}</DashboardLayout>
        </AntdRegistry>
      </body>
    </html>
  );
}
