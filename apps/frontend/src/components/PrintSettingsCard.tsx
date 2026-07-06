"use client";

import { useEffect, useState } from "react";
import {
  App,
  Button,
  Card,
  Checkbox,
  Divider,
  InputNumber,
  Space,
  Typography,
  theme,
} from "antd";
import { PrinterOutlined, SaveOutlined } from "@ant-design/icons";
import { api } from "@/lib/api";
import { useLocation } from "@/contexts/LocationContext";
import { EmptyState } from "@/components/PageStates";

const { Text, Title } = Typography;

interface DocMatrix {
  onSave: boolean;
  onUpdate: boolean;
  onPaid: boolean;
  copies: number;
}

const DEFAULTS: Record<"kitchen" | "receipt", DocMatrix> = {
  kitchen: { onSave: true, onUpdate: true, onPaid: false, copies: 1 },
  receipt: { onSave: false, onUpdate: false, onPaid: true, copies: 1 },
};

/** Normalize stored settings (new matrix shape or legacy enable/hold keys). */
function normalize(
  s: Record<string, unknown> | undefined,
  doc: "kitchen" | "receipt",
): DocMatrix {
  const m = s?.[doc] as Partial<DocMatrix> | undefined;
  if (m && typeof m === "object") {
    return {
      onSave: m.onSave === true,
      onUpdate: m.onUpdate === true,
      onPaid: m.onPaid === true,
      copies: Math.min(5, Math.max(1, Number(m.copies) || 1)),
    };
  }
  const enabled = s?.[`${doc}Enabled`] !== false;
  const copies = Math.min(5, Math.max(1, Number(s?.[`${doc}Copies`]) || 1));
  if (doc === "kitchen") {
    const hold = s?.holdUnpaidKitchen === true;
    return {
      onSave: enabled && !hold,
      onUpdate: enabled && !hold,
      onPaid: enabled && hold,
      copies,
    };
  }
  return { onSave: false, onUpdate: false, onPaid: enabled, copies };
}

/**
 * Per-location printing policy as an event matrix: for each document type,
 * choose which order events trigger a print (Save / Update / Paid) and how
 * many copies. Covers every workflow — fire-immediately kitchens, hold-until-
 * paid delivery flows, receipt-on-save, or fully silent — without special cases.
 */
export default function PrintSettingsCard() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { selectedLocationId, selectedLocation, refreshLocations } =
    useLocation();

  const [kitchen, setKitchen] = useState<DocMatrix>(DEFAULTS.kitchen);
  const [receipt, setReceipt] = useState<DocMatrix>(DEFAULTS.receipt);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const s = selectedLocation?.printSettings as
      | Record<string, unknown>
      | undefined;
    Promise.resolve().then(() => {
      setKitchen(normalize(s, "kitchen"));
      setReceipt(normalize(s, "receipt"));
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
        printSettings: { kitchen, receipt },
      });
      await refreshLocations();
      message.success("Print settings saved.");
    } catch {
      message.error("Failed to save print settings.");
    } finally {
      setSaving(false);
    }
  };

  const headerCell: React.CSSProperties = {
    width: 84,
    textAlign: "center",
    padding: "8px 4px",
  };
  const cell: React.CSSProperties = { textAlign: "center", padding: "12px 4px" };

  const row = (
    label: string,
    description: string,
    value: DocMatrix,
    set: (v: DocMatrix) => void,
  ) => (
    <tr style={{ borderTop: `1px solid ${token.colorBorderSecondary}` }}>
      <td style={{ padding: "12px 8px 12px 0" }}>
        <Text strong style={{ display: "block" }}>
          {label}
        </Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {description}
        </Text>
      </td>
      {(["onSave", "onUpdate", "onPaid"] as const).map((ev) => (
        <td key={ev} style={cell}>
          <Checkbox
            checked={value[ev]}
            onChange={(e) => set({ ...value, [ev]: e.target.checked })}
            aria-label={`${label} — print ${ev.replace("on", "on ")}`}
          />
        </td>
      ))}
      <td style={cell}>
        <InputNumber
          min={1}
          max={5}
          value={value.copies}
          onChange={(v) => set({ ...value, copies: v ?? 1 })}
          aria-label={`${label} copies`}
          style={{ width: 60 }}
        />
      </td>
    </tr>
  );

  return (
    <Card
      variant="borderless"
      style={{ marginTop: token.marginXS, maxWidth: 680 }}
    >
      <Space align="center" style={{ marginBottom: 4 }}>
        <PrinterOutlined style={{ color: token.colorPrimary, fontSize: 18 }} />
        <Title level={5} style={{ margin: 0 }}>
          Automatic Printing — {selectedLocation?.name}
        </Title>
      </Space>
      <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
        Choose which order events print each document. Save = order created
        (POS or AI phone), Update = an unpaid order is edited, Paid = payment
        completed. Applies to all printers of that type at this location.
      </Text>

      <table
        style={{ width: "100%", borderCollapse: "collapse" }}
        aria-label="Automatic printing event matrix"
      >
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "8px 0" }}>
              <Text type="secondary" style={{ fontWeight: 500 }}>
                Document
              </Text>
            </th>
            {["On Save", "On Update", "On Paid", "Copies"].map((h) => (
              <th key={h} style={headerCell}>
                <Text type="secondary" style={{ fontWeight: 500, fontSize: 13 }}>
                  {h}
                </Text>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row(
            "Kitchen Ticket",
            "Prep ticket for kitchen printers.",
            kitchen,
            setKitchen,
          )}
          {row(
            "Customer Receipt",
            "Totals, tax, tip, and discount.",
            receipt,
            setReceipt,
          )}
        </tbody>
      </table>

      <Divider style={{ margin: "12px 0" }} />
      <Space align="center">
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          onClick={save}
        >
          Save Print Settings
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Tip: hold-until-paid = Kitchen with only “On Paid” checked.
        </Text>
      </Space>
    </Card>
  );
}
