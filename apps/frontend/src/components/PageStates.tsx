"use client";

import React from "react";
import { Empty, Result, Button, Skeleton, Card, theme } from "antd";
import { ReloadOutlined } from "@ant-design/icons";

/**
 * Consistent empty / error / loading states so every data page speaks the same visual language
 * instead of improvising its own (E4). Theme-token driven, Ant Design components only.
 */

interface EmptyStateProps {
  description: React.ReactNode;
  /** Optional call-to-action button (e.g. "Create your first order"). */
  cta?: { label: string; onClick: () => void; icon?: React.ReactNode };
  image?: React.ReactNode;
}

export function EmptyState({ description, cta, image }: EmptyStateProps) {
  const { token } = theme.useToken();
  return (
    <Empty
      image={image ?? Empty.PRESENTED_IMAGE_SIMPLE}
      description={description}
      style={{ padding: `${token.paddingXL}px 0` }}
    >
      {cta && (
        <Button type="primary" icon={cta.icon} onClick={cta.onClick}>
          {cta.label}
        </Button>
      )}
    </Empty>
  );
}

interface ErrorStateProps {
  /** Short human-readable message. */
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <Result
      status="error"
      title="Something went wrong"
      subTitle={message ?? "Failed to load this data. Please try again."}
      extra={
        onRetry
          ? [
              <Button
                key="retry"
                type="primary"
                icon={<ReloadOutlined />}
                onClick={onRetry}
              >
                Retry
              </Button>,
            ]
          : undefined
      }
    />
  );
}

/** Card-wrapped skeleton for data pages, matching the container styling of real content. */
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card variant="borderless">
      <Skeleton active paragraph={{ rows }} />
    </Card>
  );
}
