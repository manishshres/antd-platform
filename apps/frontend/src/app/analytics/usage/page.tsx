"use client";

import { useEffect, useState } from "react";
import { Card, Typography, Skeleton, Alert, Progress, Row, Col, theme } from "antd";
import { api } from "@/lib/api";

const { Title, Text } = Typography;

interface LocationUsage {
  locationId: string;
  plan: string;
  currentPeriodEnd: string;
  usage: {
    callMinutes: number;
    apiRequests: number;
    aiSummaries: number;
    aiTranscriptions: number;
    orderVolume: number;
  };
  limits: {
    voiceAgentsLimit: number | null;
    monthlyMinutesLimit: number | null;
    phoneNumbersLimit: number | null;
    kbSizeLimit: number | null;
    websiteImportsLimit: number | null;
    orderVolumeLimit: number | null;
  };
}

interface UsageData {
  locations: LocationUsage[];
}

export default function UsagePage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { token } = theme.useToken();

  useEffect(() => {
    async function fetchUsage() {
      try {
        const res = await api.get<UsageData>("/analytics/usage");
        setData(res.data);
      } catch {
        setError("Failed to load usage data.");
      } finally {
        setLoading(false);
      }
    }
    fetchUsage();
  }, []);

  if (loading) {
    return (
      <div style={{ padding: token.paddingLG }}>
        <Skeleton active paragraph={{ rows: 1 }} title={{ width: 300 }} style={{ marginBottom: token.marginLG }} />
        <Row gutter={[16, 16]}>
          {[1, 2].map((i) => (
            <Col xs={24} lg={12} key={i}>
              <Card><Skeleton active paragraph={{ rows: 5 }} /></Card>
            </Col>
          ))}
        </Row>
      </div>
    );
  }

  if (error) {
    return <Alert type='error' title={error} showIcon />;
  }

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>Tenant Usage vs Plan Limits</Title>
      
      {data?.locations.length === 0 ? (
        <Alert type="info" title="No usage data found for this organization." showIcon />
      ) : (
        <Row gutter={[16, 16]}>
          {data?.locations.map((loc) => {
            const minutesPct = loc.limits.monthlyMinutesLimit ? Math.min(100, (loc.usage.callMinutes / loc.limits.monthlyMinutesLimit) * 100) : 0;
            const ordersPct = loc.limits.orderVolumeLimit ? Math.min(100, (loc.usage.orderVolume / loc.limits.orderVolumeLimit) * 100) : 0;

            return (
              <Col xs={24} lg={12} key={loc.locationId}>
                <Card title={`Location: ${loc.locationId}`} variant="borderless" style={{ borderRadius: 8 }}>
                  <div style={{ marginBottom: 16 }}>
                    <Text type="secondary">Plan: {loc.plan} | Renews: {new Date(loc.currentPeriodEnd).toLocaleDateString()}</Text>
                  </div>
                  
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <Text>Voice Call Minutes</Text>
                      <Text>{loc.usage.callMinutes} / {loc.limits.monthlyMinutesLimit || "∞"} mins</Text>
                    </div>
                    <Progress percent={minutesPct} status={minutesPct >= 100 ? "exception" : "active"} />
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <Text>Order Volume</Text>
                      <Text>{loc.usage.orderVolume} / {loc.limits.orderVolumeLimit || "∞"} orders</Text>
                    </div>
                    <Progress percent={ordersPct} status={ordersPct >= 100 ? "exception" : "active"} strokeColor={token.colorSuccess} />
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <Text type="secondary">API Requests (No limit): </Text>
                    <Text strong>{loc.usage.apiRequests}</Text>
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
    </div>
  );
}
