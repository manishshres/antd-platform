"use client";

import { useEffect, useState } from "react";
import { Row, Col, Card, Statistic, Button, Space, theme } from "antd";
import {
  BankOutlined,
  CheckCircleOutlined,
  SyncOutlined,
  StopOutlined,
  ArrowRightOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { PageSkeleton } from "@/components/PageStates";

interface ProvisioningSummary {
  totalOrganizations: number;
  active: number;
  provisioning: number;
  failed: number;
  suspended: number;
}

/**
 * Platform-level landing view for platform admins — org-wide counts rather than a single
 * location's KPIs, which are meaningless before an org/location is chosen.
 */
export default function PlatformOverview() {
  const router = useRouter();
  const { token } = theme.useToken();
  const [summary, setSummary] = useState<ProvisioningSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ProvisioningSummary>("/admin/organizations/provisioning-summary")
      .then(({ data }) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        /* summary is optional; leave null */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = [
    { label: "Organizations", value: summary?.totalOrganizations ?? 0, icon: <BankOutlined />, color: token.colorPrimary },
    { label: "Active", value: summary?.active ?? 0, icon: <CheckCircleOutlined />, color: token.colorSuccess },
    { label: "Provisioning", value: summary?.provisioning ?? 0, icon: <SyncOutlined />, color: token.colorWarning },
    { label: "Suspended", value: summary?.suspended ?? 0, icon: <StopOutlined />, color: token.colorError },
  ];

  return (
    <div style={{ marginBottom: token.marginLG }}>
      <PageHeader
        title="Platform Overview"
        subtitle="Organization-wide status across the platform."
        actions={
          <Button type="primary" icon={<ArrowRightOutlined />} onClick={() => router.push("/platform-admin")}>
            Admin Console
          </Button>
        }
      />

      {loading ? (
        <PageSkeleton rows={2} />
      ) : (
        <Row gutter={[token.marginSM, token.marginSM]}>
          {cards.map((c) => (
            <Col xs={12} md={6} key={c.label}>
              <Card variant="borderless">
                <Statistic
                  title={c.label}
                  value={c.value}
                  prefix={<Space size={6} style={{ color: c.color }}>{c.icon}</Space>}
                />
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
