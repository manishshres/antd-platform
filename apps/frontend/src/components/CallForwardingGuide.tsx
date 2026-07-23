"use client";

import React, { useState } from "react";
import { Card, Select, Typography, Tag, theme, Space, Steps } from "antd";
import {
  PhoneOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons";

const { Text, Paragraph } = Typography;

interface ProviderInfo {
  name: string;
  enableSteps: string[];
  disableSteps: string[];
  extras?: { label: string; enable: string; disable: string }[];
  portalNote?: string;
}

interface CallForwardingGuideProps {
  phoneNumber?: string;
}

const providers: Record<string, ProviderInfo> = {
  comcast: {
    name: "Comcast Business",
    enableSteps: [
      "Pick up the handset",
      "Dial *72 and immediately enter the 10-digit destination number",
      "Wait for a confirmation tone, then hang up",
    ],
    disableSteps: ["Pick up the handset", "Dial *73 and wait for confirmation"],
    extras: [
      { label: "Forward when Busy", enable: "*90 + number", disable: "*91" },
      { label: "Forward when No Answer", enable: "*92 + number", disable: "*93" },
    ],
    portalNote: "Comcast Business Account → Phone → Features → Call Forwarding",
  },
  att: {
    name: "AT&T Business",
    enableSteps: [
      "Dial *72 (or 72#) and wait for the dial tone",
      "Dial the 10-digit forwarding number",
      "Someone must answer the call to activate forwarding",
    ],
    disableSteps: ["Dial *73 (or 73#) and listen for short confirmation tones"],
    extras: [
      { label: "Busy Forwarding", enable: "*90 + number + #", disable: "*91#" },
      { label: "No Answer Forwarding", enable: "*92 + number + #", disable: "*93#" },
    ],
  },
  xfinity: {
    name: "Xfinity (Comcast Residential)",
    enableSteps: [
      "Lift the receiver and dial *72",
      "Wait for the stutter dial tone",
      "Dial the 10-digit destination number and stay on the line until it connects",
    ],
    disableSteps: ["Lift the receiver, dial *73, hang up after confirmation"],
    portalNote: "Xfinity Voice Settings portal — supports ringing up to 5 numbers simultaneously.",
  },
  verizon: {
    name: "Verizon Business",
    enableSteps: [
      "Dial *72 followed by the 10-digit forwarding number",
      "Wait for confirmation tone or voice recording, then hang up",
    ],
    disableSteps: ["Dial *73, wait for confirmation tone, hang up"],
  },
  spectrum: {
    name: "Spectrum Business",
    enableSteps: [
      "Dial *72, enter the 10-digit destination number, press #",
      "You will hear a confirmation tone",
    ],
    disableSteps: ["Dial *73 and press #"],
  },
  astound: {
    name: "Astound Broadband (RCN)",
    enableSteps: [
      "Lift the receiver and dial *72",
      "Wait for a slight pause or stutter tone",
      "Enter the 10-digit destination number and wait for confirmation",
    ],
    disableSteps: ["Lift the receiver, dial *73, wait for confirmation"],
    extras: [
      { label: "Forward when Busy", enable: "*90 + number", disable: "*91" },
    ],
    portalNote: "My Astound/Wave Phone portal → Call Manager → Call Settings",
  },
};

export default function CallForwardingGuide({ phoneNumber }: CallForwardingGuideProps) {
  const { token } = theme.useToken();
  const [selectedProvider, setSelectedProvider] = useState<string | undefined>(undefined);

  const provider = selectedProvider ? providers[selectedProvider] : null;

  const destinationLabel = phoneNumber || "your 10-digit destination number";

  function replaceDestination(steps: string[]): string[] {
    return steps.map((s) =>
      s.replace(/the 10-digit destination number/gi, destinationLabel)
       .replace(/the 10-digit forwarding number/gi, destinationLabel)
       .replace(/10-digit destination number/gi, destinationLabel)
       .replace(/10-digit forwarding number/gi, destinationLabel)
    );
  }

  return (
    <Card
      title={
        <Space>
          <PhoneOutlined style={{ color: token.colorPrimary }} />
          <span>Call Forwarding Setup</span>
        </Space>
      }
      extra={
        <Select
          value={selectedProvider}
          onChange={setSelectedProvider}
          style={{ width: 220 }}
          placeholder="Select provider for guide..."
          allowClear
          options={Object.entries(providers).map(([key, p]) => ({
            value: key,
            label: p.name,
          }))}
        />
      }
      variant="borderless"
      size="small"
    >
      {phoneNumber && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: token.marginSM,
          padding: `${token.paddingXS}px ${token.paddingSM}px`,
          background: token.colorSuccessBg,
          borderRadius: token.borderRadius,
          border: `1px solid ${token.colorSuccessBorder}`,
        }}>
          <PhoneOutlined style={{ color: token.colorSuccess }} />
          <Text style={{ color: token.colorTextSecondary }}>Forward calls to:</Text>
          <Text strong copyable>{phoneNumber}</Text>
        </div>
      )}

      {!phoneNumber && (
        <Paragraph type="secondary" style={{ marginBottom: token.marginSM, fontSize: 13 }}>
          Provision a phone number in Settings to see your Coneeko AI number here.
        </Paragraph>
      )}

      {provider && (
        <>
          <div style={{ display: "flex", gap: token.marginLG, flexWrap: "wrap" }}>
            {/* Enable */}
            <div style={{ flex: 1, minWidth: 240 }}>
              <Space style={{ marginBottom: 8 }}>
                <CheckCircleOutlined style={{ color: token.colorSuccess }} />
                <Text strong>Enable</Text>
              </Space>
              <Steps
                orientation="vertical"
                size="small"
                current={-1}
                items={replaceDestination(provider.enableSteps).map((step) => ({ title: <Text style={{ fontSize: 13 }}>{step}</Text> }))}
              />
            </div>

            {/* Disable */}
            <div style={{ flex: 1, minWidth: 240 }}>
              <Space style={{ marginBottom: 8 }}>
                <CloseCircleOutlined style={{ color: token.colorError }} />
                <Text strong>Disable</Text>
              </Space>
              <Steps
                orientation="vertical"
                size="small"
                current={-1}
                items={replaceDestination(provider.disableSteps).map((step) => ({ title: <Text style={{ fontSize: 13 }}>{step}</Text> }))}
              />
            </div>
          </div>

          {provider.extras && (
            <div style={{ marginTop: token.marginSM }}>
              {provider.extras.map((e) => (
                <span key={e.label} style={{ marginRight: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{e.label}:</Text>{" "}
                  <Tag color="green" style={{ fontSize: 11 }}>{e.enable}</Tag>
                  <Tag color="red" style={{ fontSize: 11 }}>{e.disable}</Tag>
                </span>
              ))}
            </div>
          )}

          {provider.portalNote && (
            <Paragraph type="secondary" style={{ margin: `${token.marginXS}px 0 0`, fontSize: 12 }}>
              <InfoCircleOutlined /> {provider.portalNote}
            </Paragraph>
          )}
        </>
      )}
    </Card>
  );
}
