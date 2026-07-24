import React from "react";
import { ConfigProvider, App, theme } from "antd";
import { themeConfig } from "@/lib/theme";
import "../globals.css";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ConfigProvider
      theme={{
        ...themeConfig,
        algorithm: theme.defaultAlgorithm,
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}