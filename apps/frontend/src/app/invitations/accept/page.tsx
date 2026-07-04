"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Typography,
  Card,
  Form,
  Input,
  Button,
  Layout,
  Divider,
  App,
  Skeleton,
  Space,
} from "antd";
import { LockOutlined, UserOutlined, PhoneOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { api } from "@/lib/api";

const { Title, Text } = Typography;

interface ValidationData {
  email: string;
  role: string;
  organizationName: string;
  locationName?: string;
}

function AcceptInvitationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const { message } = App.useApp();

  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(true);
  const [validationData, setValidationData] = useState<ValidationData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("No invitation token provided in URL.");
      setValidating(false);
      setLoading(false);
      return;
    }

    const validate = async () => {
      try {
        const minWait = new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 3000));
        const [apiResponse] = await Promise.all([
          api.get<ValidationData>(`/invitations/${token}/validate`),
          minWait
        ]);
        setValidationData(apiResponse.data);
      } catch (err: unknown) {
        setError("Invalid or expired invitation token.");
      } finally {
        setValidating(false);
        setLoading(false);
      }
    };

    validate();
  }, [token]);

  const onFinish = async (values: any) => {
    if (!token) return;

    try {
      setLoading(true);
      const { data } = await api.post<{ access_token?: string; refresh_token?: string }>("/invitations/accept", {
        token,
        firstName: values.firstName,
        lastName: values.lastName,
        phoneNumber: values.phoneNumber || "N/A",
        password: values.password,
      });

      if (data?.access_token) {
        // Refresh token is set as an HttpOnly cookie by the backend (H2) — do not persist it.
        localStorage.setItem("access_token", data.access_token);
        message.success("Invitation accepted! Logging you in...");
        router.push("/dashboard");
      } else {
        setError("Failed to log in automatically.");
      }
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { message?: string | string[] } } };
      const msg = errorResponse.response?.data?.message || "Failed to accept invitation.";
      setError(Array.isArray(msg) ? msg.join(", ") : msg);
    } finally {
      setLoading(false);
    }
  };

  if (validating) {
    return (
      <Layout style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
        <Card style={{ width: 450, padding: 12 }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <SafetyCertificateOutlined style={{ fontSize: 36, color: "#e8e8e8", marginBottom: 8 }} />
            <Skeleton.Input active size="small" style={{ width: 200, display: "block", margin: "0 auto 8px" }} />
            <Skeleton.Input active size="small" style={{ width: 250, display: "block", margin: "0 auto" }} />
          </div>
          <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
            <Skeleton.Input active block />
            <Skeleton.Input active block />
            <Skeleton.Input active block />
            <Divider style={{ margin: "12px 0" }} />
            <div style={{ display: "flex", gap: 16 }}>
              <Skeleton.Input active block />
              <Skeleton.Input active block />
            </div>
            <Skeleton.Input active block />
            <Skeleton.Input active block />
            <Skeleton.Button active block size="large" style={{ marginTop: 16 }} />
          </Space>
        </Card>
      </Layout>
    );
  }

  if (error || !validationData) {
    return (
      <Layout style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
        <Card style={{ width: 400, textAlign: "center" }}>
          <SafetyCertificateOutlined style={{ fontSize: 48, color: "#ff4d4f", marginBottom: 16 }} />
          <Title level={4}>Invitation Error</Title>
          <Text type="danger">{error}</Text>
          <Divider />
          <Button type="primary" onClick={() => router.push("/login")} block>
            Go to Login
          </Button>
        </Card>
      </Layout>
    );
  }

  return (
    <Layout style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
      <Card style={{ width: 450, padding: 12 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <SafetyCertificateOutlined style={{ fontSize: 36, color: "#1677ff", marginBottom: 8 }} />
          <Title level={3} style={{ margin: 0 }}>
            Accept Invitation
          </Title>
          <Text type="secondary">Create your profile and set a password</Text>
        </div>

        <Form
          name="accept_invitation"
          layout="vertical"
          onFinish={onFinish}
          requiredMark={false}
          autoComplete="off"
        >
          <Form.Item label="Email Address" style={{ marginBottom: 12 }}>
            <Input prefix={<UserOutlined />} value={validationData.email} disabled />
          </Form.Item>

          <Form.Item label="Organization" style={{ marginBottom: 12 }}>
            <Input value={validationData.organizationName} disabled />
          </Form.Item>

          {validationData.locationName && (
            <Form.Item label="Location" style={{ marginBottom: 12 }}>
              <Input value={validationData.locationName} disabled />
            </Form.Item>
          )}

          <Form.Item label="Role" style={{ marginBottom: 12 }}>
            <Input value={validationData.role} disabled style={{ textTransform: "capitalize" }} />
          </Form.Item>

          <Divider style={{ margin: "12px 0" }} />

          <div style={{ display: "flex", gap: 16 }}>
            <Form.Item
              name="firstName"
              label="First Name"
              rules={[{ required: true, message: "Please input your first name!" }]}
              style={{ flex: 1 }}
            >
              <Input placeholder="John" />
            </Form.Item>

            <Form.Item
              name="lastName"
              label="Last Name"
              rules={[{ required: true, message: "Please input your last name!" }]}
              style={{ flex: 1 }}
            >
              <Input placeholder="Doe" />
            </Form.Item>
          </div>

          <Form.Item
            name="phoneNumber"
            label="Phone Number"
            rules={[{ required: true, message: "Please input your phone number!" }]}
          >
            <Input prefix={<PhoneOutlined />} placeholder="+1 (555) 000-0000" />
          </Form.Item>

          <Form.Item
            name="password"
            label="New Password"
            rules={[
              { required: true, message: "Please input your new password!" },
              { min: 8, message: "Password must be at least 8 characters long." },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="••••••••" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
            <Button type="primary" htmlType="submit" block loading={loading} size="large">
              Accept & Login
            </Button>
          </Form.Item>
        </Form>
      </Card>
      <div style={{ marginTop: 24, textAlign: 'center', color: '#8c8c8c' }}>
        Copyright © {new Date().getFullYear()} <a href="https://coneeko.com" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>Coneeko</a>. All rights reserved.
      </div>
    </Layout>
  );
}

export default function AcceptInvitationPage() {
  return (
    <React.Suspense
      fallback={
        <Layout style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
          <Text>Loading...</Text>
        </Layout>
      }
    >
      <AcceptInvitationContent />
    </React.Suspense>
  );
}
