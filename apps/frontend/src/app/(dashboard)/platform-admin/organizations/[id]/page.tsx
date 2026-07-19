"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Typography,
  Card,
  Tabs,
  Form,
  Input,
  Button,
  Space,
  Tag,
  App,
  theme,
  List,
  Switch,
  Breadcrumb,
  Steps,
  Popconfirm,
  Divider,
  Modal,
} from "antd";
import {
  SettingOutlined,
  PlayCircleOutlined,
  StopOutlined,
  DeleteOutlined,
  MailOutlined,
  ReloadOutlined,
  ProfileOutlined,
  FlagOutlined,
  BarChartOutlined,
  ArrowLeftOutlined,
} from "@ant-design/icons";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Organization, ProvisioningStatusResponse } from "../../types";

const { Title, Text } = Typography;

export default function OrganizationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const orgId = params.id as string;

  const [activeTab, setActiveTab] = useState("profile");

  // Data states
  const [org, setOrg] = useState<Organization | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  
  // Profile forms
  const [profileForm] = Form.useForm();
  const [profileSaving, setProfileSaving] = useState(false);

  // Feature Flags
  const [currentFlags, setCurrentFlags] = useState<Record<string, boolean>>({});
  const [featureFlagsSubmitting, setFeatureFlagsSubmitting] = useState(false);

  // Status
  const [statusData, setStatusData] = useState<ProvisioningStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  // Invite Modal
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);

  const fetchOrg = useCallback(async () => {
    try {
      setOrgLoading(true);
      const { data } = await api.get<Organization>(`/organizations/global/${orgId}`);
      setOrg(data);
      setCurrentFlags(data.featureFlags || {});
      profileForm.setFieldsValue({
        name: data.name,
        slug: data.slug,
      });
    } catch (err) {
      console.error(err);
      message.error("Failed to load organization details");
    } finally {
      setOrgLoading(false);
    }
  }, [orgId, message, profileForm]);

  const fetchStatus = useCallback(async () => {
    try {
      setStatusLoading(true);
      const { data } = await api.get<ProvisioningStatusResponse>(`/admin/organizations/${orgId}/provisioning-status`);
      setStatusData(data);
    } catch (err) {
      console.error(err);
      message.error("Failed to fetch provisioning status.");
    } finally {
      setStatusLoading(false);
    }
  }, [orgId, message]);

  useEffect(() => {
    fetchOrg();
    fetchStatus();
  }, [fetchOrg, fetchStatus]);

  // Profile Save
  const onSaveProfile = async (values: { name: string; slug: string }) => {
    try {
      setProfileSaving(true);
      await api.patch(`/organizations/global/${orgId}`, values);
      message.success("Organization profile updated");
      fetchOrg(); // reload data
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { message?: string | string[] } } };
      const msg = errorResponse.response?.data?.message || "Failed to update profile";
      message.error(Array.isArray(msg) ? msg.join(", ") : msg);
    } finally {
      setProfileSaving(false);
    }
  };

  // Feature Flags Save
  const handleSaveFeatureFlags = async () => {
    try {
      setFeatureFlagsSubmitting(true);
      await api.patch(`/organizations/global/${orgId}/feature-flags`, { featureFlags: currentFlags });
      message.success("Feature flags updated successfully.");
      fetchOrg();
    } catch (err) {
      console.error(err);
      message.error("Failed to update feature flags.");
    } finally {
      setFeatureFlagsSubmitting(false);
    }
  };

  // Provisioning Actions
  const handleRetry = async () => {
    try {
      setStatusLoading(true);
      await api.post(`/admin/organizations/${orgId}/retry`);
      message.success("Retry command sent.");
      fetchStatus();
    } catch (err) {
      console.error(err);
      message.error("Failed to retry.");
    } finally {
      setStatusLoading(false);
    }
  };

  const handleToggleStatus = async (currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "suspended" : "active";
    try {
      setStatusLoading(true);
      await api.patch(`/organizations/global/${orgId}`, { status: newStatus });
      message.success(`Organization ${newStatus} successfully.`);
      fetchOrg();
    } catch (err) {
      console.error(err);
      message.error("Failed to update status.");
    } finally {
      setStatusLoading(false);
    }
  };

  const handleDeprovision = async () => {
    try {
      setStatusLoading(true);
      await api.delete(`/organizations/global/${orgId}`);
      message.success("Deprovision command sent.");
      router.push("/platform-admin");
    } catch (err) {
      console.error(err);
      message.error("Failed to deprovision.");
    } finally {
      setStatusLoading(false);
    }
  };

  const handleInvite = () => {
    setInviteEmail("");
    setInviteModalVisible(true);
  };

  const submitInvite = async () => {
    if (!inviteEmail) {
      message.error("Please enter an email address.");
      return;
    }

    try {
      setInviteLoading(true);
      await api.post(`/admin/invitations`, {
        organizationId: orgId,
        email: inviteEmail,
        role: "sysadmin",
        notes: "Platform Admin generated invitation for sysadmin.",
      });
      message.success("Invitation generated! (Check console or email if hooked up)");
      setInviteModalVisible(false);
    } catch (err) {
      console.error(err);
      message.error("Failed to generate invitation.");
    } finally {
      setInviteLoading(false);
    }
  };

  if (orgLoading && !org) {
    return <div style={{ padding: 24 }}>Loading...</div>;
  }

  if (!org) {
    return <div style={{ padding: 24 }}>Organization not found.</div>;
  }

  const items = [
    {
      key: "profile",
      label: "Profile",
      icon: <ProfileOutlined />,
      children: (
        <Card title="Organization Profile" style={{ maxWidth: 800 }}>
          <Form form={profileForm} layout="vertical" onFinish={onSaveProfile}>
            <Form.Item name="name" label="Business Name" rules={[{ required: true, message: "Required" }]}>
              <Input size="large" />
            </Form.Item>
            <Form.Item name="slug" label="URL Slug" rules={[{ required: true, message: "Required" }]}>
              <Input size="large" />
            </Form.Item>
            <Divider />
            <Space>
              <Button type="primary" htmlType="submit" loading={profileSaving}>
                Save Changes
              </Button>
            </Space>
          </Form>
        </Card>
      ),
    },
    {
      key: "flags",
      label: "Feature Flags",
      icon: <FlagOutlined />,
      children: (
        <Card title="Feature Flags" style={{ maxWidth: 800 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {[
              { key: "enableSms", label: "Enable SMS Notifications", description: "Allow this org to send SMS to customers." },
              { key: "betaVoiceModels", label: "Beta Voice Models", description: "Use bleeding edge AI voice models." },
              { key: "advancedAnalytics", label: "Advanced Analytics", description: "Enable the deep insights dashboard." },
              { key: "outboundWebhooks", label: "Outbound Webhooks", description: "Allow webhooks ingestion/emission." },
            ].map((item) => (
              <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{item.label}</div>
                  <div style={{ color: 'rgba(0, 0, 0, 0.45)', fontSize: '14px' }}>{item.description}</div>
                </div>
                <Switch
                  checked={currentFlags[item.key] || false}
                  onChange={(checked) => setCurrentFlags((prev) => ({ ...prev, [item.key]: checked }))}
                />
              </div>
            ))}
          </div>
          <Divider />
          <Button type="primary" onClick={handleSaveFeatureFlags} loading={featureFlagsSubmitting}>
            Save Flags
          </Button>
        </Card>
      ),
    },
    {
      key: "status",
      label: "Provisioning & Actions",
      icon: <BarChartOutlined />,
      children: (
        <Space orientation="vertical" size="large" style={{ width: "100%", maxWidth: 800 }}>
          <Card title="Organization Actions">
            <Space wrap>
              <Button icon={<MailOutlined />} onClick={handleInvite}>
                Invite Sysadmin
              </Button>
              {org.status === "active" ? (
                <Button danger icon={<StopOutlined />} onClick={() => handleToggleStatus("active")}>
                  Suspend
                </Button>
              ) : (
                <Button icon={<PlayCircleOutlined />} onClick={() => handleToggleStatus(org.status)}>
                  Activate
                </Button>
              )}
              <Button onClick={handleRetry} loading={statusLoading}>
                Retry Failed Steps
              </Button>
              <Popconfirm
                title="Are you sure you want to completely deprovision?"
                description="This releases phone numbers and deletes agents from the voice provider."
                onConfirm={handleDeprovision}
                okText="Yes, Destroy"
                cancelText="Cancel"
                okButtonProps={{ danger: true }}
              >
                <Button danger type="primary" icon={<DeleteOutlined />}>
                  Deprovision
                </Button>
              </Popconfirm>
            </Space>
          </Card>

          <Card
            title="Provisioning Status"
            extra={
              <Button icon={<ReloadOutlined />} onClick={fetchStatus} loading={statusLoading} type="text">
                Refresh
              </Button>
            }
          >
            {!statusData || statusData.steps.length === 0 ? (
              <Text type="secondary">No provisioning steps found.</Text>
            ) : (
              <Steps
                orientation="vertical"
                size="small"
                current={statusData.steps.findIndex((s) => s.status === "pending" || s.status === "in_progress")}
                status={statusData.hasFailures ? "error" : "process"}
                items={statusData.steps.map((step) => ({
                  title: step.stepName,
                  content: (
                    <div>
                      Status:{" "}
                      <Tag color={step.status === "completed" ? "green" : step.status === "failed" ? "red" : "blue"}>
                        {step.status}
                      </Tag>
                      {step.attempts > 0 && <span style={{ marginLeft: 8 }}>Attempts: {step.attempts}</span>}
                      {step.lastError && <div style={{ color: "red", marginTop: 4 }}>Error: {step.lastError}</div>}
                    </div>
                  ),
                }))}
              />
            )}
          </Card>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px" }}>
      <PageHeader
        overline={
          <Breadcrumb
            items={[
              { title: <a onClick={() => router.push("/platform-admin")}>Platform Admin</a> },
              { title: org.name },
            ]}
          />
        }
        title={
          <Space size={8}>
            <Button size="small" icon={<ArrowLeftOutlined />} aria-label="Back to platform admin" onClick={() => router.push("/platform-admin")} />
            {org.name}
          </Space>
        }
        subtitle={
          <Space size={8}>
            <Tag color={org.status === "active" ? "green" : "red"}>{org.status.toUpperCase()}</Tag>
            <Text type="secondary">ID: {org.id}</Text>
          </Space>
        }
      />

      <div style={{ background: token.colorBgContainer, borderRadius: token.borderRadius, padding: 24, minHeight: 600 }}>
        <Tabs
          tabPlacement="start"
          activeKey={activeTab}
          onChange={setActiveTab}
          items={items}
          style={{ minHeight: 400 }}
        />
      </div>

      {/* Invite Modal */}
      <Modal
        title="Invite System Administrator"
        open={inviteModalVisible}
        onCancel={() => setInviteModalVisible(false)}
        onOk={submitInvite}
        confirmLoading={inviteLoading}
        okText="Send Invite"
        forceRender={true}
      >
        <p>Enter the email address of the person you'd like to invite as a System Administrator for this organization.</p>
        <Input
          placeholder="admin@example.com"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          onPressEnter={submitInvite}
        />
      </Modal>
    </div>
  );
}
