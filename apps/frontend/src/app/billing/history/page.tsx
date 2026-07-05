"use client";

import { Table, Button, Typography, Tag, Card } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import PageHeader from "@/components/PageHeader";

const { Title, Text } = Typography;

interface Invoice {
  id: string;
  date: string;
  amount: number;
  status: string;
}

const mockInvoices: Invoice[] = [
  { id: "INV-2024-001", date: "2024-10-01", amount: 4900, status: "paid" },
  { id: "INV-2024-002", date: "2024-11-01", amount: 4900, status: "paid" },
  { id: "INV-2024-003", date: "2024-12-01", amount: 5500, status: "paid" },
  { id: "INV-2025-001", date: "2025-01-01", amount: 4900, status: "pending" },
];

export default function BillingHistoryPage() {
  const columns = [
    {
      title: "Invoice ID",
      dataIndex: "id",
      key: "id",
      render: (text: string) => <Text strong>{text}</Text>,
    },
    {
      title: "Date",
      dataIndex: "date",
      key: "date",
    },
    {
      title: "Amount",
      dataIndex: "amount",
      key: "amount",
      render: (amount: number) => `$${(amount / 100).toFixed(2)}`,
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (status: string) => {
        const color = status === "paid" ? "green" : "volcano";
        return <Tag color={color}>{status.toUpperCase()}</Tag>;
      },
    },
    {
      title: "Action",
      key: "action",
      render: () => (
        <Button type="link" icon={<DownloadOutlined />}>
          Download PDF
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Billing History" subtitle="Past invoices and payment records." />

      <Card variant="borderless" style={{ borderRadius: 8 }}>
        <Table 
          dataSource={mockInvoices} 
          columns={columns} 
          rowKey="id" 
          pagination={false}
        />
      </Card>
    </div>
  );
}
