"use client";

import React, { useState, useEffect } from "react";
import { Button, Drawer, Grid, Layout, Menu, Tooltip, ConfigProvider, theme, Space, App, Select, Dropdown, Avatar, Spin, Typography } from "antd";
import type { MenuProps } from "antd";
import {
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  DashboardOutlined,
  PhoneOutlined,
  FileTextOutlined,
  RobotOutlined,
  SunOutlined,
  MoonOutlined,
  LogoutOutlined,
  ShoppingOutlined,
  CoffeeOutlined,
  CreditCardOutlined,
  PrinterOutlined,
  TeamOutlined,
  UserOutlined,
  SettingOutlined,
  LineChartOutlined,
  SafetyCertificateOutlined,
  EnvironmentOutlined,
  BankOutlined,
} from "@ant-design/icons";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { LocationProvider, useLocation } from "@/contexts/LocationContext";
import { SocketProvider, useSocket } from "@/hooks/useSocket";
import { NotificationsProvider } from "@/contexts/NotificationsContext";
import NotificationsBell from "./NotificationsBell";
import { themeConfig } from "@/lib/theme";
import { ConeekoLogo } from "./Logo";

const { Sider, Header, Content, Footer } = Layout;
const { Text } = Typography;

function SidebarMenu({
  onClick,
  collapsed,
  role,
}: {
  onClick?: () => void;
  collapsed?: boolean;
  role: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const r = role.toLowerCase();
  const isPlatformAdmin = r === "platform_admin";
  const isAdmin = ["admin", "owner", "sysadmin"].includes(r) || isPlatformAdmin;
  const isManager = r === "manager";
  const isSysAdmin = r === "sysadmin" || isPlatformAdmin;

  // New grouped navigation structure
  const rawItems: any[] = [
    { key: "/dashboard", icon: <DashboardOutlined />, label: "Dashboard", allowed: ["platform_admin", "sysadmin", "admin", "manager", "user"] },
    { key: "/calls", icon: <RobotOutlined />, label: "AI Call Center", allowed: ["platform_admin", "sysadmin", "admin", "manager", "user"] },
    {
      key: 'grp-operations',
      label: 'Store Operations',
      icon: <ShoppingOutlined />,
      children: [
        { key: "/orders", icon: <ShoppingOutlined />, label: "Orders", allowed: ["platform_admin", "sysadmin", "admin", "manager", "user"] },
        { key: "/menus", icon: <CoffeeOutlined />, label: "Menu", allowed: ["platform_admin", "sysadmin", "admin", "manager"] },
        { key: "/printers", icon: <PrinterOutlined />, label: "Printers", allowed: ["platform_admin", "sysadmin", "admin", "manager"] },
      ],
    },
    {
      key: 'grp-analytics',
      label: 'Analytics & Logs',
      icon: <LineChartOutlined />,
      children: [
        { key: "/analytics/usage", icon: <LineChartOutlined />, label: "Usage Analytics", allowed: ["platform_admin", "sysadmin", "admin"] },
        { key: "/audit", icon: <SafetyCertificateOutlined />, label: "Audit Logs", allowed: ["platform_admin", "sysadmin"] },
      ],
    },
    {
      key: 'grp-settings',
      label: 'Settings & Team',
      icon: <SettingOutlined />,
      children: [
        { key: "/users", icon: <TeamOutlined />, label: "Team Members", allowed: ["platform_admin", "sysadmin", "admin"] },
        { key: "/settings", icon: <SettingOutlined />, label: "Store Settings", allowed: ["platform_admin", "sysadmin", "admin"] },
        { key: "/profile", icon: <UserOutlined />, label: "My Profile", allowed: ["platform_admin", "sysadmin", "admin", "manager", "user"] },
      ],
    },
    {
      key: 'grp-admin',
      label: 'Platform Admin',
      icon: <BankOutlined />,
      children: [
        { key: "/platform-admin", icon: <BankOutlined />, label: "Admin Console", allowed: ["platform_admin"] },
        { key: "/admin/health", icon: <DashboardOutlined />, label: "Platform Health", allowed: ["platform_admin"] },
      ],
    }
  ];

  // Helper to resolve generic role
  let genericRole = "user";
  if (isPlatformAdmin) genericRole = "platform_admin";
  else if (isSysAdmin) genericRole = "sysadmin";
  else if (isAdmin) genericRole = "admin";
  else if (isManager) genericRole = "manager";

  // Filter items based on role
  const filteredItems = rawItems
    .map(group => {
      if (group && 'children' in group) {
        const children = (group.children as any[]).filter(child => child.allowed.includes(genericRole));
        if (children.length > 0) {
          return { ...group, children };
        }
        return null;
      }
      return group;
    })
    .filter(Boolean) as MenuProps['items'];

  // Find selected key
  let selectedKey = "/dashboard";
  filteredItems?.forEach(group => {
    if (group && 'children' in group) {
      const children = group.children as any[];
      const match = children.find(item => pathname.startsWith(item.key));
      if (match) selectedKey = match.key;
    } else if (group && group.key && typeof group.key === 'string' && pathname.startsWith(group.key)) {
      selectedKey = group.key;
    }
  });

  return (
    <>
      <div
        style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          padding: `0 24px`,
          gap: 16,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          overflow: "hidden",
        }}
      >
        <ConeekoLogo collapsed={collapsed} color="#ffffff" />
      </div>
      <Menu
        theme='dark'
        mode='inline'
        selectedKeys={[selectedKey]}
        items={filteredItems}
        onClick={({ key }) => {
          router.push(key);
          onClick?.();
        }}
      />
    </>
  );
}

function LayoutInner({
  children,
  isDarkMode,
  toggleTheme,
}: {
  children: React.ReactNode;
  isDarkMode: boolean;
  toggleTheme: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthPage = 
    pathname === "/login" || 
    pathname === "/register" || 
    pathname === "/forgot-password" || 
    pathname === "/reset-password" || 
    pathname === "/verify-email" || 
    pathname === "/invite" ||
    pathname === "/invitations/accept";

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [role, setRole] = useState<string>("user");
  const [email, setEmail] = useState<string>("");
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.lg;
  const { token } = theme.useToken();
  const { locations, selectedLocationId, setSelectedLocationId, organizations, selectedOrgId, setSelectedOrgId, loading: locLoading } = useLocation();
  const { isConnected } = useSocket();

  useEffect(() => {
    Promise.resolve().then(() => {
      if (typeof window !== "undefined") {
        const accessToken = localStorage.getItem("access_token");
        if (accessToken) {
          try {
            const payload = accessToken.split(".")[1];
            const decoded = JSON.parse(window.atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { role?: string; email?: string };
            setRole(decoded.role || "user");
            setEmail(decoded.email || "");
          } catch {
            setRole("user");
            setEmail("");
          }
        }
      }
    });
  }, [pathname]);

  if (isAuthPage) {
    return <Layout style={{ minHeight: "100vh" }}>{children}</Layout>;
  }

  const isPlatformAdmin = role === "platform_admin";
  const isManager = role === "manager";

  // Build the profile dropdown context panel
  const renderContextSelectors = () => {
    return (
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${token.colorBorderSecondary}`, minWidth: 250 }}>
        <Space orientation="vertical" style={{ width: '100%' }}>
          {isPlatformAdmin && organizations.length > 0 && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>Organization</Text>
              <Select
                size="small"
                value={selectedOrgId}
                onChange={(val) => setSelectedOrgId(val)}
                style={{ width: '100%', marginTop: 4 }}
                options={organizations.map(org => ({ label: org.name, value: org.id }))}
              />
            </div>
          )}
          
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Location</Text>
            {isManager ? (
              <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                <EnvironmentOutlined style={{ color: token.colorPrimary }} />
                <Text strong>{locations.find(l => l.id === selectedLocationId)?.name || 'Loading...'}</Text>
              </div>
            ) : (
              <Select
                size="small"
                value={selectedLocationId}
                onChange={(val) => setSelectedLocationId(val)}
                style={{ width: '100%', marginTop: 4 }}
                loading={locLoading}
                options={locations.map(loc => ({ label: loc.name, value: loc.id }))}
                placeholder="Select location"
                disabled={locations.length === 0}
              />
            )}
          </div>
        </Space>
      </div>
    );
  };

  const profileMenu: MenuProps['items'] = [
    // Signed-in identity — moved here from the navbar.
    ...(email
      ? [
          {
            key: 'signed-in-as',
            label: (
              <div style={{ padding: '4px 4px 8px' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>Signed in as</Text>
                <div>
                  <Text strong ellipsis style={{ maxWidth: 220, display: 'block' }}>{email}</Text>
                </div>
              </div>
            ),
            disabled: true,
            style: { cursor: 'default' },
          },
          { type: 'divider' as const },
        ]
      : []),
    // On desktop the tenant switcher lives in the header (E1); keep the compact version in the
    // profile dropdown only on mobile where header space is tight.
    ...(isMobile
      ? [
          {
            key: 'context-selectors',
            label: renderContextSelectors(),
            disabled: true,
            style: { cursor: 'default', padding: 0 },
          },
        ]
      : []),
    {
      key: 'profile',
      label: 'My Profile',
      icon: <UserOutlined />,
      onClick: () => router.push('/profile'),
    },
    {
      key: 'theme',
      label: isDarkMode ? 'Light Mode' : 'Dark Mode',
      icon: isDarkMode ? <SunOutlined /> : <MoonOutlined />,
      onClick: toggleTheme,
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      label: 'Logout',
      icon: <LogoutOutlined />,
      danger: true,
      onClick: async () => {
        try {
          // Refresh token lives in the HttpOnly cookie (H2); the backend reads it and clears it.
          await api.post("/auth/logout", {});
        } catch {
          // Ignore logout failure
        }
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        // Clear tenant context so the next login on a shared device doesn't inherit it (M14).
        localStorage.removeItem("selectedOrgId");
        localStorage.removeItem("selectedLocationId");
        window.dispatchEvent(new Event("auth-change"));
        router.push("/login");
      },
    },
  ];

  return (
    <Layout style={{ minHeight: "100vh", background: token.colorBgLayout }}>
      {/* Desktop sidebar */}
      {!isMobile && (
        <Sider
          collapsible
          collapsed={siderCollapsed}
          onCollapse={(value) => setSiderCollapsed(value)}
          width={240}
          theme="dark"
          style={{
            overflow: "auto",
            height: "100vh",
            position: "sticky",
            top: 0,
            left: 0,
            zIndex: 101,
          }}
        >
          <SidebarMenu collapsed={siderCollapsed} role={role} />
        </Sider>
      )}

      {/* Mobile drawer */}
      {isMobile && (
        <Drawer
          placement='left'
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          styles={{
            body: { padding: 0, background: "#001529" },
            wrapper: { width: 240 },
          }}
          closeIcon={null}
        >
          <SidebarMenu onClick={() => setDrawerOpen(false)} role={role} />
        </Drawer>
      )}

      <Layout style={{ background: token.colorBgLayout }}>
        <Header
          style={{
            padding: `0 ${token.paddingLG}px`,
            background: isDarkMode ? "#141414" : "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            position: "sticky",
            top: 0,
            zIndex: 100,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            transition: "background 0.3s, border-color 0.3s",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {isMobile ? (
              <Tooltip title='Open menu'>
                <Button
                  type='text'
                  icon={<MenuOutlined />}
                  onClick={() => setDrawerOpen(true)}
                  style={{ fontSize: 16 }}
                />
              </Tooltip>
            ) : null}
          </div>

          <Space size={12}>
            {/* E1: Tenant context switcher, surfaced in the header (right side, next to the
                avatar) instead of buried in the profile dropdown — the primary control in a
                multi-tenant, multi-location app. */}
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

            {/* Profile dropdown — avatar only (email removed from the navbar). */}
            <Dropdown menu={{ items: profileMenu }} trigger={['click']} placement="bottomRight">
              <a
                onClick={(e) => e.preventDefault()}
                aria-label="Account menu"
                style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', padding: '0 4px' }}
              >
                <Avatar icon={<UserOutlined />} style={{ backgroundColor: token.colorPrimary }} />
              </a>
            </Dropdown>
          </Space>
        </Header>

        <Content style={{ margin: 0, padding: 0, transition: "background 0.3s" }}>
          <div
            style={{
              margin: `16px ${token.margin}px`,
              padding: token.paddingLG,
              background: token.colorBgContainer,
              borderRadius: token.borderRadiusLG,
              border: `1px solid ${token.colorBorderSecondary}`,
              minHeight: "calc(100vh - 130px)",
              transition: "background 0.3s, border-color 0.3s",
            }}
          >
            {children}
          </div>
        </Content>
        <Footer style={{ textAlign: "center", background: "transparent", padding: "0 0 24px 0", color: token.colorTextDescription }}>
          Copyright © {new Date().getFullYear()} <a href="https://coneeko.com" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>Coneeko</a>. All rights reserved.
        </Footer>
      </Layout>
    </Layout>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark';
    }
    return false;
  });
  const [initialized, setInitialized] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const isAuthPage = 
    pathname === "/login" || 
    pathname === "/register" || 
    pathname === "/forgot-password" || 
    pathname === "/reset-password" || 
    pathname === "/verify-email" || 
    pathname === "/invite" ||
    pathname === "/invitations/accept";

  useEffect(() => {
    Promise.resolve().then(() => {
      const token = localStorage.getItem("access_token");
      if (!token && !isAuthPage) {
        router.push("/login");
      } else {
        setInitialized(true);
      }
    });
  }, [isAuthPage, router]);

  const toggleTheme = () => {
    const next = !isDarkMode;
    setIsDarkMode(next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  return (
    <ConfigProvider
      theme={{
        ...themeConfig,
        algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
      }}
    >
      <App>
        {!initialized ? (
          <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "center", background: isDarkMode ? '#141414' : '#ffffff' }}>
            <Spin size="large" />
          </div>
        ) : (
          <LocationProvider>
            <SocketProvider>
              <NotificationsProvider>
                <LayoutInner isDarkMode={isDarkMode} toggleTheme={toggleTheme}>
                  {children}
                </LayoutInner>
              </NotificationsProvider>
            </SocketProvider>
          </LocationProvider>
        )}
      </App>
    </ConfigProvider>
  );
}
