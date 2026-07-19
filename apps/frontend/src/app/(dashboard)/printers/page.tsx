"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  Tag,
  Button,
  Card,
  Typography,
  Space,
  Alert,
  Drawer,
  Descriptions,
  App,
  Tooltip,
  Modal,
  Form,
  Input,
  Select,
  Tabs,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ReloadOutlined,
  PlusOutlined,
  PrinterOutlined,
  EditOutlined,
  DeleteOutlined,
  HistoryOutlined,
  WarningOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { api } from "@/lib/api";
import { getAccessToken } from "@/lib/token-store";
import PageHeader from "@/components/PageHeader";
import PrintSettingsCard from "@/components/PrintSettingsCard";
import { useLocation } from "@/contexts/LocationContext";

const { Title, Text } = Typography;

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
  updatedAt: string;
}

export default function PrintersPage() {
  const { message, modal } = App.useApp();
  const { token } = theme.useToken();
  const router = useRouter();
  
  // State
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modals & Drawer State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPrinter, setEditingPrinter] = useState<Printer | null>(null);
  const [form] = Form.useForm();
  
  // Drawer for printer queue
  const [queuePrinter, setQueuePrinter] = useState<Printer | null>(null);
  const [queueJobs, setQueueJobs] = useState<PrintJob[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  
  // DLQ (Dead-Letter Queue) State
  const [dlqJobs, setDlqJobs] = useState<PrintJob[]>([]);
  const [dlqLoading, setDlqLoading] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  
  const { selectedLocationId } = useLocation();

  // Load printers list
  const loadPrinters = useCallback(() => {
    if (!selectedLocationId) {
      setPrinters([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .get<{ data: Printer[] }>(`/printers?locationId=${selectedLocationId}`)
      .then(({ data }) => {
        setPrinters(Array.isArray(data.data) ? data.data : ((data as unknown as Printer[]) || []));
      })
      .catch((err) => {
        console.error("Failed to load printers:", err);
        setError("Failed to load printers.");
      })
      .finally(() => setLoading(false));
  }, [selectedLocationId]);

  // Load Dead-Letter Queue
  const loadDLQ = useCallback(() => {
    setDlqLoading(true);
    api
      .get<PrintJob[]>("/print-jobs/dead-letter")
      .then(({ data }) => {
        setDlqJobs(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        console.error("Failed to load dead-letter queue:", err);
      })
      .finally(() => setDlqLoading(false));
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => {
      loadPrinters();
      loadDLQ();
      if (typeof window !== "undefined") {
        const token = getAccessToken();
        if (token) {
          try {
            const payload = token.split(".")[1];
            const decoded = JSON.parse(window.atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
            const role = decoded.role?.toLowerCase() || "";
            setIsPlatformAdmin(["sysadmin", "platform_admin"].includes(role));
          } catch {
            setIsPlatformAdmin(false);
          }
        }
      }
    });
  }, [loadPrinters, loadDLQ]);

  // Handle open registration modal
  const handleOpenModal = (printer?: Printer) => {
    if (printer) {
      setEditingPrinter(printer);
      form.setFieldsValue({
        name: printer.name,
        topic: printer.topic,
        type: printer.type,
        locationName: printer.locationName,
        model: printer.model,
        ipAddress: printer.ipAddress,
        notes: printer.notes,
      });
    } else {
      setEditingPrinter(null);
      form.resetFields();
    }
    setIsModalOpen(true);
  };

  // Submit Modal (Create or Update)
  const handleSubmit = async (values: Record<string, string>) => {
    try {
      if (!selectedLocationId) {
        message.error("Please select a location first.");
        return;
      }
      const isUpdating = !!editingPrinter;
      const endpoint = isUpdating
        ? `/printers/${editingPrinter.id}`
        : "/printers";
      const method = isUpdating ? "patch" : "post";

      await api[method](endpoint, { ...values, locationId: selectedLocationId });
      message.success(isUpdating ? "Printer configuration updated." : "New printer registered.");
      setIsModalOpen(false);
      loadPrinters();
    } catch {
      message.error("Failed to save printer configuration.");
    }
  };

  // Soft Delete Printer
  const handleDelete = (printer: Printer) => {
    modal.confirm({
      title: `Delete printer "${printer.name}"?`,
      content: "This printer will be removed from your active registry. Active print jobs on this topic will not be automatically deleted.",
      okText: "Delete",
      okType: "danger",
      onOk: async () => {
        try {
          await api.delete(`/printers/${printer.id}`);
          message.success("Printer deleted.");
          loadPrinters();
        } catch {
          message.error("Failed to delete printer.");
        }
      },
    });
  };

  // Trigger test print
  const handleTestPrint = async (printer: Printer) => {
    try {
      await api.post(`/printers/${printer.id}/test-print`);
      message.success(`Test print enqueued for "${printer.name}"! Check printer output.`);
    } catch {
      message.error("Failed to send test print job.");
    }
  };

  // Trigger MQTT restart command
  const handleRestartPrinter = async (printer: Printer) => {
    try {
      await api.post(`/printers/${printer.id}/restart`);
      message.success(`Restart command sent to "${printer.name}" via MQTT.`);
    } catch {
      message.error("Failed to send restart command.");
    }
  };

  // View Queue
  const handleViewQueue = async (printer: Printer) => {
    setQueuePrinter(printer);
    setQueueLoading(true);
    try {
      const { data } = await api.get<PrintJob[]>(`/printers/${printer.id}/queue`);
      setQueueJobs(Array.isArray(data) ? data : []);
    } catch {
      message.error("Failed to load printer queue.");
    } finally {
      setQueueLoading(false);
    }
  };

  // Requeue single job
  const handleRequeueJob = async (jobId: string) => {
    try {
      await api.post(`/print-jobs/${jobId}/requeue`);
      message.success("Print job requeued successfully.");
      loadDLQ();
      if (queuePrinter) {
        handleViewQueue(queuePrinter);
      }
    } catch {
      message.error("Failed to requeue job.");
    }
  };

  // Printer Table Columns
  const printerColumns: ColumnsType<Printer> = [
    {
      title: "Status",
      dataIndex: "isOnline",
      key: "status",
      width: 100,
      render: (isOnline: boolean) => (
        <Tag color={isOnline ? "green" : "red"} style={{ fontWeight: 600 }}>
          {isOnline ? "ONLINE" : "OFFLINE"}
        </Tag>
      ),
    },
    {
      title: "Name & Info",
      key: "name_info",
      render: (_, record) => (
        <div>
          <Typography.Link
            style={{ fontWeight: 600, fontSize: 15 }}
            onClick={() => router.push(`/printers/${record.id}`)}
            aria-label={`Open ${record.name} details`}
          >
            {record.name}
          </Typography.Link>
          <div style={{ marginTop: 2, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Tag color="blue">{record.type.toUpperCase()}</Tag>
            {record.model && <Tag color="default">{record.model}</Tag>}
            {record.locationName && <Text type="secondary" style={{ fontSize: 12 }}>({record.locationName})</Text>}
          </div>
        </div>
      ),
    },
    {
      title: "MQTT Topic",
      dataIndex: "topic",
      key: "topic",
      // Topics are long and mostly identical — show the tail; full value on hover.
      render: (v: string) => (
        <Tooltip title={v}>
          <Text code>…{v.slice(-6)}</Text>
        </Tooltip>
      ),
    },
    {
      title: "Last Check-in",
      dataIndex: "lastHeartbeatAt",
      key: "lastHeartbeat",
      render: (v: string | null) => {
        if (!v) return <Text type="secondary">—</Text>;
        return new Date(v).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        });
      },
    },
    {
      title: "Action",
      key: "action",
      align: "center",
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title="Test Print">
            <Button
              type="text"
              icon={<PrinterOutlined />}
              aria-label="Test print"
              onClick={() => handleTestPrint(record)}
            />
          </Tooltip>
          <Tooltip title="Restart Printer">
            <Button
              type="text"
              icon={<ReloadOutlined style={{ color: token.colorWarning }} />}
              aria-label="Restart printer"
              onClick={() => handleRestartPrinter(record)}
            />
          </Tooltip>
          <Tooltip title="View Queue">
            <Button
              type="text"
              icon={<HistoryOutlined style={{ color: token.colorPrimary }} />}
              aria-label="View print queue"
              onClick={() => handleViewQueue(record)}
            />
          </Tooltip>
          <Tooltip title="Details & Config">
            <Button
              type="text"
              icon={<EditOutlined />}
              aria-label={`Open ${record.name} details`}
              onClick={() => router.push(`/printers/${record.id}`)}
            />
          </Tooltip>
          <Tooltip title="Delete Printer">
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              aria-label="Delete printer"
              onClick={() => handleDelete(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  // Print Queue Table Columns
  const queueColumns: ColumnsType<PrintJob> = [
    {
      title: "Created At",
      dataIndex: "createdAt",
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: "Job Type",
      dataIndex: "jobType",
      render: (v: string) => <Tag color="blue">{v.toUpperCase()}</Tag>,
    },
    {
      title: "Status",
      dataIndex: "status",
      render: (status: string) => {
        let color = "default";
        if (status === "sent") color = "green";
        if (status === "failed") color = "red";
        if (status === "queued" || status === "retrying") color = "gold";
        return <Tag color={color}>{status.toUpperCase()}</Tag>;
      },
    },
    {
      title: "Attempts",
      dataIndex: "attempts",
    },
    {
      title: "Error/Status Details",
      dataIndex: "lastError",
      render: (v: string | null) => v || "None",
    },
    {
      title: "Actions",
      key: "actions",
      render: (_, record) => (
        record.status === "failed" && (
          <Button size="small" type="primary" onClick={() => handleRequeueJob(record.id)}>
            Retry
          </Button>
        )
      ),
    },
  ];

  // Dead Letter Queue Columns
  const dlqColumns: ColumnsType<PrintJob> = [
    {
      title: "Failed At",
      dataIndex: "updatedAt",
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: "Job Type",
      dataIndex: "jobType",
      render: (v: string) => <Tag color="blue">{v.toUpperCase()}</Tag>,
    },
    {
      title: "Attempts",
      dataIndex: "attempts",
    },
    {
      title: "Error Message",
      dataIndex: "lastError",
      render: (v: string | null) => (
        <Text type="danger" style={{ fontStyle: "italic", fontSize: 13 }}>
          {v || "Unknown printing failure"}
        </Text>
      ),
    },
    {
      title: "Action",
      key: "action",
      align: "center",
      render: (_, record) => (
        <Button
          size="small"
          type="primary"
          icon={<SyncOutlined />}
          onClick={() => handleRequeueJob(record.id)}
        >
          Requeue
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Printer Management"
        subtitle="Monitor and configure cloud thermal printers connected via MQTT."
        actions={
          <>
            {isPlatformAdmin && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenModal()}>
                Register Printer
              </Button>
            )}
            <Button icon={<ReloadOutlined />} onClick={() => { loadPrinters(); loadDLQ(); }} loading={loading}>
              Refresh
            </Button>
          </>
        }
      />

      {error && (
        <Alert
          type="error"
          title={error}
          showIcon
          style={{ marginBottom: token.marginSM }}
        />
      )}

      {/* Main Tabs */}
      <Tabs
        defaultActiveKey="printers"
        items={[
          {
            key: "printers",
            label: `Active Printers (${printers.length})`,
            children: (
              <Card variant="borderless" style={{ marginTop: token.marginXS }}>
                <Table
                  columns={printerColumns}
                  dataSource={printers}
                  rowKey="id"
                  loading={loading}
                  pagination={false}
                  locale={{ emptyText: "No printers registered. Click 'Register Printer' to configure your first device." }}
                />
              </Card>
            )
          },
          {
            key: "print-settings",
            label: "Print Settings",
            children: <PrintSettingsCard />,
          },
          {
            key: "dlq",
            label: (
              <span>
                Dead-Letter Queue
                {dlqJobs.length > 0 && (
                  <Tag color="red" style={{ marginLeft: 8, borderRadius: 10 }}>{dlqJobs.length}</Tag>
                )}
              </span>
            ),
            children: (
              <Card variant="borderless" style={{ marginTop: token.marginXS }}>
                {dlqJobs.length > 0 && (
                  <Alert
                    type="warning"
                    showIcon
                    icon={<WarningOutlined />}
                    message="Failed Print Jobs Detected"
                    description="Print jobs listed here failed all retry attempts. Ensure the corresponding printer is online and click 'Requeue' to retry printing."
                    style={{ marginBottom: token.marginSM }}
                  />
                )}
                <Table
                  columns={dlqColumns}
                  dataSource={dlqJobs}
                  rowKey="id"
                  loading={dlqLoading}
                  pagination={{ defaultPageSize: 10 }}
                  locale={{ emptyText: "No permanently failed print jobs. Your printer queues are clean!" }}
                />
              </Card>
            )
          }
        ]}
      />

      {/* Register/Edit Modal */}
      <Modal forceRender
        title={editingPrinter ? "Edit Printer Config" : "Register New Printer"}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="Printer Name"
            rules={[{ required: true, message: "Please input the printer name!" }]}
          >
            <Input placeholder="e.g. Main Kitchen Printer" />
          </Form.Item>

          <Form.Item
            name="topic"
            label="MQTT Command Topic"
            rules={[{ required: true, message: "Please input the MQTT print topic!" }]}
          >
            <Input placeholder="restaurant/org123/kitchen/print" />
          </Form.Item>

          <Form.Item
            name="type"
            label="Type"
            rules={[{ required: true, message: "Please select printer type!" }]}
          >
            <Select placeholder="Select printer type">
              <Select.Option value="kitchen">Kitchen Printer</Select.Option>
              <Select.Option value="receipt">Receipt Printer</Select.Option>
              <Select.Option value="label">Label Printer</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item name="locationName" label="Location (e.g. Main Kitchen, Counter)">
            <Input placeholder="Optional location detail" />
          </Form.Item>

          <Form.Item name="model" label="Printer Hardware Model">
            <Input placeholder="e.g. EPSON TM-T88VI" />
          </Form.Item>

          <Form.Item name="ipAddress" label="Printer IP Address">
            <Input placeholder="e.g. 192.168.1.100" />
          </Form.Item>

          <Form.Item name="notes" label="Notes">
            <Input.TextArea placeholder="Additional notes about the printer setup..." rows={3} />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Space>
              <Button onClick={() => setIsModalOpen(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit">Save</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Printer Queue History Drawer */}
      <Drawer
        title={queuePrinter ? `History Queue — ${queuePrinter.name}` : "Printer Queue"}
        styles={{ wrapper: { width: 680 } }}
        placement="right"
        onClose={() => setQueuePrinter(null)}
        open={!!queuePrinter}
      >
        {queuePrinter && (
          <Space orientation="vertical" size="large" style={{ width: "100%" }}>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="Printer ID"><Text copyable style={{ fontSize: 12 }}>{queuePrinter.id}</Text></Descriptions.Item>
              <Descriptions.Item label="Type"><Tag color="blue">{queuePrinter.type.toUpperCase()}</Tag></Descriptions.Item>
              <Descriptions.Item label="MQTT Topic"><Text code>{queuePrinter.topic}</Text></Descriptions.Item>
              <Descriptions.Item label="Status">
                <Tag color={queuePrinter.isOnline ? "green" : "red"}>{queuePrinter.isOnline ? "ONLINE" : "OFFLINE"}</Tag>
              </Descriptions.Item>
            </Descriptions>
            
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <Title level={5} style={{ margin: 0 }}>Print Job History</Title>
                <Button size="small" icon={<ReloadOutlined />} onClick={() => handleViewQueue(queuePrinter)} loading={queueLoading}>
                  Refresh Queue
                </Button>
              </div>
              <Table
                columns={queueColumns}
                dataSource={queueJobs}
                rowKey="id"
                loading={queueLoading}
                pagination={{ defaultPageSize: 10 }}
                size="small"
              />
            </div>
          </Space>
        )}
      </Drawer>
    </>
  );
}
