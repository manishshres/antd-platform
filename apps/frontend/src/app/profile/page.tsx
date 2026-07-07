"use client";

import { useState, useEffect } from "react";
import {
  Form,
  Input,
  Button,
  Card,
  Typography,
  Space,
  Divider,
  App,
  Skeleton,
  Row,
  Col,
  theme,
} from "antd";
import {
  UserOutlined,
  MailOutlined,
  PhoneOutlined,
  LockOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";

const { Text } = Typography;

interface UserProfile {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phoneNumber: string | null;
  companyName: string | null;
  role: string;
  posPinSet?: boolean;
}

export default function ProfilePage() {
  const { message } = App.useApp();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingPosPin, setSavingPosPin] = useState(false);
  const { token } = theme.useToken();

  const [profileForm] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [posPinForm] = Form.useForm();

  useEffect(() => {
    api
      .get<UserProfile>("/users/me")
      // The Form isn't mounted while loading (a Skeleton is shown), so populate it via
      // initialValues from `profile` on mount rather than setFieldsValue here — the latter
      // warns "useForm is not connected to any Form element" when called pre-mount.
      .then(({ data }) => setProfile(data))
      .catch(() => message.error("Failed to load profile."))
      .finally(() => setLoading(false));
  }, [message]);

  const onSaveProfile = async (values: Record<string, string>) => {
    setSavingProfile(true);
    try {
      const { data } = await api.patch<UserProfile>("/users/me", {
        firstName: values.firstName || undefined,
        lastName: values.lastName || undefined,
        email: values.email || undefined,
        phoneNumber: values.phoneNumber || undefined,
        companyName: values.companyName || undefined,
      });
      setProfile(data);
      message.success("Profile updated successfully.");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Failed to update profile.";
      message.error(msg);
    } finally {
      setSavingProfile(false);
    }
  };

  const onChangePassword = async (values: Record<string, string>) => {
    setSavingPassword(true);
    try {
      await api.patch("/users/me/password", {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      message.success("Password changed successfully.");
      passwordForm.resetFields();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Failed to change password.";
      message.error(msg);
    } finally {
      setSavingPassword(false);
    }
  };

  const onSetPosPin = async (values: Record<string, string>) => {
    setSavingPosPin(true);
    try {
      await api.post("/users/me/pos-pin", {
        pin: values.pin,
      });
      message.success("POS PIN updated successfully.");
      setProfile((prev) => (prev ? { ...prev, posPinSet: true } : prev));
      posPinForm.resetFields();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Failed to set POS PIN.";
      message.error(msg);
    } finally {
      setSavingPosPin(false);
    }
  };

  if (loading) {
    return (
      <Space orientation="vertical" style={{ width: "100%" }} size={24}>
        <Skeleton active paragraph={{ rows: 4 }} />
        <Skeleton active paragraph={{ rows: 3 }} />
      </Space>
    );
  }

  return (
    <Space orientation="vertical" style={{ width: "100%", maxWidth: 720 }} size={token.margin}>
      <PageHeader
        title="My Profile"
        subtitle="Manage your personal information and account security."
      />

      {/* Personal Information */}
      <Card
        title="Personal Information"
        variant="outlined"
        extra={
          profile && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Role: <strong>{profile.role}</strong>
            </Text>
          )
        }
      >
        <Form
          form={profileForm}
          layout="vertical"
          onFinish={onSaveProfile}
          requiredMark={false}
          initialValues={{
            firstName: profile?.firstName ?? "",
            lastName: profile?.lastName ?? "",
            email: profile?.email ?? "",
            phoneNumber: profile?.phoneNumber ?? "",
            companyName: profile?.companyName ?? "",
          }}
        >
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item label="First Name" name="firstName">
                <Input
                  prefix={<UserOutlined style={{ color: token.colorTextPlaceholder }} />}
                  placeholder="First name"
                  maxLength={255}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Last Name" name="lastName">
                <Input
                  prefix={<UserOutlined style={{ color: token.colorTextPlaceholder }} />}
                  placeholder="Last name"
                  maxLength={255}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            label="Email Address"
            name="email"
            rules={[
              { type: "email", message: "Please enter a valid email address." },
            ]}
          >
            <Input
              prefix={<MailOutlined style={{ color: token.colorTextPlaceholder }} />}
              placeholder="you@example.com"
              maxLength={255}
            />
          </Form.Item>

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item label="Phone Number" name="phoneNumber">
                <Input
                  prefix={<PhoneOutlined style={{ color: token.colorTextPlaceholder }} />}
                  placeholder="+1 555 000 0000"
                  maxLength={50}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Company" name="companyName">
                <Input placeholder="Acme Corp" maxLength={255} />
              </Form.Item>
            </Col>
          </Row>

          <Divider style={{ margin: `${token.marginXS}px 0 ${token.marginLG}px` }} />

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={savingProfile}
            >
              Save Changes
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* Change Password */}
      <Card title="Change Password" variant="outlined">
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={onChangePassword}
          requiredMark={false}
        >
          <Form.Item
            label="Current Password"
            name="currentPassword"
            rules={[{ required: true, message: "Please enter your current password." }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: token.colorTextPlaceholder }} />}
              placeholder="Current password"
            />
          </Form.Item>

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                label="New Password"
                name="newPassword"
                rules={[
                  { required: true, message: "Please enter a new password." },
                  { min: 8, message: "Password must be at least 8 characters." },
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: token.colorTextPlaceholder }} />}
                  placeholder="New password"
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                label="Confirm New Password"
                name="confirmPassword"
                dependencies={["newPassword"]}
                rules={[
                  { required: true, message: "Please confirm your new password." },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue("newPassword") === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error("Passwords do not match."));
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: token.colorTextPlaceholder }} />}
                  placeholder="Confirm new password"
                />
              </Form.Item>
            </Col>
          </Row>

          <Divider style={{ margin: `${token.marginXS}px 0 ${token.marginLG}px` }} />

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={savingPassword}
            >
              Change Password
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* POS Settings (Managers/Admins only) */}
      {profile && ["manager", "platform_admin", "sysadmin"].includes(profile.role) && (
        <Card
          title="POS Settings"
          variant="outlined"
          extra={
            <Text type="secondary" style={{ fontSize: 12 }}>
              {profile.posPinSet ? (
                <Text type="success">PIN is currently set</Text>
              ) : (
                <Text type="warning">No PIN set</Text>
              )}
            </Text>
          }
        >
          <Form
            form={posPinForm}
            layout="vertical"
            onFinish={onSetPosPin}
            requiredMark={false}
          >
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item
                  label="Manager POS PIN"
                  name="pin"
                  extra="A 4-digit PIN used to authorize voids and refunds on the POS."
                  rules={[
                    { required: true, message: "Please enter a 4-digit PIN." },
                    { pattern: /^[0-9]{4}$/, message: "PIN must be exactly 4 digits." },
                  ]}
                >
                  <Input.Password
                    prefix={<LockOutlined style={{ color: token.colorTextPlaceholder }} />}
                    placeholder="Enter 4-digit PIN"
                    maxLength={4}
                  />
                </Form.Item>
              </Col>
            </Row>

            <Divider style={{ margin: `${token.marginXS}px 0 ${token.marginLG}px` }} />

            <Form.Item style={{ marginBottom: 0 }}>
              <Button
                type="primary"
                htmlType="submit"
                icon={<SaveOutlined />}
                loading={savingPosPin}
              >
                Set PIN
              </Button>
            </Form.Item>
          </Form>
        </Card>
      )}
    </Space>
  );
}
