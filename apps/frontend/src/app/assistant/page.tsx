"use client";

import { useEffect, useState } from "react";
import { Table, Spin, Alert, Tag, Typography, Button, theme, Card } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { ErrorState } from "@/components/PageStates";
import { useLocation } from "@/contexts/LocationContext";
import type { Assistant } from "@platform/shared-types";

const { Title } = Typography;

export default function AssistantPage() {
  const [agents, setAgents] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { token } = theme.useToken();

  const { selectedLocationId } = useLocation();

  useEffect(() => {
    if (!selectedLocationId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAgents([]);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    api
      .get(`/agents?locationId=${selectedLocationId}`)
      .then(({ data }) => {
        const list = (data as { data?: Assistant[] })?.data ?? (data as Assistant[]) ?? [];
        setAgents(list);
      })
      .catch(() => setError("Failed to load agents."))
      .finally(() => setLoading(false));
  }, [selectedLocationId]);

  const columns: ColumnsType<Assistant> = [
    { title: "Name", dataIndex: "name" },
    {
      title: "Model",
      dataIndex: "model",
      width: 220,
      render: (m: string) => <Tag color='blue'>{m ?? "—"}</Tag>,
    },
    {
      title: "",
      key: "action",
      width: 130,
      render: (_: unknown, record: Assistant) => (
        <Button
          type='link'
          onClick={() => router.push(`/assistant/${record.id}`)}
        >
          View Details →
        </Button>
      ),
    },
  ];

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: token.marginXXL }}>
        <Spin size='large' />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  }

  return (
    <>
      <PageHeader title="AI Agents" subtitle="Voice AI agents configured for your locations." />
      <Card variant="borderless">
        <Table
          columns={columns}
          dataSource={agents}
          rowKey='id'
          pagination={false}
        />
      </Card>
    </>
  );
}
