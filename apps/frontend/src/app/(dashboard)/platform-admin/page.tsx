"use client";
import { useRouter } from "next/navigation";

import React, { useEffect, useState, useCallback } from "react";
import {
  Typography,
  Card,
  Table,
  Button,
  Tag,
  Space,
  Row,
  Col,
  Statistic,
  App,
  Modal,
  Form,
  Input,
  Drawer,
  Steps,
  Popconfirm,
  Switch,
  List,
  Dropdown,
} from "antd";
import type { MenuProps } from "antd";
import {
  PlusOutlined,
  ReloadOutlined,
  PlayCircleOutlined,
  StopOutlined,
  DeleteOutlined,
  MailOutlined,
  SettingOutlined,
  EnvironmentOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import {
  ProvisioningSummary,
  Organization,
  CreateOrgProvisionDto,
  ProvisioningStatusResponse,
} from "./types";

const { Title, Text } = Typography;

export default function PlatformAdminDashboard() {
  const router = useRouter();
  const { message } = App.useApp();

  // Data states
  const [summary, setSummary] = useState<ProvisioningSummary | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal (Create Org) states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalSubmitting, setModalSubmitting] = useState(false);

  // Drawer (View Org Status) states
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);

  // Modal (Add Location) states
  const [addLocModalVisible, setAddLocModalVisible] = useState(false);
  const [addLocSubmitting, setAddLocSubmitting] = useState(false);
  const [addLocForm] = Form.useForm();

  // Modal (Feature Flags) states
  const [featureFlagsModalVisible, setFeatureFlagsModalVisible] = useState(false);
  const [featureFlagsSubmitting, setFeatureFlagsSubmitting] = useState(false);
  const [currentFlags, setCurrentFlags] = useState<Record<string, boolean>>({});

  const loadDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      const [summaryRes, orgsRes] = await Promise.all([
        api.get<ProvisioningSummary>("/admin/organizations/provisioning-summary"),
        api.get<Organization[]>("/admin/organizations"),
      ]);
      setSummary(summaryRes.data);
      setOrgs(orgsRes.data);
    } catch (err) {
      console.error(err);
      message.error("Failed to load platform dashboard data.");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDashboardData();
  }, [loadDashboardData]);

  // Handle Create
  const handleCreateSubmit = async (values: CreateOrgProvisionDto) => {
    try {
      setModalSubmitting(true);
      await api.post("/admin/organizations", values);
      message.success("Organization provisioning enqueued successfully.");
      setIsModalOpen(false);
      loadDashboardData();
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { message?: string | string[] } } };
      const msg = errorResponse.response?.data?.message || "Failed to create organization";
      message.error(Array.isArray(msg) ? msg.join(", ") : msg);
    } finally {
      setModalSubmitting(false);
    }
  };



  const handleAddLocationSubmit = async (values: Record<string, unknown>) => {
    if (!selectedOrg) return;
    try {
      setAddLocSubmitting(true);
      await api.post(`/admin/organizations/${selectedOrg.id}/locations`, values);
      message.success("New location provisioning enqueued successfully.");
      setAddLocModalVisible(false);
      addLocForm.resetFields();
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { message?: string | string[] } } };
      const msg = errorResponse.response?.data?.message || "Failed to provision location";
      message.error(Array.isArray(msg) ? msg.join(", ") : msg);
    } finally {
      setAddLocSubmitting(false);
    }
  };

  const openFeatureFlags = (org: Organization) => {
    setSelectedOrg(org);
    setCurrentFlags(org.featureFlags || {});
    setFeatureFlagsModalVisible(true);
  };

  const handleSaveFeatureFlags = async () => {
    if (!selectedOrg) return;
    try {
      setFeatureFlagsSubmitting(true);
      await api.patch(`/admin/organizations/${selectedOrg.id}`, { featureFlags: currentFlags });
      message.success("Feature flags updated successfully.");
      setFeatureFlagsModalVisible(false);
      loadDashboardData();
    } catch (err) {
      console.error(err);
      message.error("Failed to update feature flags.");
    } finally {
      setFeatureFlagsSubmitting(false);
    }
  };

  const columns = [
    {
      title: "Organization Name",
      dataIndex: "name",
      key: "name",
      render: (val: string, record: Organization) => (
        <a onClick={(e) => { e.preventDefault(); router.push(`/platform-admin/organizations/${record.id}`); }}>{val}</a>
      ),
    },
    {
      title: "Slug",
      dataIndex: "slug",
      key: "slug",
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (val: string) => {
        let color = "default";
        if (val === "active") color = "success";
        if (val === "provisioning") color = "processing";
        if (val === "suspended") color = "warning";
        if (val === "archived") color = "error";
        return <Tag color={color}>{val.toUpperCase()}</Tag>;
      },
    },
    {
      title: "Created At",
      dataIndex: "createdAt",
      key: "createdAt",
      render: (val: string) => new Date(val).toLocaleString(),
    },
    {
      title: "Actions",
      key: "actions",
      render: (_: unknown, record: Organization) => {
        const actionMenu: MenuProps['items'] = [
          {
            key: 'manage',
            label: 'Manage Details',
            onClick: () => router.push(`/platform-admin/organizations/${record.id}`),
          },
          {
            key: 'addLoc',
            label: 'Add Location',
            icon: <EnvironmentOutlined />,
            onClick: () => {
              setSelectedOrg(record);
              setAddLocModalVisible(true);
            },
          },
          {
            key: 'flags',
            label: 'Feature Flags',
            icon: <SettingOutlined />,
            onClick: () => openFeatureFlags(record),
          },
        ];

        return (
          <Dropdown menu={{ items: actionMenu }} trigger={['click']}>
            <Button size="small" icon={<MoreOutlined />} aria-label="More actions" />
          </Dropdown>
        );
      },
    },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", paddingBottom: 64 }}>
      <PageHeader
        title="Platform Administration"
        subtitle="Manage organizations across the platform."
        actions={
          <>
            <Button icon={<ReloadOutlined />} onClick={loadDashboardData}>Refresh</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push("/provisioning/new")}>
              Provision New Organization
            </Button>
          </>
        }
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic title="Total Organizations" value={summary?.totalOrganizations || 0} loading={loading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Active" value={summary?.active || 0} styles={{ content: { color: "#3f8600" } }} loading={loading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Provisioning" value={summary?.provisioning || 0} styles={{ content: { color: "#1677ff" } }} loading={loading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Suspended/Failed" value={(summary?.suspended || 0) + (summary?.failed || 0)} styles={{ content: { color: "#cf1322" } }} loading={loading} />
          </Card>
        </Col>
      </Row>

      <Card>
        <Table
          dataSource={orgs}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* ADD LOCATION MODAL */}
      <Modal forceRender
        title={`Provision New Location for ${selectedOrg?.name || "Organization"}`}
        open={addLocModalVisible}
        onCancel={() => setAddLocModalVisible(false)}
        footer={null}
        destroyOnHidden
      >
        <Form form={addLocForm} layout="vertical" onFinish={handleAddLocationSubmit}>
          <Form.Item name="name" label="Location Name" rules={[{ required: true }]}>
            <Input placeholder="Downtown Branch" />
          </Form.Item>
          <Form.Item name="country" label="Country" initialValue="US" rules={[{ required: true }]}>
            <Input placeholder="US" />
          </Form.Item>
          <Form.Item name="timezone" label="Timezone" initialValue="America/New_York" rules={[{ required: true }]}>
            <Input placeholder="America/New_York" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="city" label="City (Optional)">
                <Input placeholder="San Francisco" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="state" label="State (Optional)">
                <Input placeholder="CA" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item style={{ textAlign: "right", marginBottom: 0 }}>
            <Space>
              <Button onClick={() => setAddLocModalVisible(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={addLocSubmitting}>
                Provision Location
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* FEATURE FLAGS MODAL */}
      <Modal forceRender
        title={`Feature Flags: ${selectedOrg?.name || "Organization"}`}
        open={featureFlagsModalVisible}
        onCancel={() => setFeatureFlagsModalVisible(false)}
        onOk={handleSaveFeatureFlags}
        confirmLoading={featureFlagsSubmitting}
        destroyOnHidden
      >
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
      </Modal>

    </div>
  );
}
