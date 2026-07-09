"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Row,
  Select,
  Slider,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
  theme,
} from "antd";
import {
  ArrowLeftOutlined,
  BackwardOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DownloadOutlined,
  FileTextOutlined,
  FlagOutlined,
  ForwardOutlined,
  PauseOutlined,
  PhoneOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { api } from "@/lib/api";
import { formatPhone, formatDuration } from "@/lib/format";
import { ErrorState } from "@/components/PageStates";
import type { CallRecord, ConversationMessage } from "@platform/shared-types";
import { useLocation } from "@/contexts/LocationContext";

const { Title, Text } = Typography;

// ── Formatters ─────────────────────────────────────────────────────────────────
function formatDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function truncateId(id: string) {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-5)}` : id;
}

function stripSSML(text: string) {
  return text
    .replace(/<[^>]+\/?>/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function fmtTime(s: number) {
  if (!isFinite(s) || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// ── Derive call intelligence from messages ─────────────────────────────────────
function deriveInsights(messages: ConversationMessage[], call: CallRecord) {
  const allText = messages
    .map((m) => stripSSML(m.text ?? ""))
    .join(" ")
    .toLowerCase();

  const transferred =
    allText.includes("transfer") || allText.includes("one moment");
  const isOrder =
    allText.includes("order") ||
    allText.includes("pizza") ||
    allText.includes("delivery") ||
    allText.includes("pickup");
  const isComplaint =
    allText.includes("complaint") ||
    allText.includes("issue") ||
    allText.includes("problem") ||
    allText.includes("refund");

  const intent = isOrder
    ? "Order Placement"
    : isComplaint
      ? "Complaint / Support"
      : "General Inquiry";
  const outcome = transferred ? "Escalated to Manager" : "Resolved by AI";
  const aiResolution = transferred ? "Escalated" : "Resolved";

  const positiveWords = ["great", "thanks", "perfect", "awesome", "happy"];
  const negativeWords = [
    "issue",
    "problem",
    "frustrated",
    "upset",
    "angry",
    "complaint",
  ];
  const posCount = positiveWords.filter((w) => allText.includes(w)).length;
  const negCount = negativeWords.filter((w) => allText.includes(w)).length;
  const sentiment =
    negCount > posCount
      ? "Frustrated"
      : posCount > negCount
        ? "Positive"
        : "Neutral";

  const durationSec = Math.round((call.durationMs ?? 0) / 1000);
  const summary: string[] = [];
  if (isOrder) summary.push("Customer attempted to place a food order.");
  if (isComplaint) summary.push("Customer raised an issue or complaint.");
  if (transferred) {
    summary.push("Customer requested to speak with a manager.");
    summary.push(`Call was transferred after ${durationSec}s.`);
  } else {
    summary.push("AI agent resolved the inquiry without escalation.");
  }
  if (messages.length > 0) {
    summary.push(`Conversation spanned ${messages.length} exchanges.`);
  }

  return { intent, outcome, aiResolution, sentiment, transferred, summary };
}

// ── Status badge ───────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const { token } = theme.useToken();
  // Theme-token palette per status so the badge follows light/dark mode automatically.
  const STATUS_STYLE: Record<
    string,
    { bg: string; border: string; color: string }
  > = {
    completed: {
      bg: token.colorSuccessBg,
      border: token.colorSuccess,
      color: token.colorSuccessTextActive,
    },
    failed: {
      bg: token.colorErrorBg,
      border: token.colorError,
      color: token.colorErrorTextActive,
    },
    error: {
      bg: token.colorErrorBg,
      border: token.colorError,
      color: token.colorErrorTextActive,
    },
    "in-progress": {
      bg: token.colorPrimaryBg,
      border: token.colorPrimary,
      color: token.colorPrimaryTextActive,
    },
  };
  const s = STATUS_STYLE[status] ?? {
    bg: token.colorFillQuaternary,
    border: token.colorBorder,
    color: token.colorTextSecondary,
  };
  return (
    <span
      style={{
        padding: "3px 12px",
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: 0.4,
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.color,
      }}
    >
      {status ? status.charAt(0).toUpperCase() + status.slice(1) : "—"}
    </span>
  );
}

const BADGE_STATUS_MAP: Record<
  string,
  "success" | "error" | "warning" | "processing" | "default"
> = {
  completed: "success",
  failed: "error",
  error: "error",
  missed: "warning",
  "in-progress": "processing",
};

// ── Audio Player ───────────────────────────────────────────────────────────────
function AudioPlayer({
  url,
  onCopyTranscript,
}: {
  url: string | null;
  onCopyTranscript: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const { token } = theme.useToken();
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [loading, setLoading] = useState(true);
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  useEffect(() => {
    // When url is null the component renders the "no recording" alert, so no
    // state reset is needed here (and loading already initializes to true).
    if (!url) return;
    let blobUrl: string | null = null;
    let cancelled = false;

    // Fetch audio with Authorization header via api client, then create a blob URL.
    // The <audio> element cannot set custom headers, so a direct URL with ?token= won't
    // work against a Bearer-guarded endpoint.
    api.get<Blob>(url, { responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        blobUrl = URL.createObjectURL(res.data);
        setAuthUrl(blobUrl);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [url]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      void el.play();
    }
  };

  const skip = (sec: number) => {
    if (audioRef.current)
      audioRef.current.currentTime = Math.max(
        0,
        Math.min(duration, currentTime + sec),
      );
  };

  const onSpeedChange = (v: number) => {
    if (audioRef.current) audioRef.current.playbackRate = v;
    setSpeed(v);
  };

  if (!url)
    return (
      <Alert
        type='info'
        showIcon
        title='No recording available for this call.'
      />
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {authUrl && (
        <audio
          ref={audioRef}
          src={authUrl}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration);
            setLoading(false);
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setCurrentTime(0);
          }}
          onWaiting={() => setLoading(true)}
          onCanPlay={() => setLoading(false)}
        />
      )}

      {/* Progress */}
      <Slider
        min={0}
        max={duration || 1}
        step={0.5}
        value={currentTime}
        onChange={(v) => {
          if (audioRef.current) audioRef.current.currentTime = v;
          setCurrentTime(v);
        }}
        tooltip={{ formatter: (v) => fmtTime(v ?? 0) }}
        disabled={loading}
        styles={{
          track: { background: token.colorPrimary },
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: -8,
        }}
      >
        <Text type='secondary' style={{ fontSize: 12 }}>
          {fmtTime(currentTime)}
        </Text>
        <Text type='secondary' style={{ fontSize: 12 }}>
          {fmtTime(duration)}
        </Text>
      </div>

      {/* Controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <Tooltip title='Back 10s'>
          <Button
            shape='circle'
            icon={<BackwardOutlined />}
            onClick={() => skip(-10)}
            disabled={loading}
          />
        </Tooltip>
        <Button
          type='primary'
          shape='circle'
          size='large'
          icon={playing ? <PauseOutlined /> : <PlayCircleOutlined />}
          onClick={toggle}
          disabled={loading}
          style={{ width: 48, height: 48 }}
        />
        <Tooltip title='Forward 10s'>
          <Button
            shape='circle'
            icon={<ForwardOutlined />}
            onClick={() => skip(10)}
            disabled={loading}
          />
        </Tooltip>
        <Select
          value={speed}
          onChange={onSpeedChange}
          size='small'
          style={{ width: 70, marginLeft: 8 }}
          options={[
            { value: 0.75, label: "0.75×" },
            { value: 1, label: "1×" },
            { value: 1.5, label: "1.5×" },
            { value: 2, label: "2×" },
          ]}
        />
      </div>

      {/* Actions */}
      <Divider style={{ margin: "4px 0" }} />
      <Space style={{ justifyContent: "center" }} wrap>
        <Button icon={<DownloadOutlined />} size='small' href={url} download>
          Download
        </Button>
        <Button icon={<CopyOutlined />} size='small' onClick={onCopyTranscript}>
          Copy Transcript
        </Button>
      </Space>
    </div>
  );
}

// ── Transcript Bubble ──────────────────────────────────────────────────────────
function TranscriptBubble({ msg }: { msg: ConversationMessage }) {
  const { token } = theme.useToken();
  const role = (msg.role ?? "").toLowerCase();
  const isAgent = role === "assistant" || role === "agent";
  const text = stripSSML(msg.text ?? "");
  if (!text) return null;

  const time = msg.sent_at ?? msg.created_at;
  const timeStr = time
    ? new Date(time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        flexDirection: isAgent ? "row-reverse" : "row",
      }}
    >
      <Avatar
        size={32}
        icon={isAgent ? <RobotOutlined /> : <UserOutlined />}
        style={{
          flexShrink: 0,
          background: isAgent ? token.colorPrimary : token.colorSuccess,
          marginTop: 4,
        }}
      />
      <div
        style={{
          maxWidth: "72%",
          display: "flex",
          flexDirection: "column",
          alignItems: isAgent ? "flex-end" : "flex-start",
        }}
      >
        <div
          style={{
            background: isAgent ? token.colorPrimaryBg : token.colorBgContainer,
            border: `1px solid ${isAgent ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
            borderRadius: isAgent ? "16px 4px 16px 16px" : "4px 16px 16px 16px",
            padding: "10px 14px",
            boxShadow: token.boxShadowTertiary,
          }}
        >
          <Text
            style={{
              fontSize: 14,
              lineHeight: 1.65,
              display: "block",
            }}
          >
            {text}
          </Text>
          {timeStr && (
            <Text
              type='secondary'
              style={{
                fontSize: 11,
                display: "block",
                marginTop: 4,
                textAlign: isAgent ? "right" : "left",
              }}
            >
              {timeStr}
            </Text>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { token } = theme.useToken();
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [msgApi, contextHolder] = message.useMessage();
  const { selectedLocationId } = useLocation();

  const [call, setCall] = useState<CallRecord | null>(null);
  const [callLoading, setCallLoading] = useState(true);
  const [callError, setCallError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(true);

  useEffect(() => {
    if (!selectedLocationId) return;
    api
      .get<{ data: CallRecord[] }>("/calls", { params: { locationId: selectedLocationId } })
      .then(({ data }) => {
        const arr = Array.isArray(data.data) ? data.data : (data as unknown as CallRecord[]);
        const found = arr.find((c) => c.id === id) ?? null;
        if (!found) setCallError("Call not found.");
        else setCall(found);
      })
      .catch(() => setCallError("Failed to load call."))
      .finally(() => setCallLoading(false));
  }, [id, selectedLocationId]);

  useEffect(() => {
    // msgLoading starts true and the transcript section only renders once the
    // call is loaded, so no synchronous setState is needed here.
    if (!call?.id) return;
    let cancelled = false;
    api
      .get<{ messages: ConversationMessage[] }>(`/calls/${call.id}/messages`)
      .then(({ data }) => {
        if (!cancelled) setMessages(data.messages || []);
      })
      .catch((err) => console.error("Failed to load messages", err))
      .finally(() => {
        if (!cancelled) setMsgLoading(false);
      });
    return () => { cancelled = true; };
  }, [call?.id]);

  useEffect(() => {
    if (messages.length > 0 && transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [messages]);

  const copyTranscript = () => {
    const text = messages
      .map(
        (m) => `[${(m.role ?? "").toUpperCase()}]: ${stripSSML(m.text ?? "")}`,
      )
      .join("\n\n");
    navigator.clipboard
      .writeText(text)
      .then(() => msgApi.success("Transcript copied"));
  };

  if (callLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 80 }}>
        <Spin size='large' />
      </div>
    );
  }

  if (callError || !call) {
    return (
      <ErrorState
        message={callError ?? "Call not found."}
        onRetry={() => router.push("/calls")}
      />
    );
  }

  const insights = deriveInsights(messages, call);

  return (
    <>
      {contextHolder}
      <div style={{ maxWidth: 1200 }}>
        {/* ── Hero header ── */}
        <div style={{ marginBottom: 24 }}>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => router.push("/calls")}
            style={{ marginBottom: 16 }}
          >
            Back to Call Logs
          </Button>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 4,
                }}
              >
                <PhoneOutlined
                  style={{ fontSize: 20, color: token.colorPrimary }}
                />
                <Title
                  level={2}
                  style={{ margin: 0, fontSize: 28, fontWeight: 700 }}
                >
                  {formatPhone(call.from)}
                </Title>
                <StatusBadge status={call.status} />
              </div>
              <Text type='secondary' style={{ fontSize: 14 }}>
                <ClockCircleOutlined style={{ marginRight: 4 }} />
                {formatDuration(call.durationMs)}
                &nbsp;·&nbsp;{formatDate(call.startedAt)}
                &nbsp;·&nbsp;to {formatPhone(call.to)}
              </Text>
            </div>

            {/* Action buttons */}
            <Space wrap>
              <Tooltip title='Export Transcript'>
                <Button icon={<FileTextOutlined />} onClick={copyTranscript}>
                  Export
                </Button>
              </Tooltip>
              <Tooltip title='Flag for Review'>
                <Button icon={<FlagOutlined />} danger>
                  Flag
                </Button>
              </Tooltip>
            </Space>
          </div>
        </div>

        {/* ── Metadata strip ── */}
        <Descriptions
          layout='vertical'
          column={{ xs: 2, sm: 3, md: 3 }}
          size='small'
          style={{
            background: token.colorBgContainer,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG,
            padding: "16px 24px",
            marginBottom: 24,
          }}
          items={[
            {
              key: "caller",
              label: "Caller",
              children: (
                <Text strong style={{ whiteSpace: "nowrap" }}>
                  {formatPhone(call.from)}
                </Text>
              ),
            },
            {
              key: "to",
              label: "To",
              children: (
                <Text style={{ whiteSpace: "nowrap" }}>
                  {formatPhone(call.to)}
                </Text>
              ),
            },
            {
              key: "duration",
              label: "Duration",
              children: (
                <Text strong style={{ whiteSpace: "nowrap" }}>
                  {formatDuration(call.durationMs)}
                </Text>
              ),
            },
            {
              key: "status",
              label: "Status",
              children: (
                <Badge
                  status={BADGE_STATUS_MAP[call.status] ?? "default"}
                  text={
                    call.status
                      ? call.status.charAt(0).toUpperCase() +
                        call.status.slice(1)
                      : "—"
                  }
                />
              ),
            },
            {
              key: "started",
              label: "Started",
              children: (
                <Text style={{ whiteSpace: "nowrap", fontSize: 13 }}>
                  {formatDate(call.startedAt)}
                </Text>
              ),
            },
            {
              key: "call-id",
              label: "Call ID",
              children: (
                <Text
                  type='secondary'
                  copyable={{ text: call.id }}
                  style={{
                    fontSize: 12,
                    fontFamily: "monospace",
                    whiteSpace: "nowrap",
                  }}
                >
                  {truncateId(call.id)}
                </Text>
              ),
            },
          ]}
        />

        {/* ── Main layout ── */}
        <Row gutter={[24, 16]} wrap align='stretch'>
          {/* Left column */}
          <Col xs={24} lg={8}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 16,
                height: "100%",
              }}
            >
              {/* Recording */}
              <Card title='Recording' size='small'>
                <AudioPlayer
                  url={call.recordingUrl ? `/calls/${id}/recording` : null}
                  onCopyTranscript={copyTranscript}
                />
              </Card>

              {/* AI Summary */}
              {!msgLoading && messages.length > 0 && (
                <Card
                  title={
                    <Space>
                      <RobotOutlined style={{ color: token.colorPrimary }} />
                      <span>AI Summary</span>
                    </Space>
                  }
                  size='small'
                >
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 18,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {insights.summary.map((point, i) => (
                      <li
                        key={i}
                        style={{
                          fontSize: 13,
                          lineHeight: 1.6,
                          color: token.colorText,
                        }}
                      >
                        {point}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {/* Call Outcome */}
              {!msgLoading && messages.length > 0 && (
                <Card title='Call Outcome' size='small'>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 13,
                    }}
                  >
                    <tbody>
                      {[
                        { label: "Intent", value: insights.intent },
                        { label: "Outcome", value: insights.outcome },
                        {
                          label: "Sentiment",
                          value: (
                            <Tag
                              color={
                                insights.sentiment === "Positive"
                                  ? "green"
                                  : insights.sentiment === "Frustrated"
                                    ? "red"
                                    : "default"
                              }
                            >
                              {insights.sentiment}
                            </Tag>
                          ),
                        },
                        {
                          label: "Transfer",
                          value: insights.transferred ? (
                            <Tag color='orange'>Yes</Tag>
                          ) : (
                            <Tag>No</Tag>
                          ),
                        },
                        {
                          label: "AI Resolution",
                          value: (
                            <Tag
                              color={
                                insights.aiResolution === "Resolved"
                                  ? "green"
                                  : "volcano"
                              }
                            >
                              {insights.aiResolution}
                            </Tag>
                          ),
                        },
                      ].map(({ label, value }) => (
                        <tr
                          key={label}
                          style={{
                            borderBottom: `1px solid ${token.colorBorderSecondary}`,
                          }}
                        >
                          <td
                            style={{
                              padding: "7px 0",
                              color: token.colorTextTertiary,
                              width: "48%",
                            }}
                          >
                            {label}
                          </td>
                          <td style={{ padding: "7px 0", fontWeight: 500 }}>
                            {value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </div>
          </Col>

          {/* Transcript */}
          <Col
            xs={24}
            lg={16}
            style={{ display: "flex", flexDirection: "column" }}
          >
            <Card
              title={
                <Space>
                  <FileTextOutlined />
                  <span>Transcript</span>
                  {messages.length > 0 && (
                    <Tag color='blue'>{messages.length} messages</Tag>
                  )}
                </Space>
              }
              size='small'
              style={{ flex: 1, display: "flex", flexDirection: "column" }}
              styles={{
                body: {
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                },
              }}
              extra={
                <Button
                  size='small'
                  icon={<CopyOutlined />}
                  onClick={copyTranscript}
                >
                  Copy
                </Button>
              }
            >
              {msgLoading ? (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    padding: 48,
                  }}
                >
                  <Spin />
                </div>
              ) : messages.length === 0 ? (
                <Alert
                  type='info'
                  showIcon
                  title='No transcript available for this call.'
                />
              ) : (
                <div
                  ref={transcriptRef}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                    flex: 1,
                    overflowY: "auto",
                    padding: "8px 4px",
                  }}
                >
                  {messages.map((msg, i) => (
                    <TranscriptBubble key={i} msg={msg} />
                  ))}
                </div>
              )}
            </Card>
          </Col>
        </Row>
      </div>
    </>
  );
}
