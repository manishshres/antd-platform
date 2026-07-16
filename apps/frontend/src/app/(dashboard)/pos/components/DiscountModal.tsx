"use client";

import { useState } from "react";
import { App, Button, Empty, Input, Modal, Space, Tag, Typography, theme } from "antd";
import { fmtMoney } from "../types";
import type { Discount } from "../types";

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  discounts: Discount[];
  canApplyManagerDiscounts: boolean;
  onApply: (discountId: string) => void;
}

/** Discount picker: promo-code entry plus the configured discount list. */
export default function DiscountModal({
  open,
  onClose,
  discounts,
  canApplyManagerDiscounts,
  onApply,
}: Props) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const [promoInput, setPromoInput] = useState("");

  const applyPromo = () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    const match = discounts.find((d) => d.code?.toUpperCase() === code);
    if (!match) {
      message.error(`Promo code "${code}" not found.`);
      return;
    }
    if (match.requiresManager && !canApplyManagerDiscounts) {
      message.warning(`"${match.name}" requires a manager to apply.`);
      return;
    }
    onApply(match.id);
    setPromoInput("");
    onClose();
    message.success(`${match.name} applied.`);
  };

  return (
    <Modal
      open={open}
      title="Apply Discount"
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <Space.Compact block style={{ marginBottom: token.margin }}>
        <Input
          placeholder="Promo code"
          value={promoInput}
          onChange={(e) => setPromoInput(e.target.value)}
          onPressEnter={applyPromo}
          aria-label="Promo code"
        />
        <Button type="primary" onClick={applyPromo}>
          Apply
        </Button>
      </Space.Compact>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {discounts.length === 0 && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No discounts configured. Add them in Store Settings."
          />
        )}
        {discounts.map((d) => {
          const locked = d.requiresManager && !canApplyManagerDiscounts;
          return (
            <Button
              key={d.id}
              block
              disabled={locked}
              onClick={() => {
                onApply(d.id);
                onClose();
              }}
              aria-label={`Apply ${d.name}`}
              style={{
                height: 44,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                {d.name}
                {d.requiresManager && (
                  <Tag color="orange" style={{ marginLeft: 8 }}>
                    manager
                  </Tag>
                )}
              </span>
              <Text type="secondary">
                {d.type === "percent"
                  ? `${d.value}% off`
                  : `${fmtMoney(d.value)} off`}
              </Text>
            </Button>
          );
        })}
      </div>
    </Modal>
  );
}
