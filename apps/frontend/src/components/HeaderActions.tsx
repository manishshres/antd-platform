"use client";

import React, { memo } from "react";
import { Space, Select, Typography, Dropdown, Avatar } from "antd";
import type { MenuProps } from "antd";
import {
  UserOutlined,
  SunOutlined,
  MoonOutlined,
  LogoutOutlined,
  EnvironmentOutlined,
  BankOutlined,
  CompassOutlined,
} from "@ant-design/icons";
import { theme } from "antd";
import { useRouter } from "next/navigation";
import { useLocation } from "@/contexts/LocationContext";
import NotificationsBell from "./NotificationsBell";
import { clearAccessToken } from "@/lib/token-store";
import { api } from "@/lib/api";

const { Text } = Typography;

interface HeaderActionsProps {
  isMobile: boolean;
  isDarkMode: boolean;
  toggleTheme: () => void;
  email: string;
  role: string;
  onMenuOpen: () => void;
}

export const HeaderActions = memo(function HeaderActions({
  isMobile,
  isDarkMode,
  toggleTheme,
  email,
  role,
  onMenuOpen,
}: HeaderActionsProps) {
  const router = useRouter();
  const { token } = theme.useToken();
  const {
    locations,
    selectedLocationId,
    setSelectedLocationId,
    organizations,
    selectedOrgId,
    setSelectedOrgId,
    loading: locLoading,
  } = useLocation();

  const isPlatformAdmin = role === "platform_admin";
  const isManager = role === "manager";

  const handleLogout = async () => {
    try {
      await api.post("/auth/logout", {});
    } catch {
      // Ignore logout failure
    }
    clearAccessToken();
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("selectedOrgId");
    localStorage.removeItem("selectedLocationId");
    window.dispatchEvent(new Event("auth-change"));
    router.push("/login");
  };

  const profileMenu: MenuProps["items"] = [
    ...(email
      ? [
          {
            key: "signed-in-as",
            label: (
              <div style={{ padding: "4px 4px 8px" }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Signed in as
                </Text>
                <div>
                  <Text strong ellipsis style={{ maxWidth: 220, display: "block" }}>
                    {email}
                  </Text>
                </div>
              </div>
            ),
            disabled: true,
            style: { cursor: "default" },
          },
          { type: "divider" as const },
        ]
      : []),
    {
      key: "profile",
      label: "My Profile",
      icon: <UserOutlined />,
      onClick: () => router.push("/profile"),
    },
    {
      key: "theme",
      label: isDarkMode ? "Light Mode" : "Dark Mode",
      icon: isDarkMode ? <SunOutlined /> : <MoonOutlined />,
      onClick: toggleTheme,
    },
    {
      key: "tour",
      label: "Take a tour",
      icon: <CompassOutlined />,
      onClick: () => window.dispatchEvent(new Event("start-onboarding")),
    },
    { type: "divider" },
    {
      key: "logout",
      label: "Logout",
      icon: <LogoutOutlined />,
      danger: true,
      onClick: handleLogout,
    },
  ];

  return (
    <Space size={12}>
      {!isMobile && (
        <Space size={8}>
          {isPlatformAdmin && organizations.length > 0 && (
            <Select
              size="middle"
              value={selectedOrgId}
              onChange={(val) => setSelectedOrgId(val)}
              style={{ minWidth: 180 }}
              variant="filled"
              prefix={<BankOutlined style={{ color: token.colorTextTertiary }} />}
              options={organizations.map((org) => ({ label: org.name, value: org.id }))}
              placeholder="Organization"
            />
          )}
          {isManager ? (
            <Space size={6} style={{ paddingInline: 8 }}>
              <EnvironmentOutlined style={{ color: token.colorPrimary }} />
              <Text strong>
                {locations.find((l) => l.id === selectedLocationId)?.name || "—"}
              </Text>
            </Space>
          ) : (
            <Select
              size="middle"
              value={selectedLocationId}
              onChange={(val) => setSelectedLocationId(val)}
              style={{ minWidth: 200 }}
              variant="filled"
              loading={locLoading}
              prefix={<EnvironmentOutlined style={{ color: token.colorTextTertiary }} />}
              options={locations.map((loc) => ({ label: loc.name, value: loc.id }))}
              placeholder="Select location"
              disabled={locations.length === 0}
            />
          )}
        </Space>
      )}

      <NotificationsBell />

      <Dropdown menu={{ items: profileMenu }} trigger={["click"]} placement="bottomRight">
        <a
          onClick={(e) => e.preventDefault()}
          aria-label="Account menu"
          style={{ display: "flex", alignItems: "center", cursor: "pointer", padding: "0 4px" }}
        >
          <Avatar icon={<UserOutlined />} style={{ backgroundColor: token.colorPrimary }} />
        </a>
      </Dropdown>
    </Space>
  );
});