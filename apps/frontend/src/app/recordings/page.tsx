"use client";

import React, { useEffect, useState, useMemo } from "react";
import { Table, Card, Typography, Space, Button, Input, Tag, Skeleton, Alert, Empty, theme } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DownloadOutlined, PlayCircleOutlined, SearchOutlined, AudioOutlined } from "@ant-design/icons";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { EmptyState } from "@/components/PageStates";
import { useLocation } from "@/contexts/LocationContext";
import dayjs from "dayjs";
import type { CallRecord } from "@platform/shared-types";

const { Text } = Typography;

function formatDuration(ms: number) {
  if (!ms) return "—";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function RecordingsPage() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { selectedLocationId } = useLocation();
  const { token } = theme.useToken();

  useEffect(() => {
    let cancelled = false;
    async function fetchRecordings() {
      if (!selectedLocationId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await api.get<{ data: CallRecord[] }>(
          `/calls?locationId=${selectedLocationId}`
        );
        if (cancelled) return;
        const data = Array.isArray(res.data) ? res.data : (res.data.data || []);
        // Only show calls that have a recording URL
        setCalls(data.filter((c: CallRecord) => !!c.recordingUrl));
      } catch {
        if (!cancelled) setError("Failed to load recordings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchRecordings();
    return () => { cancelled = true; };
  }, [selectedLocationId]);

  const filteredCalls = useMemo(() => {
    if (!search) return calls;
    const lower = search.toLowerCase();
    return calls.filter(
      (c) =>
        c.from?.toLowerCase().includes(lower) ||
        c.to?.toLowerCase().includes(lower) ||
        c.transcriptText?.toLowerCase().includes(lower)
    );
  }, [calls, search]);

  const columns: ColumnsType<CallRecord> = [
    {
      title: "Date",
      dataIndex: "startedAt",
      key: "startedAt",
      render: (val: string) => val ? dayjs(val).format("MMM D, YYYY h:mm A") : "—",
    },
    {
      title: "Duration",
      dataIndex: "durationMs",
      key: "durationMs",
      render: (val: number) => formatDuration(val),
    },
    {
      title: "Caller",
      dataIndex: "from",
      key: "from",
      render: (val: string) => (val ? val : "Unknown"),
    },
    {
      title: "Transcript Preview",
      dataIndex: "transcriptText",
      key: "transcriptText",
      render: (val: string | null) => (
        <div style={{ maxWidth: 300, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {val || <Text type="secondary">No transcript</Text>}
        </div>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      render: (_, record) => (
        <Space>
          <a href={record.recordingUrl!} target="_blank" rel="noopener noreferrer">
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              size="small"
            >
              Play
            </Button>
          </a>
          <a href={record.recordingUrl!} target="_blank" rel="noopener noreferrer" download>
            <Button
              icon={<DownloadOutlined />}
              size="small"
            >
              Download
            </Button>
          </a>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={<><AudioOutlined style={{ color: token.colorPrimary, marginRight: 12 }} />Call Recordings</>}
        subtitle="Review and playback audio recordings of customer calls."
      />

      <Card>
        <div style={{ marginBottom: token.margin, display: "flex", justifyContent: "space-between" }}>
          <Input
            placeholder="Search by phone number or transcript..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 300 }}
          />
        </div>

        {error && <Alert type="error" title={error} style={{ marginBottom: token.margin }} />}
        
        {!selectedLocationId && !loading ? (
          <EmptyState description="Select a location above to view its recordings." />
        ) : loading ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : (
          <Table
            dataSource={filteredCalls}
            columns={columns}
            rowKey="id"
            pagination={{ pageSize: 15 }}
            locale={{ emptyText: "No recordings found for this location." }}
          />
        )}
      </Card>
    </div>
  );
}
