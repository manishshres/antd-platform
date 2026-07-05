"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  Upload,
  App,
  Modal,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile, RcFile } from "antd/es/upload/interface";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  InboxOutlined,
  QuestionCircleOutlined,
  SyncOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";

const { Text } = Typography;
const { Dragger } = Upload;

const ACCEPT = ".pdf,.json,.csv,.xlsx,.xls,.docx,.doc,.txt";
const EXT_COLORS: Record<string, string> = {
  pdf: "red",
  json: "gold",
  csv: "cyan",
  xlsx: "green",
  xls: "green",
  docx: "blue",
  doc: "blue",
  txt: "default",
};

interface KBDocument {
  id: string;
  filename?: string;
  name?: string;
  status?: string;
  size?: number;
  created_at?: string;
  content_type?: string;
}

function fileExt(doc: KBDocument): string {
  const name = doc.filename ?? doc.name ?? "";
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function StatusBadge({ status }: { status?: string }) {
  const s = (status ?? "").toLowerCase();
  if (s === "indexed" || s === "completed" || s === "ready") {
    return (
      <Space size={4}>
        <CheckCircleOutlined style={{ color: "#52c41a" }} />
        <Text style={{ color: "#52c41a", fontSize: 13 }}>Indexed</Text>
      </Space>
    );
  }
  if (s === "processing" || s === "pending" || s === "uploading") {
    return (
      <Space size={4}>
        <SyncOutlined spin style={{ color: "#fa8c16" }} />
        <Text style={{ color: "#fa8c16", fontSize: 13 }}>Processing</Text>
      </Space>
    );
  }
  if (s === "failed" || s === "error") {
    return (
      <Space size={4}>
        <CloseCircleOutlined style={{ color: "#ff4d4f" }} />
        <Text style={{ color: "#ff4d4f", fontSize: 13 }}>Failed</Text>
      </Space>
    );
  }
  return (
    <Space size={4}>
      <QuestionCircleOutlined style={{ color: "#8c8c8c" }} />
      <Text style={{ color: "#8c8c8c", fontSize: 13 }}>Pending</Text>
    </Space>
  );
}

function formatBytes(n?: number) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentationPage() {
  const { message: messageApi, modal } = App.useApp();
  const [docs, setDocs] = useState<KBDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);

  const load = useCallback(() => {
    Promise.resolve().then(() => {
      setLoading(true);
      setError(null);
    });
    api
      .get("/documents")
      .then(({ data }) => {
        const list = (data as { data?: KBDocument[] })?.data ?? (data as KBDocument[]) ?? [];
        setDocs(Array.isArray(list) ? list : []);
        setError(null);
      })
      .catch(() => setError("Failed to load documentation files."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => {
      load();
      if (typeof window !== "undefined") {
        const token = localStorage.getItem("access_token");
        if (token) {
          try {
            const payload = token.split(".")[1];
            const decoded = JSON.parse(window.atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { role?: string };
            setIsAdmin(["admin", "sysadmin"].includes(decoded.role?.toLowerCase() || ""));
          } catch {
            setIsAdmin(false);
          }
        }
      }
    });
  }, [load]);

  const handleUpload = async () => {
    if (fileList.length === 0) return;
    setUploading(true);
    let successCount = 0;
    let failCount = 0;

    for (const uf of fileList) {
      const form = new FormData();
      form.append("file", uf.originFileObj as Blob, uf.name);
      try {
        await api.post("/documents", form);
        successCount++;
      } catch (err) {
        failCount++;
        const reason =
          (err as { response?: { data?: { error?: string } } }).response?.data
            ?.error ?? "Upload failed.";
        messageApi.error(`${uf.name}: ${reason}`);
      }
    }

    if (successCount > 0) {
      messageApi.success(
        `${successCount} file${successCount > 1 ? "s" : ""} uploaded successfully.`,
      );
    }
    if (failCount === 0) {
      setUploadOpen(false);
      setFileList([]);
    }
    setUploading(false);
    load();
  };

  const handleDelete = (doc: KBDocument) => {
    modal.confirm({
      title: "Remove file?",
      content: `"${doc.filename ?? doc.name}" will be permanently deleted.`,
      okText: "Delete",
      okType: "danger",
      onOk: async () => {
        try {
          await api.delete(`/documents/${doc.id}`);
          messageApi.success("File removed.");
          load();
        } catch {
          messageApi.error("Failed to remove file.");
        }
      },
    });
  };

  const columns: ColumnsType<KBDocument> = [
    {
      title: "File",
      key: "file",
      render: (_: unknown, doc: KBDocument) => {
        const name = doc.filename ?? doc.name ?? "—";
        const ext = fileExt(doc);
        return (
          <Space>
            {ext && (
              <Tag color={EXT_COLORS[ext] ?? "default"}>
                {ext.toUpperCase()}
              </Tag>
            )}
            <Text>{name}</Text>
          </Space>
        );
      },
    },
    {
      title: "Size",
      dataIndex: "size",
      width: 100,
      render: formatBytes,
    },
    {
      title: "Status",
      key: "status",
      width: 130,
      render: (_: unknown, doc: KBDocument) => (
        <StatusBadge status={doc.status} />
      ),
    },
    {
      title: "Uploaded",
      dataIndex: "created_at",
      width: 170,
      render: (v: string) => (v ? new Date(v).toLocaleString() : "—"),
    },
    ...(isAdmin ? [{
      title: "",
      key: "actions",
      width: 60,
      render: (_: unknown, doc: KBDocument) => (
        <Button
          type='text'
          danger
          icon={<DeleteOutlined />}
          onClick={() => handleDelete(doc)}
        />
      ),
    }] : []),
  ];

  return (
    <>
      <PageHeader
        title="Documentation"
        subtitle="Manage your AI agent's knowledge base documents."
        actions={
          isAdmin && (
            <Button type='primary' icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>
              Upload Files
            </Button>
          )
        }
      />

      {error && (
        <Alert
          type='error'
          title={error}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
          <Spin size='large' />
        </div>
      ) : docs.length === 0 ? (
        <Alert
          type='info'
          title='No files yet'
          description='Upload PDFs, spreadsheets, Word documents, JSON, CSV, or plain text to build your documentation library.'
          showIcon
        />
      ) : (
        <Table
          columns={columns}
          dataSource={docs}
          rowKey='id'
          pagination={{ pageSize: 20 }}
        />
      )}

      <Modal
        title='Upload Documentation'
        open={uploadOpen}
        onCancel={() => {
          setUploadOpen(false);
          setFileList([]);
        }}
        onOk={handleUpload}
        okText='Upload'
        okButtonProps={{ loading: uploading, disabled: fileList.length === 0 }}
        width={560}
      >
        <div style={{ marginBottom: 12 }}>
          <Text type='secondary' style={{ fontSize: 12 }}>
            Supported: PDF, JSON, CSV, Excel (.xlsx/.xls), Word (.docx/.doc),
            Text — max 25 MB per file. Files are scanned for security risks
            before upload.
          </Text>
        </div>

        <Dragger
          multiple
          accept={ACCEPT}
          fileList={fileList}
          beforeUpload={(file: RcFile) => {
            setFileList((prev) => [...prev, file as unknown as UploadFile]);
            return false;
          }}
          onRemove={(file) => {
            setFileList((prev) => prev.filter((f) => f.uid !== file.uid));
          }}
          style={{ padding: "16px 0" }}
        >
          <p className='ant-upload-drag-icon'>
            <InboxOutlined style={{ fontSize: 40, color: "#1677ff" }} />
          </p>
          <p className='ant-upload-text'>Click or drag files here to upload</p>
          <p className='ant-upload-hint'>
            PDF · JSON · CSV · Excel · Word · Text
          </p>
        </Dragger>

        {fileList.length > 0 && (
          <div style={{ marginTop: 8, textAlign: "right" }}>
            <Badge count={fileList.length} color='#1677ff' />
            <Text type='secondary' style={{ marginLeft: 8, fontSize: 12 }}>
              file{fileList.length > 1 ? "s" : ""} ready
            </Text>
          </div>
        )}
      </Modal>
    </>
  );
}
