"use client";

import { useEffect, useState } from "react";
import { Row, Col, Card, Statistic, Skeleton, Typography, theme, Tag, Space, Switch, message } from "antd";
import {
  ShoppingOutlined,
  DollarOutlined,
  PhoneOutlined,
  RobotOutlined,
  FileTextOutlined,
  SettingOutlined,
  TeamOutlined,
  CoffeeOutlined,
} from "@ant-design/icons";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { api } from "@/lib/api";
import { useLocation } from "@/contexts/LocationContext";
import CallForwardingGuide from "@/components/CallForwardingGuide";
import PageHeader from "@/components/PageHeader";
import { ErrorState, EmptyState } from "@/components/PageStates";
import PlatformOverview from "@/components/PlatformOverview";
import Link from "next/link";

const { Title, Text, Paragraph } = Typography;

interface DashboardMetrics {
  kpi: {
    totalOrdersToday: number;
    revenueToday: number;
    activeCalls: number;
    printerStatus: string;
  };
  trend: {
    date: string;
    orders: number;
    calls: number;
  }[];
}

// Quick action items for SaaS dashboard. Accent colors are theme-token keys (resolved at render)
// rather than hardcoded hex, so they follow light/dark mode (L7).
type AccentKey =
  | "colorPrimary"
  | "colorSuccess"
  | "colorWarning"
  | "purple"
  | "magenta"
  | "colorTextTertiary";

const quickActions: {
  key: string;
  label: string;
  icon: React.ReactNode;
  href: string;
  accent: AccentKey;
}[] = [
  { key: "calls", label: "AI Call Center", icon: <RobotOutlined />, href: "/calls", accent: "colorPrimary" },
  { key: "orders", label: "View Orders", icon: <ShoppingOutlined />, href: "/orders", accent: "colorSuccess" },
  { key: "menus", label: "Edit Menu", icon: <CoffeeOutlined />, href: "/menus", accent: "colorWarning" },
  { key: "team", label: "Team Members", icon: <TeamOutlined />, href: "/users", accent: "purple" },
  { key: "analytics", label: "Usage Analytics", icon: <FileTextOutlined />, href: "/analytics/usage", accent: "magenta" },
  { key: "settings", label: "Settings", icon: <SettingOutlined />, href: "/settings", accent: "colorTextTertiary" },
];

export default function DashboardPage() {
  const [data, setData] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { selectedLocationId, selectedLocation, refreshLocations, userRole } = useLocation();
  const isPlatformAdmin = userRole === "platform_admin";
  const [togglingStore, setTogglingStore] = useState(false);

  const { token } = theme.useToken();

  useEffect(() => {
    let cancelled = false;
    async function fetchDashboard() {
      if (!selectedLocationId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await api.get<DashboardMetrics>(
          `/analytics/dashboard?locationId=${selectedLocationId}`
        );
        if (!cancelled) setData(res.data);
      } catch {
        if (!cancelled) setError("Failed to load dashboard metrics. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchDashboard();
    return () => { cancelled = true; };
  }, [selectedLocationId]);

  const handleToggleStoreClosed = async (checked: boolean) => {
    if (!selectedLocationId) return;
    setTogglingStore(true);
    try {
      await api.patch(`/locations/${selectedLocationId}/ai-config`, {
        aiSettings: {
          dynamicVariables: {
            ...selectedLocation?.aiSettings?.dynamicVariables,
            store_closed: checked ? "true" : "false",
          }
        }
      });
      await refreshLocations();
      message.success(`Store marked as ${checked ? "closed" : "open"} for today.`);
    } catch {
      message.error("Failed to update store status.");
    } finally {
      setTogglingStore(false);
    }
  };

  if (loading) {
    return (
      <div>
        <Skeleton active paragraph={{ rows: 1 }} title={{ width: 300 }} style={{ marginBottom: token.marginLG }} />
        <Row gutter={[token.marginSM, token.marginSM]} style={{ marginBottom: token.margin }}>
          {[1, 2, 3].map((i) => (
            <Col xs={24} sm={8} key={i}>
              <Card variant="borderless">
                <Skeleton active paragraph={{ rows: 1 }} />
              </Card>
            </Col>
          ))}
        </Row>
        <Row gutter={[token.marginSM, token.marginSM]}>
          <Col xs={24} md={16}>
            <Card variant="borderless">
              <Skeleton active paragraph={{ rows: 8 }} />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card variant="borderless">
              <Skeleton active paragraph={{ rows: 8 }} />
            </Card>
          </Col>
        </Row>
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  }

  if (!data) {
    // Platform admins land on a platform-wide overview rather than an empty location dashboard;
    // they can drill into a location via the header switcher for the operational view.
    if (isPlatformAdmin) {
      return (
        <div>
          <PlatformOverview />
          <EmptyState description="Select an organization and location above to view its operational dashboard." />
        </div>
      );
    }
    return (
      <EmptyState description="Select a location above to view its dashboard." />
    );
  }

  // Calculate some derived metrics
  const totalWeekOrders = data.trend.reduce((sum, d) => sum + d.orders, 0);
  const totalWeekCalls = data.trend.reduce((sum, d) => sum + d.calls, 0);
  const avgOrderValue = data.kpi.totalOrdersToday > 0
    ? (data.kpi.revenueToday / data.kpi.totalOrdersToday)
    : 0;

  return (
    <div>
      <PageHeader
        title={selectedLocation?.name || "Dashboard"}
        subtitle={new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
      />

      {/* KPI Row — 3 cards */}
      <Row gutter={[token.marginSM, token.marginSM]} style={{ marginBottom: token.marginSM }}>
        <Col xs={24} sm={8}>
          <Card variant="borderless">
            <Statistic
              title="Orders Today"
              value={data.kpi.totalOrdersToday}
              prefix={<ShoppingOutlined style={{ color: token.colorPrimary }} />}
              suffix={
                <Text type="secondary" style={{ fontSize: 13 }}>
                  / {totalWeekOrders} this week
                </Text>
              }
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card variant="borderless">
            <Statistic
              title="Revenue Today"
              value={data.kpi.revenueToday}
              precision={2}
              prefix={<DollarOutlined style={{ color: token.colorSuccess }} />}
              suffix={
                avgOrderValue > 0 && (
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    avg ${avgOrderValue.toFixed(2)}
                  </Text>
                )
              }
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card variant="borderless">
            <Statistic
              title="AI Calls"
              value={data.kpi.activeCalls}
              prefix={<PhoneOutlined style={{ color: token.colorWarning }} />}
              suffix={
                <Text type="secondary" style={{ fontSize: 13 }}>
                  active now / {totalWeekCalls} this week
                </Text>
              }
            />
          </Card>
        </Col>
      </Row>
      
      {/* Main content: Chart + Quick Actions */}
      <Row gutter={[token.marginSM, token.marginSM]} style={{ marginBottom: token.marginSM }}>
        {/* Trend Chart */}
        <Col xs={24} lg={16}>
          <Card title="7-Day Activity" variant="borderless" size="small">
            <div style={{ height: 280, width: "100%" }}>
              <ResponsiveContainer>
                <AreaChart
                  data={data.trend}
                  margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                >
                  <defs>
                    <linearGradient id="orderGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={token.colorPrimary} stopOpacity={0.15} />
                      <stop offset="95%" stopColor={token.colorPrimary} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="callGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={token.colorSuccess} stopOpacity={0.15} />
                      <stop offset="95%" stopColor={token.colorSuccess} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={token.colorBorderSecondary} />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <RechartsTooltip />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="orders"
                    name="Orders"
                    stroke={token.colorPrimary}
                    fill="url(#orderGrad)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="calls"
                    name="Calls"
                    stroke={token.colorSuccess}
                    fill="url(#callGrad)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Col>

        {/* Quick Actions */}
        <Col xs={24} lg={8}>
          <Card title="Quick Actions" variant="borderless" size="small">
            <Row gutter={[8, 8]}>
              {quickActions.map((action) => {
                const accent = token[action.accent] as string;
                return (
                <Col span={12} key={action.key}>
                  <Link href={action.href}>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: `${token.paddingSM}px ${token.paddingXS}px`,
                        borderRadius: token.borderRadiusLG,
                        border: `1px solid ${token.colorBorderSecondary}`,
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                        gap: 6,
                        height: 80,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = accent;
                        e.currentTarget.style.boxShadow = `0 2px 8px ${token.colorFillSecondary}`;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = token.colorBorderSecondary;
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    >
                      <span style={{ fontSize: 20, color: accent }}>{action.icon}</span>
                      <Text style={{ fontSize: 12, textAlign: "center" }}>{action.label}</Text>
                    </div>
                  </Link>
                </Col>
                );
              })}
            </Row>
          </Card>
        </Col>
      </Row>

      {/* Location Status + Call Forwarding */}
      <Row gutter={[token.marginSM, token.marginSM]}>
        <Col xs={24} lg={12}>
          <Card title="Location Status" variant="borderless" size="small">
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {[
                {
                  label: "Status",
                  value: selectedLocation?.status || "—",
                  tag: selectedLocation?.status === "active" ? "success" : "warning",
                },
                {
                  label: "Phone Number",
                  value: selectedLocation?.phoneNumber || "Not provisioned",
                  tag: selectedLocation?.phoneNumber ? "success" : "default",
                },
                {
                  label: "Timezone",
                  value: selectedLocation?.timezone || "—",
                },
                {
                  label: "Address",
                  value: [selectedLocation?.address, selectedLocation?.city, selectedLocation?.state].filter(Boolean).join(", ") || "—",
                },
                {
                  label: "Store Status",
                  value: "",
                  customRender: (
                    <Space>
                      <Text>{selectedLocation?.aiSettings?.dynamicVariables?.store_closed === "true" ? "Closed for the day" : "Open normally"}</Text>
                      <Switch 
                        checked={selectedLocation?.aiSettings?.dynamicVariables?.store_closed === "true"}
                        onChange={handleToggleStoreClosed}
                        loading={togglingStore}
                        checkedChildren="Closed"
                        unCheckedChildren="Open"
                      />
                    </Space>
                  )
                },
              ].map((item, index, arr) => (
                <div 
                  key={item.label} 
                  style={{ 
                    display: 'flex', 
                    padding: '12px 0',
                    borderBottom: index === arr.length - 1 ? 'none' : `1px solid ${token.colorBorderSecondary}`
                  }}
                >
                  <Text type="secondary" style={{ minWidth: 120 }}>{item.label}</Text>
                  <div style={{ flex: 1, textAlign: "right" }}>
                    {item.customRender ? item.customRender : (
                      item.tag ? (
                        <Tag color={item.tag as any}>{item.value}</Tag>
                      ) : (
                        <Text>{item.value}</Text>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <CallForwardingGuide phoneNumber={selectedLocation?.phoneNumber} />
        </Col>
      </Row>
    </div>
  );
}
