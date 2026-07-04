import React from "react";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import DashboardLayout from "@/components/DashboardLayout";
import "./globals.css";

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
