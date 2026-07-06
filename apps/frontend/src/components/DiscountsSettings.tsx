"use client";

import { useCallback, useEffect, useState } from "react";
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { api } from "@/lib/api";

const { Title, Text } = Typography;

interface Discount {
  id: string;
  name: string;
  code?: string | null;
  type: string; // 'percent' | 'fixed'
  value: number; // percent (10 = 10%) or cents
  requiresManager: boolean;
  active: boolean;
}

interface DiscountFormValues {
  name: string;
  code?: string;
  type: "percent" | "fixed";
  value: number; // percent or dollars (converted to cents on submit)
  requiresManager?: boolean;
}

export default function DiscountsSettings() {
  const { message } = App.useApp();
  const [form] = Form.useForm<DiscountFormValues>();
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formType, setFormType] = useState<"percent" | "fixed">("percent");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<Discount[]>("/discounts?all=true");
      setDiscounts(data ?? []);
    } catch {
      message.error("Failed to load discounts.");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Discount[]>("/discounts?all=true")
      .then(({ data }) => {
        if (!cancelled) setDiscounts(data ?? []);
      })
      .catch(() => {
        if (!cancelled) message.error("Failed to load discounts.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [message]);

  const handleCreate = async (values: DiscountFormValues) => {
    setSubmitting(true);
    try {
      await api.post("/discounts", {
        name: values.name,
        code: values.code?.trim() || undefined,
        type: values.type,
        value:
          values.type === "percent"
            ? Math.round(values.value)
            : Math.round(values.value * 100),
        requiresManager: values.requiresManager ?? false,
      });
      message.success("Discount created.");
      setModalOpen(false);
      form.resetFields();
      await load();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Failed to create discount.";
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (d: Discount, active: boolean) => {
    try {
      await api.patch(`/discounts/${d.id}`, { active });
      await load();
    } catch {
      message.error("Failed to update discount.");
    }
  };

  const remove = async (d: Discount) => {
    try {
      await api.delete(`/discounts/${d.id}`);
      message.success("Discount deleted.");
      await load();
    } catch {
      message.error("Failed to delete discount.");
    }
  };

  const columns: ColumnsType<Discount> = [
    {
      title: "Name",
      dataIndex: "name",
      render: (v: string, r) => (
        <Space>
          <Text strong>{v}</Text>
          {r.requiresManager && <Tag color="orange">manager</Tag>}
        </Space>
      ),
    },
    {
      title: "Code",
      dataIndex: "code",
      render: (v: string | null) => (v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text>),
    },
    {
      title: "Amount",
      dataIndex: "value",
      render: (v: number, r) =>
        r.type === "percent" ? `${v}% off` : `$${(v / 100).toFixed(2)} off`,
    },
    {
      title: "Active",
      dataIndex: "active",
      render: (v: boolean, r) => (
        <Switch
          size="small"
          checked={v}
          onChange={(checked) => toggleActive(r, checked)}
          aria-label={`Toggle ${r.name}`}
        />
      ),
    },
    {
      title: "",
      key: "actions",
      align: "right",
      render: (_, r) => (
        <Popconfirm
          title={`Delete "${r.name}"?`}
          onConfirm={() => remove(r)}
          okText="Delete"
          okButtonProps={{ danger: true }}
        >
          <Button
            size="small"
            type="text"
            danger
            icon={<DeleteOutlined />}
            aria-label={`Delete ${r.name}`}
          />
        </Popconfirm>
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
            Discounts & Promo Codes
          </Title>
          <Text type="secondary">
            Shown on the POS tender screen. Manager-tagged discounts can only be
            applied by managers and admins.
          </Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModalOpen(true)}
        >
          Add Discount
        </Button>
      </div>

      <Table
        dataSource={discounts}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={false}
        aria-label="Discounts"
      />

      <Modal
        title="Add Discount"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreate}
          initialValues={{ type: "percent", requiresManager: false }}
        >
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: "Name is required" }]}
          >
            <Input placeholder="e.g. Lunch Special, Employee Meal" />
          </Form.Item>
          <Form.Item
            name="code"
            label="Promo Code (optional)"
            extra="Leave blank for a button-only discount."
          >
            <Input placeholder="e.g. LUNCH10" style={{ textTransform: "uppercase" }} />
          </Form.Item>
          <Form.Item name="type" label="Type">
            <Segmented
              options={[
                { label: "Percent off", value: "percent" },
                { label: "Fixed amount off", value: "fixed" },
              ]}
              onChange={(v) => setFormType(v as "percent" | "fixed")}
            />
          </Form.Item>
          <Form.Item
            name="value"
            label={formType === "percent" ? "Percent (%)" : "Amount ($)"}
            rules={[{ required: true, message: "Value is required" }]}
          >
            <InputNumber
              min={0}
              max={formType === "percent" ? 100 : 10000}
              step={formType === "percent" ? 1 : 0.5}
              precision={formType === "percent" ? 0 : 2}
              style={{ width: 160 }}
            />
          </Form.Item>
          <Form.Item
            name="requiresManager"
            label="Requires manager"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item style={{ textAlign: "right", marginBottom: 0 }}>
            <Space>
              <Button onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={submitting}>
                Create
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
