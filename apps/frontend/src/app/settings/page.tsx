"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Typography,
  Card,
  Tabs,
  Form,
  Input,
  Button,
  Table,
  Modal,
  Space,
  Tag,
  App,
  theme,
  Select,
  Popconfirm,
  Alert,
  Divider,
  Upload,
  Radio,
} from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, CopyOutlined, KeyOutlined, ApiOutlined, GlobalOutlined, BankOutlined, SecurityScanOutlined, BuildOutlined, CreditCardOutlined, NotificationOutlined, SettingOutlined, MailOutlined, UserAddOutlined, MinusCircleOutlined, LinkOutlined, SyncOutlined, ReloadOutlined } from "@ant-design/icons";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { useLocation, Location } from "@/contexts/LocationContext";
import dayjs from "dayjs";

const { Title, Text } = Typography;
const { Option } = Select;

// -- Types --
interface Organization {
  id: string;
  name: string;
  status: string;
  slug: string;
  createdAt: string;
}

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
}

interface OrgWebhook {
  id: string;
  url: string;
  active: boolean;
  events: string[];
  createdAt: string;
}

const WEBHOOK_EVENTS = [
  "order.created",
  "order.updated",
  "order.cancelled",
  "call.completed",
];

export default function SettingsHubPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const { locations, refreshLocations, loading: locLoading, selectedLocation: globalSelectedLocation, setSelectedLocationId } = useLocation();

  const [activeTab, setActiveTab] = useState("organization");

  // Data states
  const [org, setOrg] = useState<Organization | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<OrgWebhook[]>([]);
  const [devDataLoading, setDevDataLoading] = useState(false);

  // Profile forms
  const [profileForm] = Form.useForm();
  const [profileSaving, setProfileSaving] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);


  // Modal states (Locations)
  const [locModalOpen, setLocModalOpen] = useState(false);
  const [locModalMode, setLocModalMode] = useState<"add" | "edit">("add");
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [locForm] = Form.useForm();
  const [locSubmitting, setLocSubmitting] = useState(false);

  // Modal states (API Keys)
  const [apiKeyModalVisible, setApiKeyModalVisible] = useState(false);
  const [apiKeySubmitting, setApiKeySubmitting] = useState(false);
  const [apiKeyForm] = Form.useForm();
  const [newlyGeneratedKey, setNewlyGeneratedKey] = useState<string | null>(null);

  // Modal states (Assign Manager)
  const [assignManagerModalVisible, setAssignManagerModalVisible] = useState(false);
  const [assignManagerLocation, setAssignManagerLocation] = useState<Location | null>(null);
  const [assignManagerSubmitting, setAssignManagerSubmitting] = useState(false);
  const [assignManagerForm] = Form.useForm();

  // Modal states (Webhooks)
  const [webhookModalVisible, setWebhookModalVisible] = useState(false);
  const [webhookSubmitting, setWebhookSubmitting] = useState(false);
  const [webhookForm] = Form.useForm();

  const fetchOrg = useCallback(async () => {
    try {
      setOrgLoading(true);
      const { data } = await api.get<Organization>("/organizations");
      setOrg(data);
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
  }, [message, profileForm]);

  const loadDevData = useCallback(async () => {
    try {
      setDevDataLoading(true);
      const [keysRes, webhooksRes] = await Promise.all([
        api.get<ApiKey[]>("/api-keys"),
        api.get<OrgWebhook[]>("/webhooks/endpoints"),
      ]);
      setApiKeys((keysRes.data as any).data || keysRes.data || []);
      setWebhooks(Array.isArray(webhooksRes.data) ? webhooksRes.data : (webhooksRes.data as any).data || []);
    } catch (err) {
      console.error(err);
      message.error("Failed to load developer settings data.");
    } finally {
      setDevDataLoading(false);
    }
  }, [message]);

  useEffect(() => {
    const storedToken = localStorage.getItem("access_token");
    let isPA = false;
    if (storedToken) {
      try {
        const payload = storedToken.split(".")[1];
        const decoded = JSON.parse(window.atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
        const r = decoded.role?.toLowerCase() || "";
        isPA = decoded.r === "sysadmin" || r === "platform_admin";
        setIsPlatformAdmin(isPA);
      } catch {}
    }

    const orgId = localStorage.getItem("selectedOrgId");
    // If platform admin and no org selected, don't fetch org settings
    if (isPA && (!orgId || orgId === "undefined" || orgId === "null")) {
      setOrgLoading(false);
      return;
    }

    fetchOrg();
  }, [fetchOrg]);

  useEffect(() => {
    if (activeTab === "api-keys" || activeTab === "webhooks") {
      const orgId = localStorage.getItem("selectedOrgId");
      if (isPlatformAdmin && (!orgId || orgId === "undefined" || orgId === "null")) {
        return;
      }
      loadDevData();
    }
  }, [activeTab, loadDevData, isPlatformAdmin]);

  // -- Organization Handlers --
  const handleSaveProfile = async (values: any) => {
    try {
      setProfileSaving(true);
      await api.patch(`/organizations`, values);
      message.success("Organization profile updated");
      fetchOrg();
    } catch (err) {
      message.error("Failed to update organization");
    } finally {
      setProfileSaving(false);
    }
  };

  // -- Location Handlers --
  const openLocModal = (mode: "add" | "edit", loc?: Location) => {
    setLocModalMode(mode);
    if (mode === "edit" && loc) {
      setSelectedLocation(loc);
      const aiSettings = loc.aiSettings || {};
      const dynVars = aiSettings.dynamicVariables || {};
      const dynamicVariables = Object.entries(dynVars).map(([key, value]) => ({ key, value }));
      locForm.setFieldsValue({ ...loc, dynamicVariables });
    } else {
      setSelectedLocation(null);
      locForm.resetFields();
    }
    setLocModalOpen(true);
  };

  const handleLocSubmit = async (values: any) => {
    try {
      setLocSubmitting(true);
      const dynamicVarsArr = values.dynamicVariables || [];
      const dynamicVariables: Record<string, string> = {};
      dynamicVarsArr.forEach((dv: any) => {
        if (dv && dv.key) {
          dynamicVariables[dv.key] = dv.value || "";
        }
      });

      // Separate ai-config payload
      delete values.dynamicVariables;

      if (locModalMode === "add") {
        const res = await api.post<{ id: string }>("/locations", values);
        if (Object.keys(dynamicVariables).length > 0) {
          await api.patch(`/locations/${res.data.id}/ai-config`, { aiSettings: { dynamicVariables } });
        }
        message.success("Location added");
      } else if (selectedLocation) {
        await api.patch(`/locations/${selectedLocation.id}`, values);
        if (Object.keys(dynamicVariables).length > 0) {
          await api.patch(`/locations/${selectedLocation.id}/ai-config`, { aiSettings: { dynamicVariables } });
        }
        message.success("Location updated");
      }
      setLocModalOpen(false);
      refreshLocations();
    } catch (err) {
      message.error("Failed to save location");
    } finally {
      setLocSubmitting(false);
    }
  };

  const handleDeleteLocation = async (id: string) => {
    try {
      await api.delete(`/locations/${id}`);
      message.success("Location deleted successfully");
      refreshLocations();
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { message?: string | string[] } } };
      const msg = errorResponse.response?.data?.message || "Failed to delete location";
      message.error(Array.isArray(msg) ? msg.join(", ") : msg);
    }
  };

  const openAssignManager = (loc: Location) => {
    setAssignManagerLocation(loc);
    assignManagerForm.resetFields();
    setAssignManagerModalVisible(true);
  };

  const handleAssignManagerSubmit = async (values: { email: string }) => {
    if (!assignManagerLocation) return;
    try {
      setAssignManagerSubmitting(true);
      await api.post(`/locations/${assignManagerLocation.id}/assign-manager`, { email: values.email });
      message.success("Manager assigned/invited successfully!");
      setAssignManagerModalVisible(false);
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { message?: string | string[] } } };
      const msg = errorResponse.response?.data?.message || "Failed to assign manager";
      message.error(Array.isArray(msg) ? msg.join(", ") : msg);
    } finally {
      setAssignManagerSubmitting(false);
    }
  };

  // -- API Key Handlers --
  const handleCreateApiKey = async (values: any) => {
    try {
      setApiKeySubmitting(true);
      const res = await api.post<{ apiKey: string }>("/api-keys", values);
      apiKeyForm.resetFields();
      setNewlyGeneratedKey(res.data.apiKey);
      loadDevData();
    } catch (err) {
      message.error("Failed to create API key");
    } finally {
      setApiKeySubmitting(false);
    }
  };

  const handleDeleteApiKey = async (id: string) => {
    try {
      await api.delete(`/api-keys/${id}`);
      message.success("API key deleted");
      loadDevData();
    } catch (err) {
      message.error("Failed to delete API key");
    }
  };

  // -- Webhook Handlers --
  const handleCreateWebhook = async (values: any) => {
    try {
      setWebhookSubmitting(true);
      await api.post("/webhooks/endpoints", values);
      message.success("Webhook endpoint created");
      setWebhookModalVisible(false);
      webhookForm.resetFields();
      loadDevData();
    } catch (err) {
      message.error("Failed to create webhook");
    } finally {
      setWebhookSubmitting(false);
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    try {
      await api.delete(`/webhooks/endpoints/${id}`);
      message.success("Webhook deleted");
      loadDevData();
    } catch (err) {
      message.error("Failed to delete webhook");
    }
  };

  const locColumns = [
    { title: "Name", dataIndex: "name", key: "name", render: (text: string) => <Text strong>{text}</Text> },
    { title: "Address", dataIndex: "address", key: "address" },
    { title: "City", dataIndex: "city", key: "city" },
    { title: "State", dataIndex: "state", key: "state" },
    { title: "Timezone", dataIndex: "timezone", key: "timezone" },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (s: string) => (
        <Tag color={s === "active" ? "green" : "default"}>{s.toUpperCase()}</Tag>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      render: (_: any, record: Location) => (
        <Space>
          <Button size="small" icon={<UserAddOutlined />} onClick={() => openAssignManager(record)}>
            Assign Manager
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openLocModal("edit", record)}>
            Edit
          </Button>
          <Popconfirm title="Delete this location?" onConfirm={() => handleDeleteLocation(record.id)} okText="Yes" cancelText="No">
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const keyColumns = [
    { title: "Name", dataIndex: "name", key: "name" },
    { title: "Prefix", dataIndex: "prefix", key: "prefix", render: (text: string) => <Tag color="blue">{text}</Tag> },
    { title: "Created", dataIndex: "createdAt", key: "createdAt", render: (text: string) => dayjs(text).format("MMM D, YYYY") },
    { title: "Last Used", dataIndex: "lastUsedAt", key: "lastUsedAt", render: (text: string) => (text ? dayjs(text).format("MMM D, YYYY") : "Never") },
    {
      title: "Actions",
      key: "actions",
      render: (_: any, record: ApiKey) => (
        <Popconfirm title="Delete API key?" onConfirm={() => handleDeleteApiKey(record.id)} okText="Yes" cancelText="No">
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  const webhookColumns = [
    { title: "URL", dataIndex: "url", key: "url" },
    {
      title: "Events",
      dataIndex: "events",
      key: "events",
      render: (events: string[]) => (
        <>
          {events.map((e) => (
            <Tag key={e} style={{ marginBottom: 4 }}>{e}</Tag>
          ))}
        </>
      ),
    },
    {
      title: "Status",
      dataIndex: "active",
      key: "active",
      render: (active: boolean) => <Tag color={active ? "green" : "red"}>{active ? "Active" : "Disabled"}</Tag>,
    },
    {
      title: "Actions",
      key: "actions",
      render: (_: any, record: OrgWebhook) => (
        <Popconfirm title="Delete Webhook?" onConfirm={() => handleDeleteWebhook(record.id)} okText="Yes" cancelText="No">
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  const tabItems = [
    {
      key: "organization",
      label: <span><BankOutlined /> Organization</span>,
      children: (
        <div style={{ maxWidth: 600 }}>
          <Title level={4}>Organization Profile</Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>Manage your organization's core details.</Text>
          <Form form={profileForm} layout="vertical" onFinish={handleSaveProfile} disabled={orgLoading}>
            <Form.Item label="Organization Name" name="name" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item label="Slug (Internal URL)" name="slug" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={profileSaving}>
                Save Changes
              </Button>
            </Form.Item>
          </Form>
        </div>
      ),
    },
    {
      key: "locations",
      label: <span><GlobalOutlined /> Locations</span>,
      children: (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <Title level={4} style={{ margin: 0 }}>Locations</Title>
              <Text type="secondary">Manage your physical business locations and branches.</Text>
            </div>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openLocModal("add")}>
              Add Location
            </Button>
          </div>
          <Table dataSource={locations} columns={locColumns} rowKey="id" loading={locLoading} />
        </div>
      ),
    },
    {
      key: "menu-link",
      label: <span><LinkOutlined /> Menu Link</span>,
      children: (
        <div style={{ maxWidth: 600 }}>
          <Title level={4}>Menu Sync Settings</Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
            Manage the menu import source for the currently selected location.
          </Text>
          {!globalSelectedLocation && locations.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <Select
                placeholder="Select a location to configure"
                style={{ width: '100%' }}
                options={locations.map((loc: Location) => ({ label: loc.name, value: loc.id }))}
                onSelect={(val) => {
                  setSelectedLocationId(val);
                }}
              />
            </div>
          )}
          {globalSelectedLocation ? (
            <Card variant="borderless" size="small">
              <Form layout="vertical" onFinish={async (values) => {
                try {
                  setProfileSaving(true);
                  await api.patch(`/locations/${globalSelectedLocation.id}`, { menuImportSource: values.menuImportSource });
                  message.success("Menu import source updated successfully.");
                  refreshLocations();
                } catch (e) {
                  message.error("Failed to update menu import source.");
                } finally {
                  setProfileSaving(false);
                }
              }} initialValues={{ menuImportSource: (globalSelectedLocation as any).menuImportSource }}>
                <Form.Item
                  label="Menu Source URL or PDF Link"
                  name="menuImportSource"
                  extra="Enter the website URL to import the menu from, or upload a PDF below."
                >
                  <Input placeholder="https://example.com/menu" />
                </Form.Item>
                <div style={{ marginBottom: 24 }}>
                  <Upload
                    name="file"
                    action={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1'}/menus/import/upload-pdf`}
                    headers={{ Authorization: `Bearer ${localStorage.getItem('access_token')}` }}
                    showUploadList={false}
                    onChange={(info) => {
                      if (info.file.status === 'done') {
                        message.success(`${info.file.name} file uploaded successfully`);
                        const url = info.file.response.url;
                        api.patch(`/locations/${globalSelectedLocation.id}`, { menuImportSource: url }).then(() => {
                           refreshLocations();
                           message.success("Menu import source updated to PDF successfully.");
                        });
                      } else if (info.file.status === 'error') {
                        message.error(`${info.file.name} file upload failed.`);
                      }
                    }}
                  >
                    <Button icon={<PlusOutlined />}>Upload PDF instead</Button>
                  </Upload>
                </div>
                <Form.Item>
                  <Button type="primary" htmlType="submit" loading={profileSaving}>
                    Save Source URL
                  </Button>
                </Form.Item>
              </Form>

              <Divider />

              <Title level={5}>Sync Menu</Title>
              <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                Select how you want to synchronize your menu items using the configured Menu Link above.
              </Text>
              
              <Form layout="vertical" onFinish={async (values) => {
                try {
                  message.loading({ content: 'Starting sync...', key: 'syncing' });
                  await api.post("/menus/import", {
                    locationId: globalSelectedLocation.id,
                    importMode: values.importMode,
                  });
                  message.success({ content: "Menu sync started in the background.", key: 'syncing' });
                } catch (e: any) {
                  message.error({ content: e.response?.data?.message || "Failed to start menu sync.", key: 'syncing' });
                }
              }} initialValues={{ importMode: 'sync' }}>
                <Form.Item 
                  name="importMode" 
                  label="Import Mode" 
                  rules={[{ required: true }]}
                >
                  <Radio.Group style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Radio value="add_new">
                      <Text strong>Add New Items Only</Text>
                      <div style={{ paddingLeft: 24, fontSize: 12, color: '#666' }}>Skips existing items and only adds net-new items.</div>
                    </Radio>
                    <Radio value="sync">
                      <Text strong>Sync Menu (Default)</Text>
                      <div style={{ paddingLeft: 24, fontSize: 12, color: '#666' }}>Updates pricing and descriptions of existing items, and adds new items.</div>
                    </Radio>
                    <Radio value="replace">
                      <Text strong>Replace Everything</Text>
                      <div style={{ paddingLeft: 24, fontSize: 12, color: '#666' }}>Deletes all existing items and imports the new menu fresh.</div>
                    </Radio>
                  </Radio.Group>
                </Form.Item>
                <Form.Item>
                  <Button type="primary" htmlType="submit" icon={<SyncOutlined />}>
                    Start Sync
                  </Button>
                </Form.Item>
              </Form>

              <Divider />

              <Title level={5}>Cache</Title>
              <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                If the menu page is showing stale data after a sync, you can manually clear the server-side cache.
              </Text>
              <Popconfirm
                title="Clear menu cache?"
                description="This will force a fresh fetch from the database for all users in your organization."
                onConfirm={async () => {
                  try {
                    await api.post('/menus/cache/clear');
                    message.success('Menu cache cleared successfully.');
                  } catch (e: any) {
                    message.error(e.response?.data?.message || 'Failed to clear cache.');
                  }
                }}
                okText="Clear"
                cancelText="Cancel"
              >
                <Button danger icon={<ReloadOutlined />}>
                  Clear Menu Cache
                </Button>
              </Popconfirm>
            </Card>
          ) : (
            <Alert title="Please select a location from the navigation bar to manage its menu link." type="info" showIcon />
          )}
        </div>
      ),
    },
    {
      key: "api-keys",
      label: <span><KeyOutlined /> API Keys</span>,
      children: (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <Title level={4} style={{ margin: 0 }}>API Keys</Title>
              <Text type="secondary">Generate keys to authenticate your backend applications.</Text>
            </div>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setNewlyGeneratedKey(null); setApiKeyModalVisible(true); }}>
              Create API Key
            </Button>
          </div>
          <Table dataSource={apiKeys} columns={keyColumns} rowKey="id" loading={devDataLoading} />
        </div>
      ),
    },
    {
      key: "webhooks",
      label: <span><ApiOutlined /> Webhooks</span>,
      children: (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <Title level={4} style={{ margin: 0 }}>Webhooks</Title>
              <Text type="secondary">Listen to real-time events via HTTP callbacks.</Text>
            </div>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setWebhookModalVisible(true)}>
              Add Endpoint
            </Button>
          </div>
          <Table dataSource={webhooks} columns={webhookColumns} rowKey="id" loading={devDataLoading} />
        </div>
      ),
    },
    {
      key: "billing",
      label: <span><CreditCardOutlined /> Billing</span>,
      children: (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Title level={4}>Billing & Subscriptions</Title>
          <Text type="secondary">Manage your active plans, usage, and payment methods. (Coming soon)</Text>
        </div>
      ),
    },
    {
      key: "smtp",
      label: <span><MailOutlined /> SMTP Settings</span>,
      children: (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Title level={4}>SMTP Configuration</Title>
          <Text type="secondary">Configure custom email server settings for outgoing messages. (Coming soon)</Text>
        </div>
      ),
    },
    {
      key: "templates",
      label: <span><BuildOutlined /> Email Templates</span>,
      children: (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Title level={4}>Email Templates</Title>
          <Text type="secondary">Customize the content and branding of emails sent to customers. (Coming soon)</Text>
        </div>
      ),
    },
    {
      key: "auth",
      label: <span><SecurityScanOutlined /> Authentication</span>,
      children: (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Title level={4}>Auth & Security Settings</Title>
          <Text type="secondary">Manage SSO, 2FA, session timeouts, and IP restrictions. (Coming soon)</Text>
        </div>
      ),
    },
    {
      key: "features",
      label: <span><SettingOutlined /> Feature Flags</span>,
      children: (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Title level={4}>Feature Flags</Title>
          <Text type="secondary">Toggle early-access and experimental features. (Admin only)</Text>
        </div>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <PageHeader
        title="Settings Hub"
        subtitle="Manage your organization's configuration and developer tools."
      />

      <Card styles={{ body: { padding: 0 } }}>
        <Tabs
          tabPlacement="start"
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabItems}
          style={{ minHeight: 600 }}
          tabBarStyle={{ width: 220, padding: '24px 0' }}
        />
      </Card>

      {/* Location Modal */}
      <Modal forceRender
        title={locModalMode === "add" ? "Add Location" : "Edit Location"}
        open={locModalOpen}
        onCancel={() => setLocModalOpen(false)}
        footer={null}
      >
        <Form form={locForm} layout="vertical" onFinish={handleLocSubmit}>
          <Form.Item name="name" label="Location Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="address" label="Address"><Input /></Form.Item>
          <Form.Item name="city" label="City"><Input /></Form.Item>
          <Form.Item name="state" label="State"><Input /></Form.Item>
          <Form.Item name="country" label="Country"><Input /></Form.Item>
          <Form.Item name="timezone" label="Timezone"><Input placeholder="e.g. America/New_York" /></Form.Item>
          
          <Divider>AI Agent Config</Divider>
          <Form.List name="dynamicVariables">
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 8 }}><Text type="secondary">Dynamic Variables for AI Agent (e.g. key: 'price', value: '10')</Text></div>
                {fields.map(({ key, name, ...restField }) => (
                  <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                    <Form.Item
                      {...restField}
                      name={[name, 'key']}
                      rules={[{ required: true, message: 'Missing key' }]}
                    >
                      <Input placeholder="Variable Key" />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'value']}
                    >
                      <Input placeholder="Variable Value (Optional)" />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#ff4d4f' }} />
                  </Space>
                ))}
                <Form.Item>
                  <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                    Add Dynamic Variable
                  </Button>
                </Form.Item>
              </>
            )}
          </Form.List>

          <Form.Item style={{ textAlign: "right", marginTop: 24, marginBottom: 0 }}>
            <Space>
              <Button onClick={() => setLocModalOpen(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={locSubmitting}>Save</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Assign Manager Modal */}
      <Modal forceRender
        title="Assign Manager to Location"
        open={assignManagerModalVisible}
        onCancel={() => setAssignManagerModalVisible(false)}
        footer={null}
      >
        <Form form={assignManagerForm} layout="vertical" onFinish={handleAssignManagerSubmit}>
          <Form.Item name="email" label="Manager Email Address" rules={[{ required: true, type: "email", message: "Please enter a valid email" }]}>
            <Input placeholder="manager@example.com" />
          </Form.Item>
          <Alert title="If the user doesn't exist, they will receive an email invitation to join this location as a Manager." type="info" showIcon style={{ marginBottom: 24 }} />
          <Form.Item style={{ textAlign: "right", marginBottom: 0 }}>
            <Space>
              <Button onClick={() => setAssignManagerModalVisible(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={assignManagerSubmitting}>Assign</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* API Key Modal */}
      <Modal forceRender
        title="Create Developer API Key"
        open={apiKeyModalVisible}
        onCancel={() => { setApiKeyModalVisible(false); setNewlyGeneratedKey(null); }}
        footer={null}
      >
        {newlyGeneratedKey && (
          <Alert
            type="success"
            title="API Key Created"
            description={
              <div>
                <Text>Please copy your new API key now. You won't be able to see it again!</Text>
                <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                  <Input value={newlyGeneratedKey} readOnly />
                  <Button
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText(newlyGeneratedKey);
                      message.success("Copied to clipboard!");
                    }}
                  />
                </div>
              </div>
            }
            showIcon
          />
        )}
        
        <Form form={apiKeyForm} layout="vertical" onFinish={handleCreateApiKey} style={{ display: newlyGeneratedKey ? 'none' : 'block' }}>
            <Form.Item name="name" label="Key Name" rules={[{ required: true }]}><Input placeholder="e.g. Production Backend" /></Form.Item>
            <Form.Item style={{ textAlign: "right", marginTop: 24, marginBottom: 0 }}>
              <Space>
                <Button onClick={() => setApiKeyModalVisible(false)}>Cancel</Button>
                <Button type="primary" htmlType="submit" loading={apiKeySubmitting}>Generate Key</Button>
              </Space>
            </Form.Item>
          </Form>
      </Modal>

      {/* Webhook Modal */}
      <Modal forceRender
        title="Add Webhook Endpoint"
        open={webhookModalVisible}
        onCancel={() => setWebhookModalVisible(false)}
        footer={null}
      >
        <Form form={webhookForm} layout="vertical" onFinish={handleCreateWebhook}>
          <Form.Item name="url" label="Endpoint URL" rules={[{ required: true, type: "url" }]}><Input placeholder="https://api.example.com/webhook" /></Form.Item>
          <Form.Item name="events" label="Events to listen for" rules={[{ required: true }]}>
            <Select mode="multiple" placeholder="Select events">
              {WEBHOOK_EVENTS.map((e) => (<Option key={e} value={e}>{e}</Option>))}
            </Select>
          </Form.Item>
          <Form.Item style={{ textAlign: "right", marginTop: 24, marginBottom: 0 }}>
            <Space>
              <Button onClick={() => setWebhookModalVisible(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={webhookSubmitting}>Create Endpoint</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
