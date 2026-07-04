"use client";

import { use, useEffect, useState } from "react";
import {
  Spin,
  Alert,
  Card,
  Descriptions,
  Table,
  Tag,
  Typography,
  Space,
  Input,
  Button,
  message,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { ArrowLeftOutlined, SaveOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

const { Title, Text } = Typography;

interface VoiceSettings {
  voice?: string;
  voice_speed?: number;
  language_boost?: string;
}

interface TelephonySettings {
  time_limit_secs?: number;
  recording_settings?: {
    enabled?: boolean;
    channels?: string;
    format?: string;
  };
}

interface TranscriptionSettings {
  model?: string;
  language?: string;
}

interface Assistant {
  id: string;
  name: string;
  model: string;
  greeting: string;
  dynamic_variables?: Record<string, string>;
  voice_settings?: VoiceSettings;
  telephony_settings?: TelephonySettings;
  transcription?: TranscriptionSettings;
}

interface DynVarRow {
  key: string;
  value: string;
}

function sanitizeVoice(v?: string) {
  if (!v) return "—";
  return v;
}

export default function AssistantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { token } = theme.useToken();
  const [messageApi, contextHolder] = message.useMessage();

  const [agent, setAgent] = useState<Assistant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editable state
  const [greeting, setGreeting] = useState("");
  const [dynVars, setDynVars] = useState<DynVarRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get(`/agents/${id}`)
      .then(({ data }) => {
        const a: Assistant = (data as { data?: Assistant })?.data ?? (data as Assistant);
        setAgent(a);
        setGreeting(a.greeting ?? "");
        setDynVars(
          Object.entries(a.dynamic_variables ?? {}).map(([key, value]) => ({
            key,
            value,
          })),
        );
      })
      .catch(() => setError("Failed to load agent."))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const dynamic_variables = Object.fromEntries(
        dynVars.map((r) => [r.key, r.value]),
      );
      await api.patch(`/agents/${id}`, {
        greeting,
        dynamic_variables,
      });
      messageApi.success("Agent updated successfully.");
    } catch {
      messageApi.error("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  const dynVarColumns: ColumnsType<DynVarRow> = [
    {
      title: "Variable",
      dataIndex: "key",
      width: 220,
      render: (k: string) => <Text code>{k}</Text>,
    },
    {
      title: "Value",
      dataIndex: "value",
      render: (val: string, _record: DynVarRow, index: number) => (
        <Input
          value={val}
          onChange={(e) => {
            setDynVars((prev) =>
              prev.map((r, i) =>
                i === index ? { ...r, value: e.target.value } : r,
              ),
            );
          }}
          size='small'
        />
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

  if (error || !agent) {
    return (
      <Alert
        type='error'
        title='Error'
        description={error ?? "Agent not found."}
        showIcon
      />
    );
  }

  const speed =
    agent.voice_settings?.voice_speed != null
      ? `${agent.voice_settings.voice_speed}×`
      : "—";
  const lang = agent.voice_settings?.language_boost ?? "—";
  const recEnabled = agent.telephony_settings?.recording_settings?.enabled;
  const recChannels =
    agent.telephony_settings?.recording_settings?.channels ?? "—";
  const recFormat =
    agent.telephony_settings?.recording_settings?.format?.toUpperCase() ?? "—";
  const timeLimit =
    agent.telephony_settings?.time_limit_secs != null
      ? `${Math.round(agent.telephony_settings.time_limit_secs / 60)} min`
      : "—";

  return (
    <>
      {contextHolder}

      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: token.margin,
        }}
      >
        <Space>
          <Button
            icon={<ArrowLeftOutlined />}
            type='text'
            onClick={() => router.push("/assistant")}
          />
          <Title level={4} style={{ margin: 0 }}>
            {agent.name}
          </Title>
          <Tag color='blue'>{agent.model}</Tag>
        </Space>
        <Button
          type='primary'
          icon={<SaveOutlined />}
          loading={saving}
          onClick={handleSave}
        >
          Save Changes
        </Button>
      </div>

      <Space orientation='vertical' size={token.margin} style={{ width: "100%" }}>
        {/* Greeting */}
        <Card variant="borderless" title='Greeting Message'>
          <Input.TextArea
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            rows={3}
            style={{ fontSize: 14 }}
          />
        </Card>

        {/* Dynamic Variables */}
        {dynVars.length > 0 && (
          <Card variant="borderless" title='Dynamic Variables'>
            <Table
              columns={dynVarColumns}
              dataSource={dynVars}
              rowKey='key'
              pagination={false}
              size='small'
            />
          </Card>
        )}

        {/* Settings (read-only) */}
        <Card variant="borderless" title='Settings'>
          <Descriptions column={2} bordered>
            <Descriptions.Item label='Voice' span={2}>
              {sanitizeVoice(agent.voice_settings?.voice)}
            </Descriptions.Item>
            <Descriptions.Item label='Voice Speed'>{speed}</Descriptions.Item>
            <Descriptions.Item label='Language'>{lang}</Descriptions.Item>
            <Descriptions.Item label='Call Time Limit'>
              {timeLimit}
            </Descriptions.Item>
            <Descriptions.Item label='Recording'>
              {recEnabled ? (
                <Space size='small'>
                  <Tag color='green'>Enabled</Tag>
                  <Text type='secondary'>
                    {recChannels} · {recFormat}
                  </Text>
                </Space>
              ) : (
                <Tag>Disabled</Tag>
              )}
            </Descriptions.Item>
            {agent.transcription?.model && (
              <Descriptions.Item label='Transcription Model' span={2}>
                {agent.transcription.model}
              </Descriptions.Item>
            )}
          </Descriptions>
        </Card>
      </Space>
    </>
  );
}
