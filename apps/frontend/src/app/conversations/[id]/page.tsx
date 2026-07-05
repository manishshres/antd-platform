"use client";

import React, { useEffect, useState } from "react";
import { Card, Typography, Skeleton, Alert, theme, Button, Space, Avatar, Divider } from "antd";
import { ArrowLeftOutlined, RobotOutlined, UserOutlined } from "@ant-design/icons";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { ErrorState } from "@/components/PageStates";
import { useParams, useRouter } from "next/navigation";
import dayjs from "dayjs";

const { Text, Paragraph } = Typography;

interface Message {
  role: "user" | "assistant" | "system";
  text: string;
  sentAt?: string;
}

interface Conversation {
  id: string;
  callSessionId: string;
  messages: Message[];
  createdAt: string;
}

export default function ConversationDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { token } = theme.useToken();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchConversation() {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get<{ data: Conversation }>(`/conversations/${id}`);
        if (!cancelled) setConversation(res.data.data || (res.data as unknown as Conversation));
      } catch {
        if (!cancelled) setError("Failed to load conversation details");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchConversation();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <div style={{ maxWidth: 800, margin: "0 auto", padding: token.paddingLG }}>
        <Skeleton active paragraph={{ rows: 1 }} title={{ width: 200 }} style={{ marginBottom: token.marginLG }} />
        <Card>
          <Skeleton active avatar paragraph={{ rows: 2 }} style={{ marginBottom: token.marginLG }} />
          <Skeleton active avatar paragraph={{ rows: 2 }} />
        </Card>
      </div>
    );
  }

  if (error || !conversation) {
    return (
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        <ErrorState
          message={error || "Conversation not found"}
          onRetry={() => router.push("/conversations")}
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <PageHeader
        overline={
          <Button size="small" type="text" icon={<ArrowLeftOutlined />} onClick={() => router.push("/conversations")}>
            Back to Conversations
          </Button>
        }
        title="Conversation Thread"
        subtitle={`Call Session: ${conversation.callSessionId}`}
        actions={<Text type="secondary">{dayjs(conversation.createdAt).format("MMM D, YYYY h:mm A")}</Text>}
      />

      <Card>
        <Divider style={{ marginTop: 0 }} />

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {conversation.messages?.map((msg, idx) => {
            const isUser = msg.role === "user";
            return (
              <div
                key={idx}
                style={{
                  display: "flex",
                  gap: 12,
                  flexDirection: isUser ? "row-reverse" : "row",
                  alignItems: "flex-start",
                }}
              >
                <Avatar
                  icon={isUser ? <UserOutlined /> : <RobotOutlined />}
                  style={{ backgroundColor: isUser ? token.colorPrimary : "#faad14" }}
                />
                <div
                  style={{
                    maxWidth: "75%",
                    padding: "12px 16px",
                    backgroundColor: isUser ? token.colorPrimary : token.colorBgElevated,
                    color: isUser ? "#fff" : token.colorText,
                    borderRadius: 12,
                    borderTopRightRadius: isUser ? 0 : 12,
                    borderTopLeftRadius: isUser ? 12 : 0,
                    boxShadow: token.boxShadowTertiary,
                  }}
                >
                  <Text style={{ color: "inherit" }}>{msg.text}</Text>
                  {msg.sentAt && (
                    <div style={{ marginTop: 4, textAlign: isUser ? "right" : "left", opacity: 0.7, fontSize: 11 }}>
                      {dayjs(msg.sentAt).format("h:mm A")}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {(!conversation.messages || conversation.messages.length === 0) && (
            <div style={{ textAlign: "center", padding: 40 }}>
              <Text type="secondary">No messages recorded for this conversation.</Text>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
