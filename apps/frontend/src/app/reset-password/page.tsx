"use client";

import { useState, Suspense } from "react";
import { Form, Input, Button, Card, Typography, Alert, Space, theme } from "antd";
import { LockOutlined, RobotOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import { ConeekoLogo } from "@/components/Logo";
import { api } from "@/lib/api";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";

const { Title, Text } = Typography;

function ResetPasswordForm() {
  const { token } = theme.useToken();
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const resetToken = searchParams.get("token");
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onFinish = async (values: Record<string, string>) => {
    if (values.password !== values.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!resetToken) {
      setError("Reset token is missing from the URL.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await api.post("/auth/reset-password", {
        token: resetToken,
        newPassword: values.password,
      });
      setSuccess(true);
      // Optionally redirect after a few seconds
      setTimeout(() => {
        router.push("/login");
      }, 3000);
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { message?: string | string[] } } };
      const msg = errorResponse.response?.data?.message || "Failed to reset password. The token may be invalid or expired.";
      setError(Array.isArray(msg) ? msg.join(", ") : msg);
    } finally {
      setLoading(false);
    }
  };

  if (!resetToken) {
    return (
      <Alert 
        title="Missing Token" 
        description="The password reset token is missing from the URL. Please check the link in your email." 
        type="error" 
        showIcon 
      />
    );
  }

  if (success) {
    return (
      <div style={{ textAlign: "center" }}>
        <Alert
          title="Password Reset Successful"
          description="Your password has been successfully reset. Redirecting to login..."
          type="success"
          showIcon
          style={{ marginBottom: token.margin, textAlign: "left" }}
        />
        <Link href="/login">
          <Button type="primary" size="large" block>
            Return to Login Now
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <>
      {error && (
        <Alert title="Error" description={error} type="error" showIcon style={{ marginBottom: token.margin }} />
      )}

      <Form name="reset_password" layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item
          name="password"
          rules={[{ required: true, message: "Please input your new password!" }, { min: 8, message: "Password must be at least 8 characters long." }]}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: token.colorTextPlaceholder }} />}
            placeholder="New password"
            size="large"
          />
        </Form.Item>

        <Form.Item
          name="confirmPassword"
          dependencies={["password"]}
          rules={[{ required: true, message: "Please confirm your new password!" }]}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: token.colorTextPlaceholder }} />}
            placeholder="Confirm new password"
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
            Reset Password
          </Button>
        </Form.Item>
      </Form>

      <div style={{ textAlign: "center", marginTop: token.margin }}>
        <Link href="/login" style={{ color: token.colorTextSecondary }}>
          <ArrowLeftOutlined style={{ marginRight: 8 }} />
          Back to login
        </Link>
      </div>
    </>
  );
}

export default function ResetPasswordPage() {
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
            <Text type="secondary">Create a new password</Text>
          </div>
        </div>

        <Suspense fallback={<div>Loading...</div>}>
          <ResetPasswordForm />
        </Suspense>
      </Card>
      <div style={{ marginTop: 24, textAlign: 'center', color: token.colorTextDescription }}>
        Copyright © {new Date().getFullYear()} <a href="https://coneeko.com" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>Coneeko</a>. All rights reserved.
      </div>
    </div>
  );
}
