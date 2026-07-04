"use client";

import { useState, useEffect } from "react";
import { Form, Input, Button, Card, Typography, Alert, Space, theme, Checkbox } from "antd";
import { LockOutlined, MailOutlined, RobotOutlined } from "@ant-design/icons";
import { ConeekoLogo } from "@/components/Logo";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import Link from "next/link";

const { Title, Text } = Typography;

export default function LoginPage() {
  const router = useRouter();
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already authenticated, redirect to dashboard
  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem("access_token")) {
      router.push("/dashboard");
    }
  }, [router]);

  const onFinish = async (values: { email: string; password: string; rememberMe?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post<{ access_token?: string; refresh_token?: string }>("/auth/login", {
        email: values.email,
        password: values.password,
        rememberMe: values.rememberMe,
      });

      if (data?.access_token) {
        localStorage.setItem("access_token", data.access_token);
        if (data.refresh_token) {
          localStorage.setItem("refresh_token", data.refresh_token);
        }
        router.push("/dashboard");
      } else {
        setError("Invalid response format from server.");
      }
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { message?: string | string[] } } };
      const msg = errorResponse.response?.data?.message || "Invalid credentials.";
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
            <Text type="secondary">Sign in to manage your AI Voice Portal</Text>
          </div>
        </div>

        {error && (
          <Alert
            title={error}
            type="error"
            showIcon
            style={{ marginBottom: token.margin }}
          />
        )}

        <Form name="login" layout="vertical" onFinish={onFinish} requiredMark={false}>
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

          <Form.Item
            name="password"
            rules={[{ required: true, message: "Please input your password!" }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: token.colorTextPlaceholder }} />}
              placeholder="Password"
              size="large"
            />
          </Form.Item>

          <Form.Item name="rememberMe" valuePropName="checked" style={{ marginBottom: token.margin }}>
            <Checkbox>Remember me for 30 days</Checkbox>
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
              Sign In
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: "center", marginTop: token.margin }}>
          <div style={{ marginBottom: token.marginSM }}>
            <Link href="/forgot-password" style={{ color: token.colorTextSecondary }}>
              Forgot password?
            </Link>
          </div>
          <Text type="secondary">
            Need access? Contact your platform administrator.
          </Text>
        </div>
      </Card>
      <div style={{ marginTop: 24, textAlign: 'center', color: token.colorTextDescription }}>
        Copyright © {new Date().getFullYear()} <a href="https://coneeko.com" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>Coneeko</a>. All rights reserved.
      </div>
    </div>
  );
}
