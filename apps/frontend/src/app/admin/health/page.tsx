"use client";

import { useEffect, useState } from "react";
import { Card, Typography, Spin, Alert, Row, Col, Badge, Statistic } from "antd";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { ErrorState } from "@/components/PageStates";
import { DashboardOutlined } from "@ant-design/icons";

const { Text } = Typography;

interface HealthResponse {
  status: string;
  timestamp: string;
  services: {
    database: { status: string; error: string | null };
    redis: { status: string; error: string | null };
    mqtt: { status: string };
  };
}

export default function AdminHealthPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    try {
      const res = await api.get<HealthResponse>("/health");
      setData(res.data);
      setError(null);
    } catch {
      setError("Failed to load system health. You may not have platform admin privileges.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchHealth();
    // Poll every 10 seconds
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 300 }}>
        <Spin size='large' />
      </div>
    );
  }

  if (error && !data) {
    return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  }

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "healthy":
      case "up":
        return "success";
      case "ready (no ping)":
      case "unknown":
        return "warning";
      default:
        return "error";
    }
  };

  const services = data ? [
    { name: "Database", ...data.services.database },
    { name: "Redis", ...data.services.redis },
    { name: "MQTT Server", ...data.services.mqtt },
  ] : [];

  return (
    <div>
      <PageHeader
        title={<><DashboardOutlined style={{ marginRight: 8 }} />System Health Dashboard</>}
        actions={
          data && (
            <Text type="secondary">
              Last checked: {new Date(data.timestamp).toLocaleTimeString()}
            </Text>
          )
        }
      />

      {error && <Alert type='error' title={error} showIcon style={{ marginBottom: 16 }} />}

      {data && (
        <Alert 
          title={`Overall System Status: ${data.status}`} 
          type={data.status === "UP" ? "success" : "error"} 
          showIcon 
          style={{ marginBottom: 24 }} 
        />
      )}

      <Row gutter={[16, 16]}>
        {services.map((service) => (
          <Col xs={24} sm={12} md={12} lg={8} key={service.name}>
            <Card style={{ borderRadius: 8, height: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                <Text strong>{service.name}</Text>
                <Badge status={getStatusColor(service.status)} text={service.status} />
              </div>
              {('error' in service && service.error) && (
                <div style={{ marginTop: 16, fontSize: 12, color: "#8c8c8c" }}>
                  <Text type="danger">{service.error}</Text>
                </div>
              )}
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
