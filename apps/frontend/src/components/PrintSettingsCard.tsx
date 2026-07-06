"use client";

import { useEffect, useState } from "react";
import {
  App,
  Button,
  Card,
  Divider,
  InputNumber,
  Space,
  Switch,
  Typography,
  theme,
} from "antd";
import { PrinterOutlined, SaveOutlined } from "@ant-design/icons";
import { api } from "@/lib/api";
import { useLocation } from "@/contexts/LocationContext";
import { EmptyState } from "@/components/PageStates";

const { Text, Title } = Typography;

/**
 * Per-location printing behavior: enable/disable kitchen tickets and customer
 * receipts, and how many copies of each print per order (1–5).
 */
export default function PrintSettingsCard() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { selectedLocationId, selectedLocation, refreshLocations } =
    useLocation();

  const [kitchenEnabled, setKitchenEnabled] = useState(true);
  const [kitchenCopies, setKitchenCopies] = useState(1);
  const [receiptEnabled, setReceiptEnabled] = useState(true);
  const [receiptCopies, setReceiptCopies] = useState(1);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const s = selectedLocation?.printSettings;
    Promise.resolve().then(() => {
      setKitchenEnabled(s?.kitchenEnabled !== false);
      setKitchenCopies(s?.kitchenCopies ?? 1);
      setReceiptEnabled(s?.receiptEnabled !== false);
      setReceiptCopies(s?.receiptCopies ?? 1);
    });
  }, [selectedLocation]);

  if (!selectedLocationId) {
    return (
      <EmptyState description="Select a location to configure printing." />
    );
  }

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/locations/${selectedLocationId}`, {
        printSettings: {
          kitchenEnabled,
          kitchenCopies,
          receiptEnabled,
          receiptCopies,
        },
      });
      await refreshLocations();
      message.success("Print settings saved.");
    } catch {
      message.error("Failed to save print settings.");
    } finally {
      setSaving(false);
    }
  };

  const row = (
    label: string,
    description: string,
    enabled: boolean,
    setEnabled: (v: boolean) => void,
    copies: number,
    setCopies: (v: number) => void,
  ) => (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: token.margin,
        padding: "12px 0",
      }}
    >
      <div>
        <Text strong style={{ display: "block" }}>
          {label}
        </Text>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {description}
        </Text>
      </div>
      <Space size="middle">
        <Space size={4}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Copies
          </Text>
          <InputNumber
            min={1}
            max={5}
            value={copies}
            onChange={(v) => setCopies(v ?? 1)}
            disabled={!enabled}
            aria-label={`${label} copies`}
            style={{ width: 64 }}
          />
        </Space>
        <Switch
          checked={enabled}
          onChange={setEnabled}
          aria-label={`Enable ${label}`}
        />
      </Space>
    </div>
  );

  return (
    <Card
      variant="borderless"
      style={{ marginTop: token.marginXS, maxWidth: 640 }}
    >
      <Space align="center" style={{ marginBottom: 4 }}>
        <PrinterOutlined style={{ color: token.colorPrimary, fontSize: 18 }} />
        <Title level={5} style={{ margin: 0 }}>
          Automatic Printing — {selectedLocation?.name}
        </Title>
      </Space>
      <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
        Applies to every new order (POS and AI phone). Copies are sent to all
        online printers of that type at this location.
      </Text>
      <Divider style={{ margin: "8px 0" }} />
      {row(
        "Kitchen tickets",
        "Prep ticket fired to kitchen printers when an order comes in or is updated.",
        kitchenEnabled,
        setKitchenEnabled,
        kitchenCopies,
        setKitchenCopies,
      )}
      <Divider style={{ margin: 0 }} />
      {row(
        "Customer receipts",
        "Receipt with totals, tax, tip, and discount printed at order time.",
        receiptEnabled,
        setReceiptEnabled,
        receiptCopies,
        setReceiptCopies,
      )}
      <Divider style={{ margin: "8px 0" }} />
      <Button
        type="primary"
        icon={<SaveOutlined />}
        loading={saving}
        onClick={save}
      >
        Save Print Settings
      </Button>
    </Card>
  );
}
