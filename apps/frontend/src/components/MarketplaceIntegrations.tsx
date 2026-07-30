"use client";

import { useCallback, useEffect, useState } from "react";
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  SyncOutlined,
  CloudSyncOutlined,
} from "@ant-design/icons";
import { api } from "@/lib/api";

const { Title, Text, Paragraph } = Typography;

interface IntegrationAccount {
  id: string;
  providerId: string;
  providerName: string;
  providerStoreId: string | null;
  locationId: string | null;
  status: string; // waiting_menu | in_progress | waiting | connected | rejected | disabled
  isOnline: boolean;
  autoAcceptOrders: boolean;
  createdAt: string;
}

interface ProviderOption {
  label: string;
  value: string;
  live: boolean;
}

const PROVIDERS: ProviderOption[] = [
  { label: "Uber Eats", value: "ubereats", live: true },
  { label: "KitchenHub", value: "kitchenhub", live: false },
  { label: "DoorDash", value: "doordash", live: false },
  { label: "Grubhub", value: "grubhub", live: false },
];

interface LocationOption {
  id: string;
  name: string;
}

interface ConnectFormValues {
  providerName: string;
  locationId: string;
  providerStoreId: string;
  clientId: string;
  clientSecret: string;
  autoAcceptOrders: boolean;
}

const STATUS_COLOR: Record<string, string> = {
  connected: "green",
  waiting: "gold",
  waiting_menu: "gold",
  in_progress: "blue",
  rejected: "red",
  disabled: "default",
};

export default function MarketplaceIntegrations() {
  const { message } = App.useApp();
  const [form] = Form.useForm<ConnectFormValues>();
  const [accounts, setAccounts] = useState<IntegrationAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<IntegrationAccount | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<IntegrationAccount[]>(
        "/aggregator/integration-accounts",
      );
      setAccounts(data ?? []);
    } catch {
      message.error("Failed to load marketplace integrations.");
    } finally {
      setLoading(false);
    }
  }, [message]);

  const loadLocations = useCallback(async () => {
    try {
      const { data } = await api.get<LocationOption[]>("/locations");
      setLocations(data ?? []);
    } catch {
      // Non-fatal: the form still renders, it just can't offer a location to pick.
      message.error("Failed to load locations.");
    }
  }, [message]);

  useEffect(() => {
    load();
    loadLocations();
  }, [load, loadLocations]);

  const openConnectModal = () => {
    setEditingAccount(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEditModal = (account: IntegrationAccount) => {
    setEditingAccount(account);
    form.setFieldsValue({
      providerName: account.providerName,
      locationId: account.locationId ?? undefined,
      providerStoreId: account.providerStoreId ?? "",
      clientId: "",
      clientSecret: "",
      autoAcceptOrders: account.autoAcceptOrders,
    });
    setModalOpen(true);
  };

  const handleSubmit = async (values: ConnectFormValues) => {
    if (editingAccount) {
      const clientId = values.clientId?.trim();
      const clientSecret = values.clientSecret?.trim();
      if (!!clientId !== !!clientSecret) {
        message.error(
          "Provide both Client ID and Client Secret to replace credentials, or leave both blank to keep the current ones.",
        );
        return;
      }
    }
    setSubmitting(true);
    try {
      if (editingAccount) {
        const clientId = values.clientId?.trim();
        const clientSecret = values.clientSecret?.trim();
        await api.patch(
          `/aggregator/integration-accounts/${editingAccount.id}`,
          {
            locationId: values.locationId,
            providerStoreId: values.providerStoreId.trim(),
            autoAcceptOrders: values.autoAcceptOrders ?? true,
            ...(clientId && clientSecret
              ? {
                  credentials: {
                    clientId,
                    clientSecret,
                    storeId: values.providerStoreId.trim(),
                  },
                }
              : {}),
          },
        );
        message.success("Marketplace updated.");
      } else {
        await api.post("/aggregator/integration-accounts", {
          providerName: values.providerName,
          locationId: values.locationId,
          providerStoreId: values.providerStoreId.trim(),
          autoAcceptOrders: values.autoAcceptOrders ?? true,
          credentials: {
            clientId: values.clientId.trim(),
            clientSecret: values.clientSecret,
            storeId: values.providerStoreId.trim(),
          },
        });
        message.success("Marketplace connected.");
      }
      setModalOpen(false);
      setEditingAccount(null);
      form.resetFields();
      await load();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response
          ?.data?.message ??
        (editingAccount
          ? "Failed to update marketplace."
          : "Failed to connect marketplace.");
      message.error(Array.isArray(msg) ? msg.join(", ") : msg);
    } finally {
      setSubmitting(false);
    }
  };

  const deleteAccount = async (account: IntegrationAccount) => {
    setDeletingId(account.id);
    try {
      await api.delete(`/aggregator/integration-accounts/${account.id}`);
      message.success("Marketplace disconnected.");
      await load();
    } catch {
      message.error("Failed to disconnect marketplace.");
    } finally {
      setDeletingId(null);
    }
  };

  const toggleAutoAccept = async (
    account: IntegrationAccount,
    autoAcceptOrders: boolean,
  ) => {
    // Optimistic — a cashier flipping this at the register shouldn't wait on a spinner.
    setAccounts((prev) =>
      prev.map((a) => (a.id === account.id ? { ...a, autoAcceptOrders } : a)),
    );
    try {
      await api.patch(`/aggregator/integration-accounts/${account.id}`, {
        autoAcceptOrders,
      });
    } catch {
      message.error("Failed to update auto-accept.");
      await load();
    }
  };

  const syncMenu = async (account: IntegrationAccount) => {
    setSyncingId(account.id);
    try {
      const { data } = await api.post<{ categories: number; items: number }>(
        `/aggregator/integration-accounts/${account.id}/menu-sync`,
      );
      message.success(
        `Menu synced: ${data.categories} categories, ${data.items} items.`,
      );
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response
          ?.data?.message ?? "Menu sync failed.";
      message.error(msg);
    } finally {
      setSyncingId(null);
    }
  };

  /**
   * Ask Uber what it actually has configured and write the answer back to the account.
   * Status/online are otherwise only ever set by inbound webhooks, so an account added
   * after the store was provisioned sits at "waiting" forever with nothing to nudge it.
   */
  const activateUber = async (account: IntegrationAccount) => {
    setActivatingId(account.id);
    try {
      const { data } = await api.post<{
        integration_enabled?: boolean;
        online_status?: string;
      }>(`/aggregator/integration-accounts/${account.id}/ubereats/enable`);
      message.success(
        data?.integration_enabled
          ? "Uber Eats integration is enabled — order webhooks are on."
          : "Uber accepted the config, but reports the integration as not enabled yet.",
      );
      await load();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Could not reach Uber Eats.";
      message.error(msg);
    } finally {
      setActivatingId(null);
    }
  };

  const providerLabel = (providerName: string) =>
    PROVIDERS.find((p) => p.value === providerName)?.label ?? providerName;

  const columns: ColumnsType<IntegrationAccount> = [
    {
      title: "Marketplace",
      dataIndex: "providerName",
      render: (v: string) => providerLabel(v),
    },
    {
      title: "Store ID",
      dataIndex: "providerStoreId",
      render: (v: string | null) => v ?? <Text type="secondary">—</Text>,
    },
    {
      title: "Status",
      dataIndex: "status",
      render: (v: string) => (
        <Tag color={STATUS_COLOR[v] ?? "default"}>{v.replace(/_/g, " ")}</Tag>
      ),
    },
    {
      title: "Online",
      dataIndex: "isOnline",
      render: (v: boolean) => (
        <Tag color={v ? "green" : "default"}>{v ? "Online" : "Offline"}</Tag>
      ),
    },
    {
      title: "Auto-accept orders",
      dataIndex: "autoAcceptOrders",
      render: (v: boolean, r) => (
        <Switch
          size="small"
          checked={v}
          onChange={(checked) => toggleAutoAccept(r, checked)}
          aria-label="Toggle auto-accept orders"
        />
      ),
    },
    {
      title: "",
      key: "actions",
      align: "right",
      render: (_, r) => (
        <Space>
          {r.providerName === "ubereats" && (
            <Button
              size="small"
              icon={<CloudSyncOutlined />}
              onClick={() => activateUber(r)}
              loading={activatingId === r.id}
            >
              {r.status === "connected" ? "Re-check" : "Activate"}
            </Button>
          )}
          <Button
            size="small"
            icon={<SyncOutlined spin={syncingId === r.id} />}
            onClick={() => syncMenu(r)}
            loading={syncingId === r.id}
          >
            Sync menu
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditModal(r)}
            aria-label={`Edit ${providerLabel(r.providerName)} credentials`}
          />
          <Popconfirm
            title="Disconnect this marketplace?"
            description="Its orders will stop syncing. Past order history is kept."
            okText="Disconnect"
            okButtonProps={{ danger: true }}
            onConfirm={() => deleteAccount(r)}
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={deletingId === r.id}
              aria-label={`Disconnect ${providerLabel(r.providerName)}`}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Marketplace Integrations
          </Title>
          <Text type="secondary">
            Connect delivery marketplaces so their orders flow straight into the
            register. Auto-accept can also be flipped from the POS Settings screen.
          </Text>
        </div>
        <Button type="primary" icon={<LinkOutlined />} onClick={openConnectModal}>
          Connect Marketplace
        </Button>
      </div>

      <Table
        dataSource={accounts}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={false}
        aria-label="Marketplace integrations"
      />

      <Modal
        title={editingAccount ? `Edit ${providerLabel(editingAccount.providerName)}` : "Connect Marketplace"}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setEditingAccount(null);
        }}
        footer={null}
        destroyOnHidden
      >
        <Paragraph type="secondary" style={{ marginTop: -8 }}>
          Uber Eats: use the store id from your Uber developer dashboard, and the
          Client ID / Client Secret from the app credentials. The client secret is also
          your webhook{" "}
          <Text code style={{ fontSize: 12 }}>
            Signing Key
          </Text>
          — enter the same value in both places.
        </Paragraph>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{ providerName: "ubereats", autoAcceptOrders: true }}
        >
          <Form.Item
            name="providerName"
            label="Marketplace"
            rules={[{ required: true }]}
          >
            <Select
              disabled={!!editingAccount}
              options={PROVIDERS.map((p) => ({
                label: p.live ? p.label : `${p.label} (coming soon)`,
                value: p.value,
                disabled: !p.live,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="locationId"
            label="Location"
            extra="Orders from this store are filed against this location — it drives kitchen print routing and location reporting."
            rules={[{ required: true, message: "Pick the location this store maps to." }]}
          >
            <Select
              placeholder="Select a location"
              loading={locations.length === 0}
              options={locations.map((l) => ({ label: l.name, value: l.id }))}
            />
          </Form.Item>
          <Form.Item
            name="providerStoreId"
            label="Store ID"
            rules={[{ required: true, message: "Store ID is required" }]}
          >
            <Input placeholder="Uber Eats store UUID" />
          </Form.Item>
          <Form.Item
            name="clientId"
            label="Client ID"
            rules={[
              {
                required: !editingAccount,
                message: "Client ID is required",
              },
            ]}
            extra={editingAccount ? "Leave blank to keep the current credentials." : undefined}
          >
            <Input placeholder="From the Uber developer dashboard" />
          </Form.Item>
          <Form.Item
            name="clientSecret"
            label="Client Secret"
            rules={[
              {
                required: !editingAccount,
                message: "Client Secret is required",
              },
            ]}
            extra={
              editingAccount
                ? "Leave blank to keep the current credentials. Providing one replaces both fields."
                : "Encrypted at rest. Never shown again after saving."
            }
          >
            <Input.Password placeholder="Client secret / signing key" />
          </Form.Item>
          <Form.Item
            name="autoAcceptOrders"
            label="Auto-accept orders"
            valuePropName="checked"
            extra="When off, orders land pending for manual accept from the POS or dashboard."
          >
            <Switch />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Space>
              <Button
                onClick={() => {
                  setModalOpen(false);
                  setEditingAccount(null);
                }}
              >
                Cancel
              </Button>
              <Button type="primary" htmlType="submit" loading={submitting}>
                {editingAccount ? "Save changes" : "Connect"}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
