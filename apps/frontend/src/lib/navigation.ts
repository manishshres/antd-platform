import {
  DashboardOutlined,
  RobotOutlined,
  ShoppingOutlined,
  ShopOutlined,
  CoffeeOutlined,
  PrinterOutlined,
  TeamOutlined,
  UserOutlined,
  SettingOutlined,
  LineChartOutlined,
  BarChartOutlined,
  SafetyCertificateOutlined,
  BankOutlined,
} from "@ant-design/icons";
import type { ComponentType } from "react";

/** Icon components (e.g. `DashboardOutlined`) — instantiated as `<Icon />` at render time.
 *  Stored as component references here because this is a `.ts` module and cannot hold JSX. */
type IconComponent = ComponentType;

export interface NavLeaf {
  key: string;
  icon: IconComponent;
  label: string;
  allowed: string[];
}

export interface NavGroup {
  key: string;
  label: string;
  icon: IconComponent;
  children: NavLeaf[];
}

export type NavItem = NavLeaf | NavGroup;

export const NAV_ITEMS: NavItem[] = [
  {
    key: "/dashboard",
    icon: DashboardOutlined,
    label: "Dashboard",
    allowed: ["platform_admin", "sysadmin", "admin", "manager", "user"],
  },
  {
    key: "/calls",
    icon: RobotOutlined,
    label: "AI Call Center",
    allowed: ["platform_admin", "sysadmin", "admin", "manager", "user"],
  },
  {
    key: "grp-operations",
    label: "Store Operations",
    icon: ShoppingOutlined,
    children: [
      {
        key: "/pos",
        icon: ShopOutlined,
        label: "POS Register",
        allowed: ["platform_admin", "sysadmin", "admin", "manager", "user"],
      },
      {
        key: "/orders",
        icon: ShoppingOutlined,
        label: "Orders",
        allowed: ["platform_admin", "sysadmin", "admin", "manager", "user"],
      },
      {
        key: "/menus",
        icon: CoffeeOutlined,
        label: "Menu",
        allowed: ["platform_admin", "sysadmin", "admin", "manager"],
      },
      {
        key: "/printers",
        icon: PrinterOutlined,
        label: "Printers",
        allowed: ["platform_admin", "sysadmin", "admin", "manager"],
      },
    ],
  },
  {
    key: "grp-analytics",
    label: "Analytics & Logs",
    icon: LineChartOutlined,
    children: [
      {
        key: "/analytics/reports",
        icon: BarChartOutlined,
        label: "Sales Reports",
        allowed: ["platform_admin", "sysadmin", "admin", "manager"],
      },
      // Usage Analytics is temporarily hidden from the menu (page still exists
      // at /analytics/usage). Restore this entry when the feature is ready.
      // {
      //   key: "/analytics/usage",
      //   icon: LineChartOutlined,
      //   label: "Usage Analytics",
      //   allowed: ["platform_admin", "sysadmin", "admin"],
      // },
      {
        key: "/audit",
        icon: SafetyCertificateOutlined,
        label: "Audit Logs",
        allowed: ["platform_admin", "sysadmin"],
      },
    ],
  },
  {
    key: "grp-settings",
    label: "Settings & Team",
    icon: SettingOutlined,
    children: [
      {
        key: "/users",
        icon: TeamOutlined,
        label: "Team Members",
        allowed: ["platform_admin", "sysadmin", "admin"],
      },
      {
        key: "/settings",
        icon: SettingOutlined,
        label: "Store Settings",
        allowed: ["platform_admin", "sysadmin", "admin"],
      },
      {
        key: "/profile",
        icon: UserOutlined,
        label: "My Profile",
        allowed: ["platform_admin", "sysadmin", "admin", "manager", "user"],
      },
    ],
  },
  {
    key: "grp-admin",
    label: "Platform Admin",
    icon: BankOutlined,
    children: [
      {
        key: "/platform-admin",
        icon: BankOutlined,
        label: "Admin Console",
        allowed: ["platform_admin"],
      },
      {
        key: "/admin/health",
        icon: DashboardOutlined,
        label: "Platform Health",
        allowed: ["platform_admin"],
      },
    ],
  },
];