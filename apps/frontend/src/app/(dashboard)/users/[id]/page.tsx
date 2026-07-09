"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, Form, Input, Button, Select, Space, message, theme, Breadcrumb } from "antd";
import { ArrowLeftOutlined, SaveOutlined, UserOutlined, MailOutlined, PhoneOutlined } from "@ant-design/icons";
import { api } from "@/lib/api";
import { getAccessToken } from "@/lib/token-store";
import PageHeader from "@/components/PageHeader";


interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  companyName?: string;
  role: string;
  organizationId?: string;
}

export default function EditUserPage() {
  const { id } = useParams();
  const router = useRouter();
  const [form] = Form.useForm();
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  useEffect(() => {
    const storedToken = getAccessToken();
    let platformAdmin = false;
    if (storedToken) {
      try {
        const payload = storedToken.split(".")[1];
        const decoded = JSON.parse(window.atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
        const r = decoded.role?.toLowerCase() || "";
        platformAdmin = decoded.r === "sysadmin" || r === "platform_admin";
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsPlatformAdmin(platformAdmin);
      } catch {}
    }

    const fetchUser = async () => {
      try {
        const endpoint = platformAdmin ? `/users/global/${id}` : `/users/${id}`;
        const { data } = await api.get<User>(endpoint);
        form.setFieldsValue(data);
      } catch (error) {
        console.error(error);
        message.error("Failed to load user details");
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchUser();
    }
  }, [id, form]);

  const handleSave = async (values: Partial<User>) => {
    try {
      setSaving(true);
      const endpoint = isPlatformAdmin ? `/users/global/${id}` : `/users/${id}`;
      await api.patch(endpoint, values);
      message.success("User updated successfully");
      router.push("/users");
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { message?: string | string[] } } };
      const msg = errorResponse.response?.data?.message || "Failed to update user";
      message.error(Array.isArray(msg) ? msg.join(", ") : msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        overline={
          <Breadcrumb
            items={[
              { title: <a onClick={() => router.push("/users")}>Users</a> },
              { title: "Edit User" },
            ]}
          />
        }
        title={
          <Space size={8}>
            <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => router.push("/users")} />
            Edit User
          </Space>
        }
      />

      <Card loading={loading}>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          style={{ maxWidth: 600 }}
        >
          <Space orientation="horizontal" style={{ width: "100%" }}>
            <Form.Item name="firstName" label="First Name" style={{ width: "100%" }}>
              <Input prefix={<UserOutlined />} placeholder="Jane" />
            </Form.Item>
            <Form.Item name="lastName" label="Last Name" style={{ width: "100%" }}>
              <Input placeholder="Doe" />
            </Form.Item>
          </Space>
          
          <Form.Item
            name="email"
            label="Email Address"
            rules={[
              { required: true, message: "Email is required" },
              { type: "email", message: "Invalid email" },
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="jane@example.com" />
          </Form.Item>

          <Form.Item name="phoneNumber" label="Phone Number">
            <Input prefix={<PhoneOutlined />} placeholder="+15551234567" />
          </Form.Item>
          
          <Form.Item name="companyName" label="Company Name">
            <Input placeholder="Acme Corp" />
          </Form.Item>

          <Form.Item
            name="role"
            label="Role"
            rules={[{ required: true, message: "Please select a role" }]}
          >
            <Select>
              {isPlatformAdmin && <Select.Option value="sysadmin">System Admin</Select.Option>}
              {isPlatformAdmin && <Select.Option value="platform_admin">Platform Admin</Select.Option>}
              <Select.Option value="owner">Owner</Select.Option>
              <Select.Option value="admin">Admin</Select.Option>
              <Select.Option value="manager">Manager</Select.Option>
              <Select.Option value="user">User</Select.Option>
              <Select.Option value="viewer">Viewer</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item style={{ marginTop: token.marginLG }}>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>
                Save Changes
              </Button>
              <Button onClick={() => router.push("/users")}>Cancel</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
