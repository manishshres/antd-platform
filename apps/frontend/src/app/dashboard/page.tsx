"use client";

import { useEffect, useState } from "react";
import { Row, Col, Card, Statistic, Skeleton, Alert, Typography, theme, Empty, Button, Progress, Avatar, Tag, Space, Tooltip, Switch, message } from "antd";
import {
  ShoppingOutlined,
  DollarOutlined,
  PhoneOutlined,
  RiseOutlined,
  RobotOutlined,
  FileTextOutlined,
  SettingOutlined,
  TeamOutlined,
  CoffeeOutlined,
  ArrowRightOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  SyncOutlined,
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

// Quick action items for SaaS dashboard
const quickActions = [
  { key: "calls", label: "AI Call Center", icon: <RobotOutlined />, href: "/calls", color: "#1677ff" },
  { key: "orders", label: "View Orders", icon: <ShoppingOutlined />, href: "/orders", color: "#52c41a" },
  { key: "menus", label: "Edit Menu", icon: <CoffeeOutlined />, href: "/menus", color: "#fa8c16" },
  { key: "team", label: "Team Members", icon: <TeamOutlined />, href: "/users", color: "#722ed1" },
  { key: "analytics", label: "Usage Analytics", icon: <FileTextOutlined />, href: "/analytics/usage", color: "#eb2f96" },
  { key: "settings", label: "Settings", icon: <SettingOutlined />, href: "/settings", color: "#8c8c8c" },
];

export default function DashboardPage() {
  const [data, setData] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { selectedLocationId, selectedLocation, refreshLocations } = useLocation();
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
    return (
      <Alert 
        type='error' 
        title={error} 
        showIcon 
        action={
          <Button size="small" onClick={() => window.location.reload()}>Retry</Button>
        }
      />
    );
  }

  if (!data) return <Empty description="Select a location to view dashboard" style={{ marginTop: 64 }} />;

  // Calculate some derived metrics
  const totalWeekOrders = data.trend.reduce((sum, d) => sum + d.orders, 0);
  const totalWeekCalls = data.trend.reduce((sum, d) => sum + d.calls, 0);
  const avgOrderValue = data.kpi.totalOrdersToday > 0
    ? (data.kpi.revenueToday / data.kpi.totalOrdersToday)
    : 0;

  return (
    <div>
      {/* Welcome Header */}
      <div style={{ marginBottom: token.margin }}>
        <Title level={4} style={{ margin: 0 }}>
          {selectedLocation?.name || "Dashboard"}
        </Title>
        <Text type="secondary">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </Text>
      </div>

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
              {quickActions.map((action) => (
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
                        e.currentTarget.style.borderColor = action.color;
                        e.currentTarget.style.boxShadow = `0 2px 8px ${action.color}20`;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = token.colorBorderSecondary;
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    >
                      <span style={{ fontSize: 20, color: action.color }}>{action.icon}</span>
                      <Text style={{ fontSize: 12, textAlign: "center" }}>{action.label}</Text>
                    </div>
                  </Link>
                </Col>
              ))}
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
