"use client";
import { useRouter } from "next/navigation";

import React, { useState, useEffect, useCallback } from "react";
import {
  Table,
  Card,
  Typography,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Popconfirm,
  Tooltip,
  App,
  Tabs,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  LogoutOutlined,
  UserOutlined,
  MailOutlined,
  LockOutlined,
} from "@ant-design/icons";
import { api } from "@/lib/api";
import { useLocation } from "@/contexts/LocationContext";
import PageHeader from "@/components/PageHeader";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

const { Text } = Typography;
const { Option } = Select;

interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
  lastLoginAt?: string;
  status: string;
  organization?: { id: string; name: string };
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  token: string;
  expiresAt: string;
  createdAt: string;
}

export default function UsersPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [users, setUsers] = useState<User[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const { locations } = useLocation();
  
  const [form] = Form.useForm();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const storedToken = localStorage.getItem("access_token");
      let platformAdmin = false;
      if (storedToken) {
        try {
          const payload = storedToken.split(".")[1];
          const decoded = JSON.parse(window.atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
          const r = decoded.role?.toLowerCase() || "";
          platformAdmin = decoded.r === "sysadmin" || r === "platform_admin";
          setIsPlatformAdmin(platformAdmin);
        } catch {}
      }

      const endpoint = platformAdmin ? "/users/global?limit=100" : "/users?limit=100";
      const { data } = await api.get<{ data: User[] }>(endpoint);
      setUsers(data.data || []);
    } catch (err) {
      console.error(err);
      message.error("Failed to fetch users");
    } finally {
      setLoading(false);
    }
  }, [message]);

  const fetchInvitations = useCallback(async () => {
    setInvitesLoading(true);
    try {
      const { data } = await api.get<Invitation[]>("/invitations");
      setInvitations(data);
    } catch (err) {
      // It's possible the user doesn't have permissions or org isn't set, just ignore quietly for now
    } finally {
      setInvitesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchInvitations();
  }, [fetchUsers, fetchInvitations]);

  const handleInviteUser = async (values: Record<string, string>) => {
    try {
      const { email, role, locationId } = values;
      await api.post("/invitations", { email, role, locationId });
      message.success("Invitation sent successfully");
      setModalVisible(false);
      form.resetFields();
      fetchInvitations();
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { message?: string | string[] } } };
      const msg = errorResponse.response?.data?.message || "Failed to send invitation";
      message.error(Array.isArray(msg) ? msg.join(", ") : msg);
    }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      const endpoint = isPlatformAdmin ? `/users/global/${id}` : `/users/${id}`;
      await api.delete(endpoint);
      message.success("User deleted successfully");
      fetchUsers();
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { message?: string | string[] } } };
      const msg = errorResponse.response?.data?.message || "Failed to delete user";
      message.error(Array.isArray(msg) ? msg.join(", ") : msg);
    }
  };

  const handleForceLogout = async (id: string) => {
    try {
      const endpoint = isPlatformAdmin ? `/users/global/${id}/force-logout` : `/users/${id}/force-logout`;
      await api.post(endpoint);
      message.success("User sessions revoked successfully");
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { message?: string | string[] } } };
      const msg = errorResponse.response?.data?.message || "Failed to force logout";
      message.error(Array.isArray(msg) ? msg.join(", ") : msg);
    }
  };

  const handleRevokeInvite = async (id: string) => {
    try {
      await api.delete(`/invitations/${id}`);
      message.success("Invitation revoked");
      fetchInvitations();
    } catch (err) {
      message.error("Failed to revoke invitation");
    }
  };

  const handleResendInvite = async (id: string) => {
    try {
      await api.post(`/invitations/${id}/resend`);
      message.success("Invitation resent");
    } catch (err) {
      message.error("Failed to resend invitation");
    }
  };

  const baseColumns = [
    {
      title: "Name",
      key: "name",
      render: (_: unknown, record: User) => (
        <Space orientation="vertical" size={0}>
          <Text strong>
            {record.firstName || record.lastName
              ? `${record.firstName || ""} ${record.lastName || ""}`.trim()
              : "Unknown"}
          </Text>
          <Text type="secondary">{record.email}</Text>
        </Space>
      ),
    },
    {
      title: "Role",
      dataIndex: "role",
      key: "role",
      render: (role: string) => {
        const colorMap: Record<string, string> = {
          sysadmin: "red",
          admin: "orange",
          manager: "blue",
          user: "default",
          platform_admin: "purple",
        };
        return <Tag color={colorMap[role] || "default"}>{(role || "unknown").toUpperCase()}</Tag>;
      },
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (status: string) => (
        <Tag color={status === "active" ? "success" : status === "locked" ? "error" : "warning"}>
          {(status || "unknown").toUpperCase()}
        </Tag>
      ),
    },
    {
      title: "Last Login",
      dataIndex: "lastLoginAt",
      key: "lastLoginAt",
      render: (date: string) => (date ? new Date(date).toLocaleString() : "Never"),
    },
    {
      title: "Actions",
      key: "actions",
      render: (_: unknown, record: User) => (
        <Space>
          <Tooltip title="Force Logout (Revoke Sessions)">
            <Popconfirm title="Force logout this user?" onConfirm={() => handleForceLogout(record.id)}>
              <Button size="small" icon={<LogoutOutlined />} />
            </Popconfirm>
          </Tooltip>
          <Tooltip title="Edit User">
            <Button size="small" icon={<EditOutlined />} onClick={() => message.info("Edit user coming soon")} />
          </Tooltip>
          <Tooltip title="Delete User">
            <Popconfirm title="Are you sure you want to delete this user?" onConfirm={() => handleDeleteUser(record.id)} okText="Yes" cancelText="No">
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Tooltip>
        </Space>
      ),
    },
  ];

  const columns = isPlatformAdmin
    ? [
        ...baseColumns.slice(0, 2),
        {
          title: "Organization",
          key: "organization",
          render: (_: unknown, record: User) =>
            record.organization ? <Text>{record.organization.name}</Text> : <Text type="secondary">None</Text>,
        },
        ...baseColumns.slice(2),
      ]
    : baseColumns;

  const inviteColumns = [
    { title: "Email", dataIndex: "email", key: "email" },
    { title: "Role", dataIndex: "role", key: "role", render: (r: string) => <Tag color="blue">{r}</Tag> },
    { title: "Status", dataIndex: "status", key: "status", render: (s: string) => <Tag color={s === "pending" ? "orange" : "green"}>{(s || "unknown").toUpperCase()}</Tag> },
    { title: "Sent", dataIndex: "createdAt", key: "createdAt", render: (d: string) => dayjs(d).format("MMM D, YYYY") },
    { title: "Expires", dataIndex: "expiresAt", key: "expiresAt", render: (d: string) => dayjs(d).fromNow() },
    {
      title: "Actions",
      key: "actions",
      render: (_: any, record: Invitation) => (
        <Space>
          <Button size="small" onClick={() => {
            navigator.clipboard.writeText(`${window.location.origin}/invite?token=${record.token}`);
            message.success("Invite link copied to clipboard");
          }}>Copy Link</Button>
          <Button size="small" onClick={() => handleResendInvite(record.id)}>Resend</Button>
          <Popconfirm title="Revoke invitation?" onConfirm={() => handleRevokeInvite(record.id)}>
            <Button size="small" danger>Revoke</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div>
      <PageHeader
        title="User Management"
        subtitle="Manage team members, roles, and platform access."
        actions={
          !isPlatformAdmin && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
              Invite User
            </Button>
          )
        }
      />

      <Card styles={{ body: { padding: 0 } }}>
        <Tabs
          defaultActiveKey="team"
          tabBarStyle={{ padding: '0 24px', margin: 0 }}
          items={[
            {
              key: "team",
              label: "Team Members",
              children: (
                <div style={{ padding: 24 }}>
                  <Table
                    columns={columns}
                    dataSource={users}
                    rowKey="id"
                    loading={loading}
                    pagination={{ pageSize: 10 }}
                  />
                </div>
              )
            },
            {
              key: "invites",
              label: "Pending Invitations",
              children: (
                <div style={{ padding: 24 }}>
                  <Table
                    columns={inviteColumns}
                    dataSource={invitations}
                    rowKey="id"
                    loading={invitesLoading}
                    pagination={{ pageSize: 10 }}
                  />
                </div>
              )
            }
          ]}
        />
      </Card>

      <Modal forceRender
        title={
          <Space>
            <UserOutlined />
            <span>Invite Team Member</span>
          </Space>
        }
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
        }}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={handleInviteUser} style={{ marginTop: 24 }}>
          <Form.Item name="email" label="Email Address" rules={[{ required: true, type: "email" }]}>
            <Input prefix={<MailOutlined />} placeholder="user@example.com" />
          </Form.Item>

          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select placeholder="Select a role">
              <Option value="admin">Admin (Full Access)</Option>
              <Option value="manager">Manager (Single Location)</Option>
              <Option value="user">User (View Only)</Option>
            </Select>
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => prevValues.role !== currentValues.role}
          >
            {({ getFieldValue }) =>
              getFieldValue("role") === "manager" ? (
                <Form.Item name="locationId" label="Assign Location (Required for Manager)" rules={[{ required: true, message: "Please select a location" }]}>
                  <Select placeholder="Select a location">
                    {locations.map((loc) => (
                      <Option key={loc.id} value={loc.id}>{loc.name}</Option>
                    ))}
                  </Select>
                </Form.Item>
              ) : null
            }
          </Form.Item>

          <Form.Item style={{ marginTop: 32, marginBottom: 0, textAlign: "right" }}>
            <Space>
              <Button onClick={() => setModalVisible(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit">
                Send Invitation
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
