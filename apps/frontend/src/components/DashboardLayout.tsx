"use client";

import React, { useState, useEffect, memo } from "react";
import { Button, Drawer, Grid, Layout, Menu, Tooltip, ConfigProvider, theme, Space, App, Spin, Typography } from "antd";
import type { MenuProps } from "antd";
import {
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  SunOutlined,
  MoonOutlined,
  LogoutOutlined,
  CompassOutlined,
} from "@ant-design/icons";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getAccessToken, clearAccessToken, onTokenChange } from "@/lib/token-store";
import { decodeJwtPayload } from "@/lib/jwt";
import { LocationProvider, useLocation } from "@/contexts/LocationContext";
import { SocketProvider } from "@/hooks/useSocket";
import { NotificationsProvider } from "@/contexts/NotificationsContext";
import CommandPalette from "./CommandPalette";
import OnboardingTour from "./OnboardingTour";
import { themeConfig } from "@/lib/theme";
import { ConeekoLogo } from "./Logo";
import { NAV_ITEMS, type NavItem } from "@/lib/navigation";
import { HeaderActions } from "./HeaderActions";

const { Sider, Header, Content, Footer } = Layout;
const { Text } = Typography;

// The sidebar is intentionally always-dark chrome (Sider/Menu use theme="dark"), independent of
// the app's light/dark mode — so these are fixed brand constants rather than theme tokens, which
// would incorrectly flip with the mode (L7).
const SIDEBAR_BG = "#001529";
const SIDEBAR_FG = "#ffffff";

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
  const isSysAdmin = r === "sysadmin" || isPlatformAdmin;

  let genericRole = "user";
  if (isPlatformAdmin) genericRole = "platform_admin";
  else if (isSysAdmin) genericRole = "sysadmin";
  else if (isAdmin) genericRole = "admin";
  else if (role.toLowerCase() === "manager") genericRole = "manager";

  // Filter items based on role
  const filteredNav = NAV_ITEMS
    .map((item): NavItem | null => {
      if ("children" in item) {
        const children = item.children.filter((child) =>
          child.allowed.includes(genericRole),
        );
        return children.length > 0 ? { ...item, children } : null;
      }
      return item.allowed.includes(genericRole) ? item : null;
    })
    .filter((item): item is NavItem => item !== null);

  const filteredItems: MenuProps["items"] = filteredNav.map((item) =>
    "children" in item
      ? {
          key: item.key,
          label: item.label,
          icon: <item.icon />,
          children: item.children.map((c) => ({
            key: c.key,
            label: c.label,
            icon: <c.icon />,
          })),
        }
      : { key: item.key, label: item.label, icon: <item.icon /> },
  );

  // Find selected key
  let selectedKey = "/dashboard";
  filteredNav.forEach((item) => {
    if ("children" in item) {
      const match = item.children.find((c) => pathname.startsWith(c.key));
      if (match) selectedKey = match.key;
    } else if (pathname.startsWith(item.key)) {
      selectedKey = item.key;
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
        <ConeekoLogo collapsed={collapsed} color={SIDEBAR_FG} />
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
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [role, setRole] = useState<string>("user");
  const [email, setEmail] = useState<string>("");
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.lg;
  const { token } = theme.useToken();
  const { locations, selectedLocationId, setSelectedLocationId, organizations, selectedOrgId, setSelectedOrgId, loading: locLoading } = useLocation();

  useEffect(() => {
    const handler = () => {
      const accessToken = getAccessToken();
      if (!accessToken) {
        setRole("user");
        setEmail("");
        return;
      }
      const decoded = decodeJwtPayload<{ role?: string; email?: string }>(accessToken);
      setRole(decoded?.role || "user");
      setEmail(decoded?.email || "");
    };
    handler();
    window.addEventListener("auth-change", handler);
    const unsub = onTokenChange(() => handler());
    return () => {
      window.removeEventListener("auth-change", handler);
      unsub();
    };
  }, []);

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

  return (
    <Layout style={{ minHeight: "100vh", background: token.colorBgLayout }}>
      <CommandPalette onToggleTheme={toggleTheme} onLogout={handleLogout} />
      <OnboardingTour />
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
            body: { padding: 0, background: SIDEBAR_BG },
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
            background: token.colorBgContainer,
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
          <HeaderActions
            isMobile={isMobile}
            isDarkMode={isDarkMode}
            toggleTheme={toggleTheme}
            email={email}
            role={role}
            onMenuOpen={() => setDrawerOpen(true)}
          />
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
      const stored = localStorage.getItem('theme');
      if (stored) return stored === 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });
  const [initialized, setInitialized] = useState(false);

  // Mount flag: render the shell only after hydration (avoids a theme/localStorage
  // mismatch flash). Route protection lives in middleware.ts + the api 401 handler —
  // the old localStorage token check here caused a redirect loop with a stale
  // HttpOnly refresh cookie (spinner forever while /login bounced back).
  useEffect(() => {
    Promise.resolve().then(() => {
      setInitialized(true);
    });
  }, []);

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
