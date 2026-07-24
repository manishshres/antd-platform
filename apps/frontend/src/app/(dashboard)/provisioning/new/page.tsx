"use client";

import React, { useState, useEffect } from "react";
import { Card, Steps, Form, Input, Button, Space, Typography, Select, message, Result, Divider, Alert, Upload, Radio } from "antd";
import { AppstoreAddOutlined, RocketOutlined, UploadOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { CreateOrgProvisionDto } from "../../platform-admin/types";

const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;

const steps = [
  { title: "Business Info" },
  { title: "Location" },
  { title: "Phone Number" },
  { title: "AI Agent" },
  { title: "Agent Config" },
  { title: "Menu Import" },
  { title: "Users" },
  { title: "Review" },
];

export default function ProvisioningWizardPage() {
  const [current, setCurrent] = useState(0);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const stepFields = [
    ["orgName", "website"], // Step 0
    ["locationName", "address", "city", "state", "zip", "country"], // Step 1
    ["phoneNumber"], // Step 2
    ["baseAgentId"], // Step 3
    [], // Step 4 (Dynamic variables, no validation needed)
    ["menuUrl"], // Step 5
    ["adminEmail"], // Step 6
  ];

  const [availableNumbers, setAvailableNumbers] = useState<{phoneNumber: string, formatted: string}[]>([]);
  const [loadingNumbers, setLoadingNumbers] = useState(false);

  const [aiAgents, setAiAgents] = useState<{id: string, name: string, dynamicVariables?: Record<string, string>}[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);

  useEffect(() => {
    const fetchAgents = async () => {
      setLoadingAgents(true);
      try {
        const res = await api.get('/admin/organizations/ai-agents');
        setAiAgents(res.data);
      } catch (err) {
        console.error("Failed to load AI Agents", err);
      } finally {
        setLoadingAgents(false);
      }
    };
    fetchAgents();
  }, []);

  const searchPhoneNumbers = async () => {
    setLoadingNumbers(true);
    try {
      const country = form.getFieldValue("country") || "US";
      const state = form.getFieldValue("state");
      const city = form.getFieldValue("city");
      
      const query = new URLSearchParams({ country });
      if (state) query.append("state", state);
      if (city) query.append("city", city);

      const res = await api.get(`/admin/organizations/available-numbers?${query.toString()}`);
      setAvailableNumbers(res.data);
      if (res.data.length === 0) {
        message.warning("No phone numbers found for this location. Try searching a different city.");
      }
    } catch (err) {
      message.error("Failed to fetch available phone numbers.");
    } finally {
      setLoadingNumbers(false);
    }
  };

  const next = async () => {
    try {
      const fieldsToValidate = stepFields[current];
      if (fieldsToValidate) {
        await form.validateFields(fieldsToValidate);
      } else {
        await form.validateFields();
      }
      
      const nextStep = current + 1;
      setCurrent(nextStep);
      
      if (nextStep === 2 && availableNumbers.length === 0) {
        searchPhoneNumbers();
      }
    } catch (error) {
      // Form validation failed, do not advance
    }
  };

  const prev = () => {
    setCurrent(current - 1);
  };

  const onFinish = async (values: any) => {
    setSubmitting(true);
    try {
      const payload: CreateOrgProvisionDto = {
        orgName: values.orgName,
        adminEmail: values.adminEmail,
        locationName: values.locationName,
        country: values.country || "US",
        state: values.state,
        city: values.city,
        phoneNumber: values.phoneNumber,
        baseAgentId: values.baseAgentId,
        dynamicVariables: values.dynamicVariables,
        menuUrl: values.menuUrl,
      };

      await api.post("/admin/organizations", payload);
      setSuccess(true);
    } catch (err) {
      message.error("Failed to provision organization.");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div style={{ maxWidth: 800, margin: "40px auto" }}>
        <Result
          status="success"
          title="Organization Provisioned Successfully!"
          subTitle="The automated provisioning jobs have been queued. The administrator will receive an email shortly."
          extra={[
            <Button type="primary" key="dashboard" onClick={() => router.push("/platform-admin")}>
              Go to Platform Admin
            </Button>,
            <Button key="new" onClick={() => {
              setSuccess(false);
              setCurrent(0);
              form.resetFields();
            }}>
              Provision Another
            </Button>,
          ]}
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 0" }}>
      <PageHeader
        title={<><RocketOutlined style={{ color: "#1677ff", marginRight: 12 }} />New Tenant Provisioning</>}
        subtitle="Follow the 8-step wizard to set up a new organization."
      />

      <Steps current={current} items={steps} style={{ marginBottom: 40 }} size="small" titlePlacement="vertical" />

      <Card style={{ minHeight: 450 }}>
        <Form form={form} layout="vertical" onFinish={onFinish}>
          
          {/* Step 0: Business Info */}
          <div style={{ display: current === 0 ? "block" : "none" }}>
            <Title level={4}>Business Information</Title>
            <Divider />
            <Form.Item name="orgName" label="Business Name" rules={[{ required: true, message: "Required" }]}>
              <Input size="large" placeholder="e.g. Acme Burger" />
            </Form.Item>
            <Form.Item name="website" label="Website (Optional)">
              <Input size="large" placeholder="https://acmeburger.com" />
            </Form.Item>
          </div>

          {/* Step 1: Location */}
          <div style={{ display: current === 1 ? "block" : "none" }}>
            <Title level={4}>Primary Location</Title>
            <Divider />
            <Form.Item name="locationName" label="Location Name" rules={[{ required: true, message: "Required" }]}>
              <Input size="large" placeholder="e.g. Downtown Branch" />
            </Form.Item>
            <Form.Item name="address" label="Street Address" rules={[{ required: true }]}>
              <Input size="large" />
            </Form.Item>
            <Space orientation="horizontal" style={{ width: '100%' }}>
              <Form.Item name="city" label="City" style={{ width: '100%' }} rules={[{ required: true }]}>
                <Input size="large" />
              </Form.Item>
              <Form.Item name="state" label="State/Province" style={{ width: '100%' }} rules={[{ required: true }]}>
                <Input size="large" />
              </Form.Item>
            </Space>
            <Space orientation="horizontal" style={{ width: '100%' }}>
              <Form.Item name="zip" label="Postal Code" style={{ width: '100%' }} rules={[{ required: true }]}>
                <Input size="large" />
              </Form.Item>
              <Form.Item name="country" label="Country" initialValue="US" style={{ width: '100%' }} rules={[{ required: true }]}>
                <Select size="large">
                  <Option value="US">United States</Option>
                  <Option value="CA">Canada</Option>
                  <Option value="UK">United Kingdom</Option>
                </Select>
              </Form.Item>
            </Space>
          </div>

          {/* Step 2: Phone Number */}
          <div style={{ display: current === 2 ? "block" : "none" }}>
            <Title level={4}>Phone Number</Title>
            <Divider />
            <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
              Select a local phone number for your AI agent based on the provided location.
            </Text>
            <Form.Item name="phoneNumber" label="Available Numbers" rules={[{ required: true, message: "Please select a phone number" }]}>
              <Radio.Group disabled={loadingNumbers || availableNumbers.length === 0}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {availableNumbers.map((n) => (
                    <Radio key={n.phoneNumber} value={n.phoneNumber}>
                      {n.formatted}
                    </Radio>
                  ))}
                </div>
              </Radio.Group>
            </Form.Item>
            <Button onClick={searchPhoneNumbers} loading={loadingNumbers}>
              Search Again
            </Button>
          </div>

          {/* Step 3: AI Agent */}
          <div style={{ display: current === 3 ? "block" : "none" }}>
            <Title level={4}>AI Agent Selection</Title>
            <Divider />
            <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
              Select a Base AI Agent from Telnyx to clone for this location.
            </Text>
            <Form.Item name="baseAgentId" label="Telnyx Base Agent" rules={[{ required: true, message: "Please select an agent" }]}>
              <Select size="large" placeholder="Select an AI Agent" loading={loadingAgents} disabled={loadingAgents || aiAgents.length === 0}>
                {aiAgents.map((agent) => (
                  <Option key={agent.id} value={agent.id}>
                    {agent.name} ({agent.id})
                  </Option>
                ))}
              </Select>
            </Form.Item>
          </div>

          {/* Step 4: Agent Config */}
          <div style={{ display: current === 4 ? "block" : "none" }}>
            <Title level={4}>Agent Configuration</Title>
            <Divider />
            {(() => {
              const selectedAgentId = form.getFieldValue("baseAgentId");
              const selectedAgent = aiAgents.find(a => a.id === selectedAgentId);
              const dynamicVars = selectedAgent?.dynamicVariables || {};
              const hasVars = Object.keys(dynamicVars).length > 0;

              return hasVars ? (
                <>
                  <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
                    Configure the dynamic variables for the selected AI Agent.
                  </Text>
                  {Object.entries(dynamicVars).map(([key, value]) => (
                    <Form.Item key={key} name={["dynamicVariables", key]} label={key} initialValue={value}>
                      <Input size="large" />
                    </Form.Item>
                  ))}
                </>
              ) : (
                <Text type="secondary">This agent does not have any dynamic variables configured. You can proceed to the next step.</Text>
              );
            })()}
          </div>

          {/* Step 5: Menu Import */}
          <div style={{ display: current === 5 ? "block" : "none" }}>
            <Title level={4}>Menu Import</Title>
            <Divider />
            <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
              Import a menu so the AI agent knows what to sell.
            </Text>
            <Form.Item name="menuUrl" label="Menu URL (to scrape)">
              <Input size="large" placeholder="https://example.com/menu" />
            </Form.Item>
            <Form.Item label="Or Upload CSV">
              <Upload>
                <Button icon={<UploadOutlined />}>Upload Menu CSV</Button>
              </Upload>
            </Form.Item>
          </div>

          {/* Step 6: Users */}
          <div style={{ display: current === 6 ? "block" : "none" }}>
            <Title level={4}>Users</Title>
            <Divider />
            <Form.Item name="adminEmail" label="Administrator Email" rules={[{ required: true, type: "email", message: "Valid email required" }]}>
              <Input size="large" placeholder="admin@acmeburger.com" />
            </Form.Item>
            <Text type="secondary">An invitation will be sent to this email to claim the account.</Text>
          </div>

          {/* Step 7: Review */}
          <div style={{ display: current === 7 ? "block" : "none" }}>
            <Title level={4}>Review Configuration</Title>
            <Divider />
            <Card type="inner" title="Summary" size="small">
              <Form.Item shouldUpdate>
                {() => (
                  <ul style={{ lineHeight: "2" }}>
                    <li><strong>Organization:</strong> {form.getFieldValue("orgName") || "—"}</li>
                    <li><strong>Admin Email:</strong> {form.getFieldValue("adminEmail") || "—"}</li>
                    <li><strong>Primary Location:</strong> {form.getFieldValue("locationName") || "—"}</li>
                    <li><strong>Address:</strong> {form.getFieldValue("address")}, {form.getFieldValue("city")}, {form.getFieldValue("state")} {form.getFieldValue("zip")} {form.getFieldValue("country")}</li>
                    <li><strong>Phone Number:</strong> {form.getFieldValue("phoneNumber") || "—"}</li>
                    <li><strong>Base Agent ID:</strong> {form.getFieldValue("baseAgentId") || "—"}</li>
                  </ul>
                )}
              </Form.Item>
            </Card>
            <Alert style={{ marginTop: 24 }} type="info" showIcon title="Submitting will queue several background jobs to scaffold the tenant's database schema, seed initial data, and email the administrator." />
          </div>

          {/* Navigation Controls */}
          <div style={{ marginTop: 32, display: "flex", justifyContent: "space-between" }}>
            <Button onClick={() => router.push("/platform-admin")}>
              Cancel
            </Button>
            <Space>
              {current > 0 && (
                <Button style={{ margin: "0 8px" }} onClick={() => prev()}>
                  Previous
                </Button>
              )}
              {current < steps.length - 1 && (
                <Button type="primary" onClick={() => next()}>
                  Next
                </Button>
              )}
              {current === steps.length - 1 && (
                <Button type="primary" htmlType="submit" loading={submitting} icon={<AppstoreAddOutlined />}>
                  Provision Tenant
                </Button>
              )}
            </Space>
          </div>
        </Form>
      </Card>
    </div>
  );
}
