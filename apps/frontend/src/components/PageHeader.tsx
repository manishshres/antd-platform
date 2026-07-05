"use client";

import React from "react";
import { Typography, Space, theme } from "antd";

const { Title, Text } = Typography;

interface PageHeaderProps {
  /** Main page title. */
  title: React.ReactNode;
  /** Optional secondary line under the title. */
  subtitle?: React.ReactNode;
  /** Right-aligned actions (primary button, filters, export, etc.). */
  actions?: React.ReactNode;
  /** Optional element rendered above the title (e.g. breadcrumbs). */
  overline?: React.ReactNode;
}

/**
 * Consistent page header used across dashboard pages so title/subtitle/action placement and
 * spacing are uniform instead of every page hand-rolling its own <Title> (E4). Uses theme
 * tokens only — no hardcoded colors or spacing.
 */
export default function PageHeader({
  title,
  subtitle,
  actions,
  overline,
}: PageHeaderProps) {
  const { token } = theme.useToken();
  return (
    <div style={{ marginBottom: token.margin }}>
      {overline && <div style={{ marginBottom: token.marginXXS }}>{overline}</div>}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: token.margin,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Title level={4} style={{ margin: 0 }}>
            {title}
          </Title>
          {subtitle && (
            <Text type="secondary" style={{ fontSize: token.fontSize }}>
              {subtitle}
            </Text>
          )}
        </div>
        {actions && (
          <Space size={token.marginXS} wrap>
            {actions}
          </Space>
        )}
      </div>
    </div>
  );
}
