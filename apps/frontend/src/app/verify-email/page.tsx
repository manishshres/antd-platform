"use client";

import { useEffect, useState, Suspense } from "react";
import { Card, Typography, Alert, theme, Spin, Button } from "antd";
import { ConeekoLogo } from "@/components/Logo";
import { api } from "@/lib/api";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const { Title, Text } = Typography;

function VerifyEmailContent() {
  const { token: antdToken } = theme.useToken();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  
  const [loading, setLoading] = useState(!!token);
  const [error, setError] = useState<string | null>(!token ? "Verification token is missing from the URL." : null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }

    const verify = async () => {
      try {
        await api.post("/auth/verify-email", { token });
        setSuccess(true);
      } catch (err: unknown) {
        const errorResponse = err as { response?: { data?: { message?: string | string[] } } };
        const msg = errorResponse.response?.data?.message || "Failed to verify email. The token may be invalid or expired.";
        setError(Array.isArray(msg) ? msg.join(", ") : msg);
      } finally {
        setLoading(false);
      }
    };

    verify();
  }, [token]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: `${antdToken.paddingXL}px 0` }}>
        <Spin size="large" />
        <div style={{ marginTop: antdToken.margin }}>
          <Text type="secondary">Verifying your email address...</Text>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: "center" }}>
        <Alert
          title="Verification Failed"
          description={error}
          type="error"
          showIcon
          style={{ marginBottom: antdToken.margin, textAlign: "left" }}
        />
        <Link href="/login">
          <Button type="primary" size="large" block>
            Return to Login
          </Button>
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div style={{ textAlign: "center" }}>
        <Alert
          title="Email Verified"
          description="Your email address has been successfully verified. You can now log in."
          type="success"
          showIcon
          style={{ marginBottom: antdToken.margin, textAlign: "left" }}
        />
        <Link href="/login">
          <Button type="primary" size="large" block>
            Go to Login
          </Button>
        </Link>
      </div>
    );
  }

  return null;
}

export default function VerifyEmailPage() {
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
            <Text type="secondary">Email Verification</Text>
          </div>
        </div>

        <Suspense fallback={<div style={{ textAlign: "center" }}><Spin /></div>}>
          <VerifyEmailContent />
        </Suspense>
      </Card>
      <div style={{ marginTop: 24, textAlign: 'center', color: token.colorTextDescription }}>
        Copyright © {new Date().getFullYear()} <a href="https://coneeko.com" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>Coneeko</a>. All rights reserved.
      </div>
    </div>
  );
}
