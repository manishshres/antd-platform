"use client";

import React from "react";
import { Input, Button, Space, theme } from "antd";
import { SearchOutlined, DownloadOutlined, ReloadOutlined } from "@ant-design/icons";

interface TableToolbarProps {
  /** Current search text (controlled). */
  search?: string;
  /** Called as the user types in the search box. Omit to hide the search box. */
  onSearchChange?: (value: string) => void;
  /** Placeholder for the search box. */
  searchPlaceholder?: string;
  /** Extra filter controls rendered next to the search box (Selects, DatePickers, etc.). */
  filters?: React.ReactNode;
  /** Called when the export button is clicked. Omit to hide the export button. */
  onExport?: () => void;
  /** Called when the refresh button is clicked. Omit to hide the refresh button. */
  onRefresh?: () => void;
  /** Right-aligned primary actions (e.g. "New order"). */
  actions?: React.ReactNode;
}

/**
 * Standardised toolbar row for data tables (E2): a search box, optional inline filters, and
 * export/refresh affordances on one side with primary actions on the other. Keeps every list
 * page's controls visually consistent instead of each page hand-rolling its own layout.
 * Theme-token only — no hardcoded colors or spacing.
 */
export default function TableToolbar({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  filters,
  onExport,
  onRefresh,
  actions,
}: TableToolbarProps) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: token.margin,
        flexWrap: "wrap",
        marginBottom: token.margin,
      }}
    >
      <Space size={token.marginXS} wrap>
        {onSearchChange && (
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{ width: 260, maxWidth: "100%" }}
          />
        )}
        {filters}
      </Space>
      <Space size={token.marginXS} wrap>
        {onRefresh && (
          <Button icon={<ReloadOutlined />} onClick={onRefresh} aria-label="Refresh">
            Refresh
          </Button>
        )}
        {onExport && (
          <Button icon={<DownloadOutlined />} onClick={onExport} aria-label="Export">
            Export
          </Button>
        )}
        {actions}
      </Space>
    </div>
  );
}
