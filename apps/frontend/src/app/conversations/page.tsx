"use client";

import React, { useEffect, useState } from "react";
import { Table, Card, Typography, Space, Button, Tag, Skeleton, Alert, Empty, theme } from "antd";
import type { ColumnsType } from "antd/es/table";
import { MessageOutlined, EyeOutlined } from "@ant-design/icons";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { EmptyState } from "@/components/PageStates";
import { useLocation } from "@/contexts/LocationContext";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useRouter } from "next/navigation";

dayjs.extend(relativeTime);

const { Title, Text } = Typography;

interface Conversation {
  id: string;
  callSessionId: string;
  messages: unknown[];
  createdAt: string;
  updatedAt: string;
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { selectedLocationId } = useLocation();
  const { token } = theme.useToken();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    async function fetchConversations() {
      if (!selectedLocationId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await api.get<{ data: Conversation[] }>(
          `/conversations?locationId=${selectedLocationId}`
        );
        if (cancelled) return;
        const data = Array.isArray(res.data) ? res.data : (res.data.data || []);
        setConversations(data);
      } catch {
        if (!cancelled) setError("Failed to load conversations");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchConversations();
    return () => { cancelled = true; };
  }, [selectedLocationId]);

  const columns: ColumnsType<Conversation> = [
    {
      title: "Date",
      dataIndex: "createdAt",
      key: "createdAt",
      render: (val: string) => val ? dayjs(val).format("MMM D, YYYY h:mm A") : "—",
    },
    {
      title: "Call Session",
      dataIndex: "callSessionId",
      key: "callSessionId",
      render: (val: string) => <Text copyable>{val}</Text>,
    },
    {
      title: "Messages",
      key: "messages",
      render: (_, record) => (
        <Tag color="blue">{record.messages ? record.messages.length : 0} messages</Tag>
      ),
    },
    {
      title: "Last Update",
      dataIndex: "updatedAt",
      key: "updatedAt",
      render: (val: string) => val ? dayjs(val).fromNow() : "—",
    },
    {
      title: "Actions",
      key: "actions",
      render: (_, record) => (
        <Button
          type="primary"
          icon={<EyeOutlined />}
          size="small"
          onClick={() => router.push(`/conversations/${record.id}`)}
        >
          View Thread
        </Button>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <PageHeader
        title={<><MessageOutlined style={{ color: token.colorPrimary, marginRight: 12 }} />Conversations</>}
        subtitle="Review chat threads from your AI voice agent."
      />

      <Card>
        {error && <Alert type="error" title={error} style={{ marginBottom: token.margin }} />}

        {!selectedLocationId && !loading ? (
          <EmptyState description="Select a location above to view its conversations." />
        ) : loading ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : (
          <Table
            dataSource={conversations}
            columns={columns}
            rowKey="id"
            pagination={{ pageSize: 15 }}
            locale={{ emptyText: "No conversations found for this location." }}
          />
        )}
      </Card>
    </div>
  );
}
