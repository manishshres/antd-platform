"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Input, theme } from "antd";
import {
  DashboardOutlined,
  RobotOutlined,
  ShoppingOutlined,
  CoffeeOutlined,
  PrinterOutlined,
  LineChartOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  SettingOutlined,
  UserOutlined,
  BankOutlined,
  SearchOutlined,
  BulbOutlined,
  LogoutOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";

interface Command {
  key: string;
  label: string;
  keywords?: string;
  icon: React.ReactNode;
  run: () => void;
  section: string;
}

interface CommandPaletteProps {
  onToggleTheme: () => void;
  onLogout: () => void;
}

/**
 * Global ⌘K / Ctrl+K command palette (E5) — fast navigation + a couple of actions.
 * Keyboard: ↑/↓ to move, Enter to run, Esc to close.
 */
export default function CommandPalette({
  onToggleTheme,
  onLogout,
}: CommandPaletteProps) {
  const router = useRouter();
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const openPalette = () => {
    setQuery("");
    setActive(0);
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => {
          if (!v) {
            setQuery("");
            setActive(0);
            setTimeout(() => inputRef.current?.focus(), 50);
          }
          return !v;
        });
      }
    };
    const onOpen = () => openPalette();
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpen);
    };
  }, []);

  const commands: Command[] = useMemo(() => {
    const go = (href: string) => () => {
      setOpen(false);
      router.push(href);
    };
    return [
      { key: "dashboard", label: "Dashboard", icon: <DashboardOutlined />, run: go("/dashboard"), section: "Navigate" },
      { key: "calls", label: "AI Call Center", keywords: "phone calls", icon: <RobotOutlined />, run: go("/calls"), section: "Navigate" },
      { key: "orders", label: "Orders", icon: <ShoppingOutlined />, run: go("/orders"), section: "Navigate" },
      { key: "menus", label: "Menu", keywords: "food items", icon: <CoffeeOutlined />, run: go("/menus"), section: "Navigate" },
      { key: "printers", label: "Printers", icon: <PrinterOutlined />, run: go("/printers"), section: "Navigate" },
      { key: "recordings", label: "Recordings", keywords: "audio calls", icon: <RobotOutlined />, run: go("/recordings"), section: "Navigate" },
      { key: "analytics", label: "Usage Analytics", keywords: "usage", icon: <LineChartOutlined />, run: go("/analytics/usage"), section: "Navigate" },
      { key: "audit", label: "Audit Logs", icon: <SafetyCertificateOutlined />, run: go("/audit"), section: "Navigate" },
      { key: "users", label: "Team Members", keywords: "users staff", icon: <TeamOutlined />, run: go("/users"), section: "Navigate" },
      { key: "settings", label: "Store Settings", icon: <SettingOutlined />, run: go("/settings"), section: "Navigate" },
      { key: "profile", label: "My Profile", icon: <UserOutlined />, run: go("/profile"), section: "Navigate" },
      { key: "admin", label: "Platform Admin", icon: <BankOutlined />, run: go("/platform-admin"), section: "Navigate" },
      { key: "theme", label: "Toggle theme", keywords: "dark light mode", icon: <BulbOutlined />, run: () => { setOpen(false); onToggleTheme(); }, section: "Actions" },
      { key: "logout", label: "Log out", icon: <LogoutOutlined />, run: () => { setOpen(false); onLogout(); }, section: "Actions" },
    ];
  }, [router, onToggleTheme, onLogout]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (c.keywords ?? "").toLowerCase().includes(q),
    );
  }, [commands, query]);

  const onQueryChange = (value: string) => {
    setQuery(value);
    setActive(0);
  };

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[active]?.run();
    }
  };

  return (
    <Modal
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
      closable={false}
      styles={{ body: { padding: 0 } }}
      width={560}
      destroyOnHidden
    >
      <Input
        ref={inputRef as never}
        size="large"
        variant="borderless"
        prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
        placeholder="Search pages and actions…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onInputKeyDown}
        style={{ padding: "14px 16px", borderBottom: `1px solid ${token.colorBorderSecondary}` }}
      />
      <div style={{ maxHeight: 380, overflowY: "auto", padding: 8 }}>
        {filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: token.colorTextTertiary }}>
            No matches
          </div>
        )}
        {filtered.map((c, i) => (
          <div
            key={c.key}
            onMouseEnter={() => setActive(i)}
            onClick={() => c.run()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 12px",
              borderRadius: token.borderRadius,
              cursor: "pointer",
              background: i === active ? token.colorPrimaryBg : "transparent",
            }}
          >
            <span style={{ color: token.colorPrimary, fontSize: 16 }}>{c.icon}</span>
            <span style={{ flex: 1, color: token.colorText }}>{c.label}</span>
            <span style={{ fontSize: 11, color: token.colorTextTertiary }}>{c.section}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
