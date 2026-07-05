"use client";

import { useEffect, useState, Suspense } from "react";
import { Form, Input, Button, Card, Typography, Alert, Space, theme, Spin } from "antd";
import { LockOutlined, RobotOutlined, CheckCircleOutlined, UserOutlined, PhoneOutlined } from "@ant-design/icons";
import { ConeekoLogo } from "@/components/Logo";
import { api } from "@/lib/api";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";

const { Title, Text } = Typography;

function InviteContent() {
  const { token: themeToken } = theme.useToken();
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const token = searchParams.get("token");
  
  const [validating, setValidating] = useState(!!token);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(!token ? "Invitation token is missing from the URL." : null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    const validate = async () => {
      try {
        const { data } = await api.get<{ organizationName: string; email: string }>(`/invitations/${token}/validate`);
        setOrgName(data.organizationName);
        setEmail(data.email);
      } catch (err: unknown) {
        const errorResponse = err as { response?: { data?: { message?: string | string[] } } };
        const msg = errorResponse.response?.data?.message || "Invalid or expired invitation token.";
        setError(Array.isArray(msg) ? msg.join(", ") : msg);
      } finally {
        setValidating(false);
      }
    };

    validate();
  }, [token]);

  const onFinish = async (values: Record<string, string>) => {
    if (!token) return;

    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post<{ access_token?: string; refresh_token?: string }>(`/invitations/${token}/accept`, {
        firstName: values.firstName,
        lastName: values.lastName,
        password: values.password,
        phone: values.phone,
      });
      
      if (data?.access_token) {
        // Refresh token is set as an HttpOnly cookie by the backend (H2) — do not persist it.
        localStorage.setItem("access_token", data.access_token);
        window.dispatchEvent(new Event("auth-change"));
        router.push("/dashboard");
      }
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { message?: string | string[] } } };
      const msg = errorResponse.response?.data?.message || "Failed to accept invitation.";
      setError(Array.isArray(msg) ? msg.join(", ") : msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (validating) {
    return (
      <div style={{ textAlign: "center", padding: `${themeToken.paddingXL}px 0` }}>
        <Spin size="large" />
        <div style={{ marginTop: themeToken.margin }}>
          <Text type="secondary">Validating your invitation...</Text>
        </div>
      </div>
    );
  }

  if (error) {
    const isExpired = error.toLowerCase().includes("expired");
    return (
      <div style={{ textAlign: "center" }}>
        <Alert
          title={isExpired ? "Invitation Expired" : "Invitation Error"}
          description={
            <div>
              <p>{error}</p>
              {isExpired && (
                <p style={{ marginTop: 8 }}>
                  For security reasons, invitations expire after 7 days. Please ask your administrator or manager to send you a new invitation link.
                </p>
              )}
            </div>
          }
          type="error"
          showIcon
          style={{ marginBottom: themeToken.margin, textAlign: "left" }}
        />
        <Link href="/login">
          <Button type="primary" size="large" block>
            Return to Login
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <>
      <div style={{ textAlign: "center", marginBottom: themeToken.margin }}>
        <Text>
          You have been invited to join <strong style={{ color: themeToken.colorPrimary }}>{orgName}</strong>
        </Text>
        <div style={{ marginTop: 4 }}>
          <Text type="secondary">({email})</Text>
        </div>
      </div>

      <Form name="accept_invite" layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Space orientation="horizontal" style={{ width: "100%" }}>
          <Form.Item
            name="firstName"
            rules={[{ required: true, message: "Please input your first name!" }]}
            style={{ width: "100%", margin: 0 }}
          >
            <Input
              prefix={<UserOutlined style={{ color: themeToken.colorTextPlaceholder }} />}
              placeholder="First name"
              size="large"
            />
          </Form.Item>
          <Form.Item
            name="lastName"
            rules={[{ required: true, message: "Please input your last name!" }]}
            style={{ width: "100%", margin: 0 }}
          >
            <Input
              placeholder="Last name"
              size="large"
            />
          </Form.Item>
        </Space>
        
        <div style={{ height: themeToken.margin }} />

        <Form.Item
          name="phone"
          rules={[{ required: true, message: "Please input your phone number!" }]}
        >
          <Input
            prefix={<PhoneOutlined style={{ color: themeToken.colorTextPlaceholder }} />}
            placeholder="Phone number"
            size="large"
          />
        </Form.Item>

        <Form.Item
          name="password"
          rules={[{ required: true, message: "Please create a password!" }, { min: 8, message: "Password must be at least 8 characters long." }]}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: themeToken.colorTextPlaceholder }} />}
            placeholder="Create password"
            size="large"
          />
        </Form.Item>

        <Form.Item style={{ marginBottom: themeToken.marginSM }}>
          <Button
            type="primary"
            htmlType="submit"
            size="large"
            block
            loading={submitting}
            style={{ fontWeight: 600, height: 44 }}
          >
            Create Account & Join
          </Button>
        </Form.Item>
      </Form>
    </>
  );
}

export default function InvitePage() {
  const { token } = theme.useToken();

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        background: `linear-gradient(135deg, ${token.colorBgContainer} 0%, ${token.colorBgLayout} 100%)`,
        padding: token.padding,
      }}
    >
      <Card
        style={{
          width: "100%",
          maxWidth: 400,
          borderRadius: token.borderRadiusLG,
          boxShadow: token.boxShadowSecondary,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: token.marginMD }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: token.marginXS }}>
            <ConeekoLogo width={250} color={token.colorText} />
          </div>
          <div>
            <Text type="secondary">Join your organization</Text>
          </div>
        </div>

        <Suspense fallback={<div style={{ textAlign: "center" }}><Spin /></div>}>
          <InviteContent />
        </Suspense>
      </Card>
      <div style={{ marginTop: 24, textAlign: 'center', color: token.colorTextDescription }}>
        Copyright © {new Date().getFullYear()} <a href="https://coneeko.com" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>Coneeko</a>. All rights reserved.
      </div>
    </div>
  );
}
