"use client";

import React, { useState, useEffect, useCallback } from "react";
import { 
  Table, 
  Card, 
  Typography, 
  Input, 
  Button, 
  Tag, 
  DatePicker,
  App,
  Row,
  Col,
  theme
} from "antd";
import { 
  SearchOutlined, 
  DownloadOutlined, 
  ReloadOutlined,
  HistoryOutlined
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { AuditLog, AuditLogsResponse } from "./types";
import dayjs from "dayjs";

const { Text } = Typography;
const { RangePicker } = DatePicker;

export default function AuditLogsPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  
  // Filters
  const [actionFilter, setActionFilter] = useState("");
  const [entityTypeFilter, setEntityTypeFilter] = useState("");
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([null, null]);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const loadLogs = useCallback(async (page = 1, size = 20) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        offset: ((page - 1) * size).toString(),
        limit: size.toString(),
      });
      
      if (actionFilter) params.append("action", actionFilter);
      if (entityTypeFilter) params.append("entityType", entityTypeFilter);
      if (dateRange[0]) params.append("startDate", dateRange[0].toISOString());
      if (dateRange[1]) params.append("endDate", dateRange[1].toISOString());

      const { data } = await api.get<AuditLogsResponse>(`/audit-logs?${params.toString()}`);
      setLogs(data.data);
      setTotal(data.meta.total);
    } catch (err) {
      console.error(err);
      message.error("Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, [actionFilter, entityTypeFilter, dateRange]);

  useEffect(() => {
    Promise.resolve().then(() => {
      loadLogs(currentPage, pageSize);
    });
  }, [loadLogs, currentPage, pageSize]);

  const handleExportCSV = () => {
    if (logs.length === 0) {
      message.warning("No data to export");
      return;
    }
    
    // Create CSV content
    const headers = ["Timestamp", "User Email", "Action", "Entity Type", "Entity ID", "IP Address", "User Agent"];
    const rows = logs.map(log => [
      new Date(log.createdAt).toISOString(),
      log.userEmail || log.userId || "System",
      log.action,
      log.entityType || "",
      log.entityId || "",
      log.ipAddress || "",
      `"${(log.userAgent || "").replace(/"/g, '""')}"`
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n" 
      + rows.map(e => e.join(",")).join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `audit-logs-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const columns: ColumnsType<AuditLog> = [
    {
      title: "Timestamp",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (val: string) => new Date(val).toLocaleString(),
    },
    {
      title: "User",
      key: "user",
      render: (_, record) => {
        if (record.userEmail) {
          return (
            <div>
              <Text style={{ fontWeight: 600 }}>{record.userName || "User"}</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>{record.userEmail}</Text>
            </div>
          );
        }
        return <Tag>SYSTEM</Tag>;
      },
    },
    {
      title: "Action",
      dataIndex: "action",
      key: "action",
      render: (val: string) => <Tag color="blue">{val}</Tag>,
    },
    {
      title: "Entity",
      key: "entity",
      render: (_, record) => {
        if (!record.entityType) return <Text type="secondary">—</Text>;
        return (
          <div>
            <Text code>{record.entityType}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 11 }}>{record.entityId}</Text>
          </div>
        );
      },
    },
    {
      title: "IP Address",
      dataIndex: "ipAddress",
      key: "ipAddress",
      render: (val: string | null) => val || "—",
    },
  ];

  return (
    <div style={{ paddingBottom: 40 }}>
      <PageHeader
        title={<><HistoryOutlined style={{ marginRight: 8, color: token.colorPrimary }} />Audit Logs</>}
        subtitle="Review system actions and changes for security and compliance."
        actions={
          <>
            <Button icon={<DownloadOutlined />} onClick={handleExportCSV}>
              Export CSV
            </Button>
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              onClick={() => loadLogs(currentPage, pageSize)}
              loading={loading}
            >
              Refresh
            </Button>
          </>
        }
      />

      <Card style={{ marginBottom: 24 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={6}>
            <Input 
              placeholder="Filter by Action (e.g. user.create)" 
              prefix={<SearchOutlined />}
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              onPressEnter={() => { setCurrentPage(1); loadLogs(1, pageSize); }}
              allowClear
            />
          </Col>
          <Col xs={24} md={6}>
            <Input 
              placeholder="Filter by Entity Type (e.g. menu_item)" 
              prefix={<SearchOutlined />}
              value={entityTypeFilter}
              onChange={(e) => setEntityTypeFilter(e.target.value)}
              onPressEnter={() => { setCurrentPage(1); loadLogs(1, pageSize); }}
              allowClear
            />
          </Col>
          <Col xs={24} md={8}>
            <RangePicker 
              style={{ width: '100%' }}
              onChange={(dates) => {
                setDateRange(dates as [dayjs.Dayjs | null, dayjs.Dayjs | null]);
                setCurrentPage(1);
              }}
              allowClear
            />
          </Col>
          <Col xs={24} md={4}>
            <Button type="primary" block onClick={() => { setCurrentPage(1); loadLogs(1, pageSize); }}>
              Apply Filters
            </Button>
          </Col>
        </Row>
      </Card>

      <Card styles={{ body: { padding: 0 } }} style={{ borderRadius: 4, overflow: "hidden" }}>
        <Table
          columns={columns}
          dataSource={logs}
          rowKey="id"
          loading={loading}
          pagination={{
            current: currentPage,
            pageSize: pageSize,
            total: total,
            showSizeChanger: true,
            onChange: (page, size) => {
              setCurrentPage(page);
              setPageSize(size);
            },
          }}
          expandable={{
            expandedRowRender: (record) => (
              <Row gutter={24} style={{ padding: '8px 16px', background: '#fafafa' }}>
                <Col span={12}>
                  <Text strong>Previous Value</Text>
                  <pre style={{ 
                    background: '#fff', 
                    padding: 12, 
                    border: '1px solid #e8e8e8', 
                    borderRadius: 4,
                    fontSize: 12,
                    maxHeight: 300,
                    overflow: 'auto',
                    marginTop: 8
                  }}>
                    {record.previousValue ? JSON.stringify(record.previousValue, null, 2) : "None (or initially created)"}
                  </pre>
                </Col>
                <Col span={12}>
                  <Text strong>New Value</Text>
                  <pre style={{ 
                    background: '#fff', 
                    padding: 12, 
                    border: '1px solid #e8e8e8', 
                    borderRadius: 4,
                    fontSize: 12,
                    maxHeight: 300,
                    overflow: 'auto',
                    marginTop: 8
                  }}>
                    {record.newValue ? JSON.stringify(record.newValue, null, 2) : "None (or deleted)"}
                  </pre>
                </Col>
                <Col span={24} style={{ marginTop: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    <strong>User Agent:</strong> {record.userAgent || "Unknown"}
                  </Text>
                </Col>
              </Row>
            ),
          }}
        />
      </Card>
    </div>
  );
}
