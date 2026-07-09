"use client";

import { useEffect, useState } from "react";
import {
  Card,
  Button,
  Typography,
  Space,
  Row,
  Col,
  Descriptions,
  Tag,
  Alert,
  Skeleton,
  App,
  theme,
} from "antd";
import {
  CreditCardOutlined,
} from "@ant-design/icons";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { ErrorState } from "@/components/PageStates";

const { Title, Text, Paragraph } = Typography;

interface Plan {
  id: string;
  name: string;
  priceId: string | null;
  voiceAgentsLimit: number;
  monthlyMinutesLimit: number;
  phoneNumbersLimit: number;
  kbSizeLimit: number;
  websiteImportsLimit: number;
  orderVolumeLimit: number;
}

interface Subscription {
  planId: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

interface BillingInfo {
  organizationId: string;
  subscription: Subscription;
  plan: Plan;
}

export default function BillingPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [billingInfo, setBillingInfo] = useState<BillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [checkoutLoadingPlan, setCheckoutLoadingPlan] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .get<BillingInfo>("/billing/subscription")
      .then(({ data }) => {
        setBillingInfo(data);
      })
      .catch(() => {
        setError("Failed to load billing and subscription information.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    Promise.resolve().then(() => {
      load();
    });
  }, []);

  const handlePortalRedirect = async () => {
    setPortalLoading(true);
    try {
      const returnUrl = typeof window !== "undefined" ? window.location.href : "http://localhost:3000/billing";
      const { data } = await api.post<{ url: string }>("/billing/portal", { returnUrl });
      if (data?.url) {
        window.location.href = data.url;
      } else {
        message.error("Could not retrieve customer portal URL.");
      }
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { message?: string } } };
      const msg = errorResponse.response?.data?.message || "Failed to launch billing portal.";
      message.error(msg);
    } finally {
      setPortalLoading(false);
    }
  };

  const handleSubscribe = async (planId: string) => {
    setCheckoutLoadingPlan(planId);
    try {
      const successUrl = typeof window !== "undefined" ? `${window.location.origin}/billing?success=true` : "http://localhost:3000/billing";
      const cancelUrl = typeof window !== "undefined" ? `${window.location.origin}/billing?cancel=true` : "http://localhost:3000/billing";
      
      const { data } = await api.post<{ url: string }>("/billing/checkout", {
        planId,
        successUrl,
        cancelUrl,
      });

      if (data?.url) {
        window.location.href = data.url;
      } else {
        message.error("Could not retrieve checkout session URL.");
      }
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { message?: string } } };
      const msg = errorResponse.response?.data?.message || "Failed to initialize checkout session.";
      message.error(msg);
    } finally {
      setCheckoutLoadingPlan(null);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: token.paddingLG }}>
        <Skeleton active paragraph={{ rows: 1 }} title={{ width: 200 }} style={{ marginBottom: token.marginLG }} />
        <Row gutter={[24, 24]}>
          <Col xs={24} lg={12}>
            <Card><Skeleton active paragraph={{ rows: 6 }} /></Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card><Skeleton active paragraph={{ rows: 6 }} /></Card>
          </Col>
        </Row>
      </div>
    );
  }

  if (error || !billingInfo) {
    return (
      <ErrorState
        message={error ?? "Could not load billing details."}
        onRetry={() => window.location.reload()}
      />
    );
  }

  const { plan, subscription } = billingInfo;
  const isFree = plan.id === "free";

  return (
    <>
      <PageHeader
        title="Billing & Subscription"
        subtitle="Manage your organization's subscription plans and limits."
      />

      <Row gutter={[24, 24]}>
        {/* Subscription Summary Card */}
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <CreditCardOutlined />
                <span>Current Plan details</span>
              </Space>
            }
            extra={
              !isFree && (
                <Button
                  loading={portalLoading}
                  onClick={handlePortalRedirect}
                  type="primary"
                  ghost
                  size="small"
                >
                  Stripe Customer Portal
                </Button>
              )
            }
            style={{ borderRadius: 8, height: "100%" }}
          >
            <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div>
                  <Title level={3} style={{ margin: "0 0 4px 0", fontWeight: 700 }}>
                    {plan.name}
                  </Title>
                  <Tag color={subscription.status === "active" ? "green" : "warning"}>
                    {subscription.status.toUpperCase()}
                  </Tag>
                </div>
                <div style={{ textAlign: "right" }}>
                  <Text type="secondary">Price</Text>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#1677ff" }}>
                    {plan.id === "free" ? "$0" : plan.id === "growth" ? "$49" : "$199"}/mo
                  </div>
                </div>
              </div>

              {subscription.currentPeriodEnd && (
                <div style={{ fontSize: 13, color: "#595959" }}>
                  <span>Period ends on </span>
                  <Text style={{ fontWeight: 500 }}>
                    {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                  </Text>
                  {subscription.cancelAtPeriodEnd && (
                    <Tag color="red" style={{ marginLeft: 8 }}>
                      Cancels at end of period
                    </Tag>
                  )}
                </div>
              )}

              <Descriptions title="Plan Limits" column={2} bordered size="small" style={{ marginTop: 8 }}>
                <Descriptions.Item label="Voice Agents">{plan.voiceAgentsLimit}</Descriptions.Item>
                <Descriptions.Item label="Monthly Minutes">{plan.monthlyMinutesLimit}</Descriptions.Item>
                <Descriptions.Item label="Phone Numbers">{plan.phoneNumbersLimit}</Descriptions.Item>
                <Descriptions.Item label="KB Limit">{plan.kbSizeLimit} MB</Descriptions.Item>
                <Descriptions.Item label="Web Imports" span={2}>{plan.websiteImportsLimit}</Descriptions.Item>
                <Descriptions.Item label="Monthly Orders" span={2}>{plan.orderVolumeLimit}</Descriptions.Item>
              </Descriptions>
            </Space>
          </Card>
        </Col>

        {/* Plan Upgrade Options */}
        <Col xs={24} lg={12}>
          <Card title="Available Upgrade Plans" style={{ borderRadius: 8, height: "100%" }}>
            <Space orientation="vertical" size="large" style={{ width: "100%" }}>
              {/* Growth Plan Card */}
              <Card
                size="small"
                style={{
                  border: plan.id === "growth" ? "2px solid #1677ff" : "1px solid #d9d9d9",
                  borderRadius: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <Title level={5} style={{ margin: 0, fontWeight: 700 }}>
                      Growth Plan
                    </Title>
                    <Paragraph style={{ margin: "4px 0 0 0", fontSize: 13 }} type="secondary">
                      Best for scaling restaurants with active phone ordering.
                    </Paragraph>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>$49/mo</div>
                    <Button
                      type={plan.id === "growth" ? "default" : "primary"}
                      disabled={plan.id === "growth" || plan.id === "enterprise"}
                      loading={checkoutLoadingPlan === "growth"}
                      onClick={() => handleSubscribe("growth")}
                      size="small"
                      style={{ marginTop: 4 }}
                    >
                      {plan.id === "growth" ? "Active" : "Upgrade"}
                    </Button>
                  </div>
                </div>
              </Card>

              {/* Enterprise Plan Card */}
              <Card
                size="small"
                style={{
                  border: plan.id === "enterprise" ? "2px solid #1677ff" : "1px solid #d9d9d9",
                  borderRadius: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <Title level={5} style={{ margin: 0, fontWeight: 700 }}>
                      Enterprise Plan
                    </Title>
                    <Paragraph style={{ margin: "4px 0 0 0", fontSize: 13 }} type="secondary">
                      Unlimited scale for chains and multi-location franchises.
                    </Paragraph>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>$199/mo</div>
                    <Button
                      type={plan.id === "enterprise" ? "default" : "primary"}
                      disabled={plan.id === "enterprise"}
                      loading={checkoutLoadingPlan === "enterprise"}
                      onClick={() => handleSubscribe("enterprise")}
                      size="small"
                      style={{ marginTop: 4 }}
                    >
                      {plan.id === "enterprise" ? "Active" : "Upgrade"}
                    </Button>
                  </div>
                </div>
              </Card>
            </Space>
          </Card>
        </Col>
      </Row>
    </>
  );
}
