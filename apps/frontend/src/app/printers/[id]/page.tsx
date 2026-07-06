"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  App,
  Badge,
  Breadcrumb,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Row,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ArrowLeftOutlined,
  PrinterOutlined,
  ReloadOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { ErrorState } from "@/components/PageStates";

const { Text } = Typography;

interface Printer {
  id: string;
  name: string;
  topic: string;
  type: "kitchen" | "receipt" | "label";
  locationName: string | null;
  isOnline: boolean;
  lastHeartbeatAt: string | null;
  ipAddress: string | null;
  model: string | null;
  notes: string | null;
  createdAt: string;
}

interface PrintJob {
  id: string;
  orderId: string;
  jobType: "kitchen" | "receipt";
  status: "queued" | "retrying" | "sent" | "failed";
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

const JOB_STATUS_COLOR: Record<string, string> = {
  queued: "gold",
  retrying: "orange",
  sent: "green",
  failed: "red",
};

const fmtDateTime = (v: string | null) =>
  v
    ? new Date(v).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

export default function PrinterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token } = theme.useToken();
  const { message } = App.useApp();

  const [printer, setPrinter] = useState<Printer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [queue, setQueue] = useState<PrintJob[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api
      .get<Printer>(`/printers/${id}`)
      .then(({ data }) => {
        if (!cancelled) setPrinter(data);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load the printer.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    api
      .get<PrintJob[]>(`/printers/${id}/queue`)
      .then(({ data }) => {
        if (!cancelled) setQueue(data ?? []);
      })
      .catch(() => {
        // Queue is auxiliary — the page still works without it.
      })
      .finally(() => {
        if (!cancelled) setQueueLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleSave = async (values: Record<string, unknown>) => {
    setSaving(true);
    try {
      const { data } = await api.patch<Printer>(`/printers/${id}`, values);
      setPrinter(data);
      message.success("Printer configuration saved.");
    } catch {
      message.error("Failed to save the printer configuration.");
    } finally {
      setSaving(false);
    }
  };

  const handleTestPrint = async () => {
    try {
      await api.post(`/printers/${id}/test-print`);
      message.success("Test print sent.");
    } catch {
      message.error("Failed to send the test print.");
    }
  };

  const handleRestart = async () => {
    try {
      await api.post(`/printers/${id}/restart`);
      message.success("Restart command sent.");
    } catch {
      message.error("Failed to send the restart command.");
    }
  };

  const queueColumns: ColumnsType<PrintJob> = [
    {
      title: "Created",
      dataIndex: "createdAt",
      render: (v: string) => fmtDateTime(v),
    },
    {
      title: "Order",
      dataIndex: "orderId",
      // Test prints and restart commands have no order attached.
      render: (v: string | null) =>
        v ? (
          <Text
            copyable={{ text: v }}
            style={{ fontFamily: "monospace", fontSize: 12 }}
          >
            {v.slice(0, 8)}
          </Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    { title: "Type", dataIndex: "jobType" },
    {
      title: "Status",
      dataIndex: "status",
      render: (s: string) => <Tag color={JOB_STATUS_COLOR[s]}>{s}</Tag>,
    },
    { title: "Attempts", dataIndex: "attempts", align: "center" },
    {
      title: "Last Error",
      dataIndex: "lastError",
      render: (v: string | null) =>
        v ? (
          <Text type="danger" style={{ fontSize: 12 }}>
            {v}
          </Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
  ];

  if (loading) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (error || !printer) {
    return (
      <ErrorState
        message={error ?? "Printer not found."}
        onRetry={() => router.push("/printers")}
      />
    );
  }

  return (
    <div>
      <PageHeader
        overline={
          <Breadcrumb
            items={[
              {
                title: <a onClick={() => router.push("/printers")}>Printers</a>,
              },
              { title: printer.name },
            ]}
          />
        }
        title={
          <Space size={10}>
            <Button
              size="small"
              icon={<ArrowLeftOutlined />}
              aria-label="Back to printers"
              onClick={() => router.push("/printers")}
            />
            {printer.name}
            <Badge
              status={printer.isOnline ? "success" : "error"}
              text={printer.isOnline ? "Online" : "Offline"}
            />
          </Space>
        }
        subtitle={`${printer.type} printer`}
        actions={
          <Space>
            <Button icon={<PrinterOutlined />} onClick={handleTestPrint}>
              Test Print
            </Button>
            <Button
              icon={<ReloadOutlined style={{ color: token.colorWarning }} />}
              onClick={handleRestart}
            >
              Restart
            </Button>
          </Space>
        }
      />

      <Row gutter={[token.marginSM, token.marginSM]}>
        <Col xs={24} lg={10}>
          <Card title="Configuration" size="small">
            {/* The form only mounts once the printer is loaded, so initialValues
                are complete — no detached useForm instance (avoids the antd warning). */}
            <Form
              layout="vertical"
              onFinish={handleSave}
              initialValues={{
                name: printer.name,
                topic: printer.topic,
                type: printer.type,
                locationName: printer.locationName,
                model: printer.model,
                ipAddress: printer.ipAddress,
                notes: printer.notes,
              }}
            >
              <Form.Item
                name="name"
                label="Printer Name"
                rules={[{ required: true, message: "Name is required" }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="topic"
                label="MQTT Command Topic"
                rules={[{ required: true, message: "Topic is required" }]}
              >
                <Input />
              </Form.Item>
              <Form.Item name="type" label="Type" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: "kitchen", label: "Kitchen Printer" },
                    { value: "receipt", label: "Receipt Printer" },
                    { value: "label", label: "Label Printer" },
                  ]}
                />
              </Form.Item>
              <Form.Item name="locationName" label="Placement">
                <Input placeholder="e.g. Main Kitchen, Counter" />
              </Form.Item>
              <Form.Item name="model" label="Hardware Model">
                <Input placeholder="e.g. EPSON TM-T88VI" />
              </Form.Item>
              <Form.Item name="ipAddress" label="IP Address">
                <Input placeholder="e.g. 192.168.1.100" />
              </Form.Item>
              <Form.Item name="notes" label="Notes">
                <Input.TextArea rows={3} />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0 }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<SaveOutlined />}
                  loading={saving}
                >
                  Save Changes
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card title="Status" size="small" style={{ marginBottom: token.marginSM }}>
            <Descriptions
              size="small"
              column={{ xs: 1, sm: 2 }}
              items={[
                {
                  key: "heartbeat",
                  label: "Last Heartbeat",
                  children: fmtDateTime(printer.lastHeartbeatAt),
                },
                {
                  key: "registered",
                  label: "Registered",
                  children: fmtDateTime(printer.createdAt),
                },
                {
                  key: "topic",
                  label: "Topic",
                  children: (
                    <Text style={{ fontFamily: "monospace", fontSize: 12 }}>
                      {printer.topic}
                    </Text>
                  ),
                },
                {
                  key: "id",
                  label: "Printer ID",
                  children: (
                    <Text
                      copyable={{ text: printer.id }}
                      style={{ fontFamily: "monospace", fontSize: 12 }}
                    >
                      {printer.id.slice(0, 8)}
                    </Text>
                  ),
                },
              ]}
            />
          </Card>

          <Card title="Recent Print Jobs" size="small">
            <Table
              columns={queueColumns}
              dataSource={queue}
              rowKey="id"
              size="small"
              loading={queueLoading}
              pagination={{ defaultPageSize: 10 }}
              locale={{ emptyText: "No print jobs yet for this printer." }}
              aria-label="Recent print jobs"
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
