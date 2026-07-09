import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import "../globals.css";

export default function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout>{children}</DashboardLayout>;
}