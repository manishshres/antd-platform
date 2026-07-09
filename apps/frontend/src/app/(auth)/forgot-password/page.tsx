"use client";

import { useState } from "react";
import { Form, Input, Button, Card, Typography, Alert, Space, theme } from "antd";
import { MailOutlined, RobotOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import { ConeekoLogo } from "@/components/Logo";
import { api } from "@/lib/api";
import Link from "next/link";

const { Title, Text } = Typography;

export default function ForgotPasswordPage() {
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onFinish = async (values: { email: string }) => {
    setLoading(true);
    setError(null);
    try {
      await api.post("/auth/forgot-password", { email: values.email });
      setSuccess(true);
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { message?: string | string[] } } };
      const msg = errorResponse.response?.data?.message || "Failed to process request.";
      setError(Array.isArray(msg) ? msg.join(", ") : msg);
    } finally {
      setLoading(false);
    }
  };

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
            <Text type="secondary">Reset your password</Text>
          </div>
        </div>

        {error && (
          <Alert title="Error" description={error} type="error" showIcon style={{ marginBottom: token.margin }} />
        )}

        {success ? (
          <div style={{ textAlign: "center" }}>
            <Alert
              title="Check your email"
              description="If an account exists for that email, we have sent instructions to reset your password."
              type="success"
              showIcon
              style={{ marginBottom: token.margin, textAlign: "left" }}
            />
            <Link href="/login">
              <Button type="primary" size="large" block>
                Return to Login
              </Button>
            </Link>
          </div>
        ) : (
          <Form name="forgot_password" layout="vertical" onFinish={onFinish} requiredMark={false}>
            <Form.Item
              name="email"
              rules={[
                { required: true, message: "Please input your email address!" },
                { type: "email", message: "Please enter a valid email address!" },
              ]}
            >
              <Input
                prefix={<MailOutlined style={{ color: token.colorTextPlaceholder }} />}
                placeholder="Email address"
                size="large"
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: token.marginSM }}>
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={loading}
                style={{ fontWeight: 600, height: 44 }}
              >
                Send Reset Link
              </Button>
            </Form.Item>
          </Form>
        )}

        {!success && (
          <div style={{ textAlign: "center", marginTop: token.margin }}>
            <Link href="/login" style={{ color: token.colorTextSecondary }}>
              <ArrowLeftOutlined style={{ marginRight: 8 }} />
              Back to login
            </Link>
          </div>
        )}
      </Card>
      <div style={{ marginTop: 24, textAlign: 'center', color: token.colorTextDescription }}>
        Copyright © {new Date().getFullYear()} <a href="https://coneeko.com" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>Coneeko</a>. All rights reserved.
      </div>
    </div>
  );
}
