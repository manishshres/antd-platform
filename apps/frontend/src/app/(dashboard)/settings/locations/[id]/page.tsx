"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  Form,
  Input,
  InputNumber,
  Button,
  Space,
  Divider,
  Breadcrumb,
  Typography,
  Skeleton,
  App,
  theme,
} from "antd";
import {
  ArrowLeftOutlined,
  SaveOutlined,
  PlusOutlined,
  MinusCircleOutlined,
} from "@ant-design/icons";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { ErrorState } from "@/components/PageStates";
import { useLocation } from "@/contexts/LocationContext";

const { Text } = Typography;

export default function EditLocationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const { locations, loading: locLoading, refreshLocations } = useLocation();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const location = useMemo(
    () => locations.find((l) => l.id === id) ?? null,
    [locations, id],
  );

  useEffect(() => {
    if (location) {
      const dynVars = location.aiSettings?.dynamicVariables ?? {};
      form.setFieldsValue({
        name: location.name,
        address: location.address,
        city: location.city,
        state: location.state,
        country: location.country,
        timezone: location.timezone,
        taxRatePercent: (location.taxRateBps ?? 0) / 100,
        menuBucket: location.aiSettings?.menuBucket ?? "",
        dynamicVariables: Object.entries(dynVars).map(([key, value]) => ({
          key,
          value,
        })),
      });
    }
  }, [location, form]);

  const handleSubmit = async (values: Record<string, unknown>) => {
    setSaving(true);
    try {
      const dynamicVarsArr =
        (values.dynamicVariables as { key: string; value?: string }[]) || [];
      const dynamicVariables: Record<string, string> = {};
      for (const dv of dynamicVarsArr) {
        if (dv && dv.key) dynamicVariables[dv.key] = dv.value || "";
      }
      const menuBucket = ((values.menuBucket as string) || "").trim();
      const {
        dynamicVariables: _omitVars,
        menuBucket: _omitBucket,
        taxRatePercent,
        ...locationFields
      } = values;
      void _omitVars;
      void _omitBucket;
      // Stored in basis points server-side (8.25% → 825).
      (locationFields as Record<string, unknown>).taxRateBps = Math.round(
        Number(taxRatePercent ?? 0) * 100,
      );

      await api.patch(`/locations/${id}`, locationFields);

      // aiSettings is merged server-side, so only send the AI keys this form owns.
      const aiSettings: Record<string, unknown> = { dynamicVariables };
      if (menuBucket) aiSettings.menuBucket = menuBucket;
      if (Object.keys(dynamicVariables).length > 0 || menuBucket) {
        await api.patch(`/locations/${id}/ai-config`, { aiSettings });
      }
      message.success("Location updated");
      await refreshLocations();
      router.push("/settings");
    } catch {
      message.error("Failed to save location");
    } finally {
      setSaving(false);
    }
  };

  // Still loading the locations list.
  if (locLoading && !location) {
    return (
      <div>
        <Skeleton active paragraph={{ rows: 1 }} title={{ width: 240 }} style={{ marginBottom: 24 }} />
        <Card>
          <Skeleton active paragraph={{ rows: 8 }} />
        </Card>
      </div>
    );
  }

  if (!location) {
    return (
      <ErrorState
        message="Location not found."
        onRetry={() => router.push("/settings")}
      />
    );
  }

  return (
    <div>
      <PageHeader
        overline={
          <Breadcrumb
            items={[
              { title: <a onClick={() => router.push("/settings")}>Settings</a> },
              { title: "Locations" },
              { title: location.name },
            ]}
          />
        }
        title={
          <Space size={8}>
            <Button size="small" icon={<ArrowLeftOutlined />} aria-label='Back to settings' onClick={() => router.push("/settings")} />
            Edit Location
          </Space>
        }
        subtitle={location.name}
      />

      <Card>
        <Form form={form} layout="vertical" onFinish={handleSubmit} style={{ maxWidth: 640 }}>
          <Form.Item name="name" label="Location Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="address" label="Address">
            <Input />
          </Form.Item>
          <Space style={{ display: "flex" }} align="start">
            <Form.Item name="city" label="City" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item name="state" label="State" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </Space>
          <Space style={{ display: "flex" }} align="start">
            <Form.Item name="country" label="Country" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item name="timezone" label="Timezone" style={{ flex: 1 }}>
              <Input placeholder="e.g. America/New_York" />
            </Form.Item>
          </Space>
          <Form.Item
            name="taxRatePercent"
            label="Sales Tax Rate (%)"
            extra="Applied to POS and AI phone orders at this location."
          >
            <InputNumber
              min={0}
              max={100}
              step={0.05}
              precision={2}
              style={{ width: 160 }}
              aria-label="Sales tax rate percent"
            />
          </Form.Item>

          <Divider>AI Agent Config</Divider>
          <Form.Item
            name="menuBucket"
            label="Menu Knowledge Bucket"
            extra="Pre-created Telnyx storage bucket this location's menu is published to for AI retrieval (e.g. 'makalu'). Leave blank to auto-generate a per-location bucket. Never share a bucket between restaurants — it causes cross-menu answers."
          >
            <Input placeholder="e.g. makalu" />
          </Form.Item>
          <Form.List name="dynamicVariables">
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 8 }}>
                  <Text type="secondary">
                    Dynamic Variables for the AI Agent (e.g. key: &apos;price&apos;, value: &apos;10&apos;)
                  </Text>
                </div>
                {fields.map(({ key, name, ...restField }) => (
                  <Space key={key} style={{ display: "flex", marginBottom: 8 }} align="baseline">
                    <Form.Item
                      {...restField}
                      name={[name, "key"]}
                      rules={[{ required: true, message: "Missing key" }]}
                    >
                      <Input placeholder="Variable Key" />
                    </Form.Item>
                    <Form.Item {...restField} name={[name, "value"]}>
                      <Input placeholder="Variable Value (Optional)" />
                    </Form.Item>
                    <MinusCircleOutlined
                      aria-label="Remove variable"
                      onClick={() => remove(name)}
                      style={{ color: token.colorError }}
                    />
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

          <Form.Item style={{ marginTop: 24, marginBottom: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>
                Save Changes
              </Button>
              <Button onClick={() => router.push("/settings")}>Cancel</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
