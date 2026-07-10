"use client";

import { useState, useEffect } from "react";
import { Form, Input, Button, Card, Typography, Alert, Space, theme, message } from "antd";
import { LockOutlined, MailOutlined, RobotOutlined } from "@ant-design/icons";
import { ConeekoLogo } from "@/components/Logo";
import { useRouter } from "next/navigation";
import { api, onLoginSuccess } from "@/lib/api";
import { getAccessToken } from "@/lib/token-store";
import Link from "next/link";

const { Title, Text } = Typography;

export default function RegisterPage() {
  const router = useRouter();
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already authenticated, redirect to dashboard
  useEffect(() => {
    if (getAccessToken()) {
      window.location.href = "/dashboard";
    }
  }, []);

  const onFinish = async (values: Record<string, string>) => {
    setLoading(true);
    setError(null);
    try {
      // 1. Register user
      await api.post("/auth/register", {
        email: values.email,
        password: values.password,
        firstName: values.firstName,
        lastName: values.lastName,
        companyName: values.companyName,
        phoneNumber: values.phoneNumber,
      });

      message.success("Account created successfully! Logging in...");

      // 2. Auto-login
      const { data } = await api.post<{ access_token?: string; refresh_token?: string }>("/auth/login", {
        email: values.email,
        password: values.password,
      });

      if (data?.access_token) {
        // Refresh token is set as an HttpOnly cookie by the backend (H2) — do not persist it.
        onLoginSuccess(data.access_token);
        window.dispatchEvent(new Event("auth-change"));
        window.location.href = "/dashboard";
      } else {
        router.push("/login");
      }
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { message?: string | string[] } } };
      const msg = errorResponse.response?.data?.message || "Registration failed. Email might already exist.";
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
          maxWidth: 450,
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
            <Text type="secondary">Sign up for your Coneeko Portal</Text>
          </div>
        </div>

        {error && (
          <Alert
            description={error}
            type="error"
            showIcon
            style={{ marginBottom: token.margin }}
          />
        )}

        <Form name="register" layout="vertical" onFinish={onFinish} requiredMark={false}>
          <div style={{ display: "flex", gap: token.marginSM }}>
            <Form.Item
              name="firstName"
              style={{ flex: 1, marginBottom: token.marginSM }}
              rules={[{ required: true, message: "Required" }]}
            >
              <Input placeholder="First Name" size="large" />
            </Form.Item>
            <Form.Item
              name="lastName"
              style={{ flex: 1, marginBottom: token.marginSM }}
              rules={[{ required: true, message: "Required" }]}
            >
              <Input placeholder="Last Name" size="large" />
            </Form.Item>
          </div>

          <Form.Item
            name="companyName"
            style={{ marginBottom: token.marginSM }}
            rules={[{ required: true, message: "Company name is required!" }]}
          >
            <Input placeholder="Company / Restaurant Name" size="large" />
          </Form.Item>

          <Form.Item
            name="phoneNumber"
            style={{ marginBottom: token.marginSM }}
            rules={[{ required: true, message: "Phone number is required!" }]}
          >
            <Input placeholder="Phone Number" size="large" />
          </Form.Item>

          <Form.Item
            name="email"
            style={{ marginBottom: token.marginSM }}
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

          <div style={{ display: "flex", gap: token.marginSM }}>
            <Form.Item
              name="password"
              style={{ flex: 1, marginBottom: token.marginSM }}
              rules={[
                { required: true, message: "Required" },
                { min: 6, message: "Min 6 chars" },
              ]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: token.colorTextPlaceholder }} />}
                placeholder="Password"
                size="large"
              />
            </Form.Item>

            <Form.Item
              name="confirm"
              style={{ flex: 1, marginBottom: token.marginSM }}
              dependencies={["password"]}
              rules={[
                { required: true, message: "Required" },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue("password") === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error("Mismatch"));
                  },
                }),
              ]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: token.colorTextPlaceholder }} />}
                placeholder="Confirm"
                size="large"
              />
            </Form.Item>
          </div>

          <Form.Item style={{ marginBottom: token.marginSM }}>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              block
              loading={loading}
              style={{ fontWeight: 600, height: 44 }}
            >
              Sign Up
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: "center", marginTop: token.margin }}>
          <Text type="secondary">Already have an account? </Text>
          <Link href="/login" style={{ fontWeight: 600, color: token.colorPrimary }}>
            Sign in
          </Link>
        </div>
      </Card>
      <div style={{ marginTop: 24, textAlign: 'center', color: token.colorTextDescription }}>
        Copyright © {new Date().getFullYear()} <a href="https://coneeko.com" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>Coneeko</a>. All rights reserved.
      </div>
    </div>
  );
}
