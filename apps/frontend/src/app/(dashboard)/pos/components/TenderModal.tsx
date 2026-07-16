"use client";

import { useState } from "react";
import {
  App,
  Button,
  Divider,
  InputNumber,
  Modal,
  Segmented,
  Space,
  Tag,
  Typography,
  theme,
} from "antd";
import {
  CreditCardOutlined,
  DollarOutlined,
  TagOutlined,
} from "@ant-design/icons";
import { api } from "@/lib/api";
import { finiteOrNull, fmtMoney, orderLabel } from "../types";
import type { Discount } from "../types";

const { Text, Title } = Typography;

/** Order row returned when the cart is persisted so a split can attach to it. */
export interface PersistedOrder {
  id: string;
  ticketNumber?: number | null;
  totalAmount: number;
}

interface SplitState {
  orderId: string;
  label: string;
  remaining: number; // cents
  made: { method: string; applied: number; changeGiven: number | null }[];
}

interface Props {
  open: boolean;
  /** Plain cancel — nothing was persisted (not in a split). */
  onClose: () => void;
  /** Order fully paid or parked mid-split — parent clears the register. */
  onSettled: () => void;
  editingOrderLabel: string | null;
  total: number;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  tipAmount: number;
  tipPct: number;
  onTipPctChange: (v: number) => void;
  customTip: number;
  onCustomTipChange: (v: number) => void;
  appliedDiscount: Discount | null;
  onClearDiscount: () => void;
  onOpenDiscount: () => void;
  charging: "cash" | "card" | null;
  onCharge: (method: "cash" | "card") => void;
  /** Create (or persist edits to) the order so split payments can attach. */
  persistOrder: () => Promise<PersistedOrder>;
}

/**
 * Tender step (Square/Toast pattern): total, tip, discount, then payment —
 * simple charge, cash-tendered/change screen, or split checks. Owns every
 * payment-flow input so typing an amount never re-renders the register.
 */
export default function TenderModal({
  open,
  onClose,
  onSettled,
  editingOrderLabel,
  total,
  subtotal,
  discountAmount,
  taxAmount,
  tipAmount,
  tipPct,
  onTipPctChange,
  customTip,
  onCustomTipChange,
  appliedDiscount,
  onClearDiscount,
  onOpenDiscount,
  charging,
  onCharge,
  persistOrder,
}: Props) {
  const { token } = theme.useToken();
  const { message } = App.useApp();

  // Tender payment step: choose method, cash-tendered/change screen, or split.
  const [payStep, setPayStep] = useState<"select" | "cash" | "split">("select");
  const [cashReceived, setCashReceived] = useState<number | null>(null); // dollars
  // Split-check state: the order being settled and the authoritative remaining
  // balance returned by each POST /orders/:id/payments.
  const [split, setSplit] = useState<SplitState | null>(null);
  const [splitAmount, setSplitAmount] = useState<number | null>(null); // dollars
  const [splitCashMode, setSplitCashMode] = useState(false);
  const [splitCashReceived, setSplitCashReceived] = useState<number | null>(
    null,
  );
  const [splitBusy, setSplitBusy] = useState(false);

  // Fresh flow every time the tender sheet opens — render-time reset (the
  // "derive state from props" pattern) instead of an effect.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPayStep("select");
      setCashReceived(null);
      setSplit(null);
      setSplitAmount(null);
      setSplitCashMode(false);
      setSplitCashReceived(null);
      setSplitBusy(false);
    }
  }

  /**
   * Enter split mode: the cart must exist as a real (unpaid) order first so
   * partial payments have something to attach to.
   */
  const startSplit = async () => {
    setSplitBusy(true);
    try {
      const orderRow = await persistOrder();
      // The tip chosen in the tender modal rides on the first split payment.
      const startingRemaining = orderRow.totalAmount + tipAmount;
      setSplit({
        orderId: orderRow.id,
        label: orderLabel(orderRow),
        remaining: startingRemaining,
        made: [],
      });
      setSplitAmount(Math.ceil(startingRemaining / 2) / 100);
      setPayStep("split");
    } catch {
      message.error("Failed to start the split.");
    } finally {
      setSplitBusy(false);
    }
  };

  const paySplitPortion = async (method: "cash" | "card") => {
    if (!split || splitAmount == null) return;
    const amountCents = Math.min(Math.round(splitAmount * 100), split.remaining);
    if (amountCents <= 0) return;
    setSplitBusy(true);
    try {
      const res = await api.post<{
        applied: number;
        changeGiven: number | null;
        remaining: number;
        paid: boolean;
      }>(`/orders/${split.orderId}/payments`, {
        method,
        amount: amountCents,
        // Tip is carried once, by the first payment.
        tipAmount:
          split.made.length === 0 && tipAmount > 0 ? tipAmount : undefined,
        cashReceived:
          method === "cash" && splitCashReceived != null
            ? Math.round(splitCashReceived * 100)
            : undefined,
      });
      if ((res.data.changeGiven ?? 0) > 0) {
        message.info(`Change due: ${fmtMoney(res.data.changeGiven!)}`, 6);
      }
      if (res.data.paid) {
        message.success(`Order ${split.label} fully paid. Ticket complete.`, 5);
        onSettled();
        return;
      }
      setSplit({
        ...split,
        remaining: res.data.remaining,
        made: [
          ...split.made,
          {
            method,
            applied: res.data.applied,
            changeGiven: res.data.changeGiven,
          },
        ],
      });
      setSplitAmount(res.data.remaining / 100);
      setSplitCashMode(false);
      setSplitCashReceived(null);
    } catch {
      message.error("Payment failed — nothing was recorded.");
    } finally {
      setSplitBusy(false);
    }
  };

  /** Closing the tender modal mid-split: the order exists (possibly partially
   * paid) — park it in Open Orders rather than leaving the register ambiguous. */
  const closeTender = () => {
    if (split) {
      message.info(
        `Order ${split.label} saved${split.made.length ? " (partially paid)" : ""} — finish from Open Orders.`,
        6,
      );
      onSettled();
      return;
    }
    onClose();
  };

  const cashReceivedCents =
    cashReceived != null ? Math.round(cashReceived * 100) : null;

  return (
    <Modal
      open={open}
      title={null}
      onCancel={closeTender}
      footer={null}
      destroyOnHidden
      width={420}
    >
      <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
        <Text type="secondary">
          {payStep === "split" && split
            ? `Order ${split.label} — remaining`
            : editingOrderLabel
              ? `Order ${editingOrderLabel}`
              : "Total due"}
        </Text>
        <Title
          level={1}
          style={{ margin: "0 0 4px", fontVariantNumeric: "tabular-nums" }}
        >
          {payStep === "split" && split
            ? fmtMoney(split.remaining)
            : fmtMoney(total)}
        </Title>
        {payStep !== "split" && (
          <Text type="secondary" style={{ fontSize: 13 }}>
            Subtotal {fmtMoney(subtotal)}
            {discountAmount > 0 && ` − discount ${fmtMoney(discountAmount)}`}
            {" + tax "}
            {fmtMoney(taxAmount)}
            {tipAmount > 0 && ` + tip ${fmtMoney(tipAmount)}`}
          </Text>
        )}
      </div>

      <Divider style={{ margin: "12px 0" }} />

      {payStep !== "split" && (
        <>
          <Text strong style={{ display: "block", marginBottom: 6 }}>
            Tip
          </Text>
          <Segmented
            block
            value={tipPct}
            onChange={(v) => onTipPctChange(v as number)}
            options={[
              { label: "None", value: 0 },
              { label: "10%", value: 10 },
              { label: "15%", value: 15 },
              { label: "20%", value: 20 },
              { label: "Custom", value: -1 },
            ]}
          />
          {tipPct === -1 && (
            <InputNumber
              min={0}
              step={0.25}
              precision={2}
              prefix="$"
              value={customTip}
              onChange={(v) => onCustomTipChange(finiteOrNull(v) ?? 0)}
              aria-label="Custom tip amount"
              style={{ width: "100%", marginTop: 8 }}
            />
          )}

          <div style={{ marginTop: 12 }}>
            {appliedDiscount ? (
              <Tag color="green" closable onClose={onClearDiscount}>
                {appliedDiscount.name} −{fmtMoney(discountAmount)}
              </Tag>
            ) : (
              <Button
                size="small"
                type="dashed"
                icon={<TagOutlined />}
                onClick={onOpenDiscount}
                aria-label="Add discount"
              >
                Add discount
              </Button>
            )}
          </div>

          <Divider style={{ margin: "12px 0" }} />
        </>
      )}

      {payStep === "select" ? (
        <>
          <Space.Compact block>
            <Button
              type="primary"
              size="large"
              icon={<DollarOutlined />}
              disabled={charging !== null || splitBusy}
              onClick={() => {
                setCashReceived(null);
                setPayStep("cash");
              }}
              aria-label="Pay with cash"
              style={{ flex: 1, height: 60, fontSize: 16 }}
            >
              Cash
            </Button>
            <Button
              type="primary"
              size="large"
              icon={<CreditCardOutlined />}
              disabled={charging !== null || splitBusy}
              loading={charging === "card"}
              onClick={() => onCharge("card")}
              aria-label="Pay with card"
              style={{ flex: 1, height: 60, fontSize: 16 }}
            >
              Card
            </Button>
          </Space.Compact>
          <Button
            block
            size="large"
            disabled={charging !== null || splitBusy}
            loading={splitBusy}
            onClick={startSplit}
            aria-label="Split the payment"
            style={{ marginTop: 8, height: 44 }}
          >
            Split payment…
          </Button>
        </>
      ) : payStep === "split" && split ? (
        <>
          {split.made.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              {split.made.map((p, i) => (
                <div
                  key={i}
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    Payment {i + 1} — {p.method}
                    {p.changeGiven ? ` (change ${fmtMoney(p.changeGiven)})` : ""}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    {fmtMoney(p.applied)}
                  </Text>
                </div>
              ))}
            </div>
          )}

          {!splitCashMode ? (
            <>
              <Text strong style={{ display: "block", marginBottom: 6 }}>
                This payment
              </Text>
              <Space wrap style={{ marginBottom: 8 }}>
                {[2, 3, 4].map((n) => (
                  <Button
                    key={n}
                    size="small"
                    onClick={() =>
                      setSplitAmount(Math.ceil(split.remaining / n) / 100)
                    }
                  >
                    ÷{n} ({fmtMoney(Math.ceil(split.remaining / n))})
                  </Button>
                ))}
                <Button
                  size="small"
                  onClick={() => setSplitAmount(split.remaining / 100)}
                >
                  Rest ({fmtMoney(split.remaining)})
                </Button>
              </Space>
              <InputNumber
                min={0.01}
                max={split.remaining / 100}
                step={1}
                precision={2}
                prefix="$"
                value={splitAmount}
                onChange={(v) => setSplitAmount(finiteOrNull(v))}
                aria-label="Split payment amount"
                size="large"
                style={{ width: "100%", marginBottom: 12 }}
              />
              <Space.Compact block>
                <Button
                  size="large"
                  icon={<DollarOutlined />}
                  disabled={splitBusy || !splitAmount}
                  onClick={() => {
                    setSplitCashReceived(splitAmount);
                    setSplitCashMode(true);
                  }}
                  aria-label="Pay this portion with cash"
                  style={{ flex: 1, height: 56 }}
                >
                  Cash
                </Button>
                <Button
                  type="primary"
                  size="large"
                  icon={<CreditCardOutlined />}
                  disabled={splitBusy || !splitAmount}
                  loading={splitBusy}
                  onClick={() => paySplitPortion("card")}
                  aria-label="Pay this portion with card"
                  style={{ flex: 1, height: 56 }}
                >
                  Card
                </Button>
              </Space.Compact>
            </>
          ) : (
            <>
              <Text strong style={{ display: "block", marginBottom: 6 }}>
                Cash received for {fmtMoney(Math.round((splitAmount ?? 0) * 100))}
              </Text>
              <InputNumber
                min={0}
                step={1}
                precision={2}
                prefix="$"
                value={splitCashReceived}
                onChange={(v) => setSplitCashReceived(finiteOrNull(v))}
                aria-label="Cash received for this portion"
                size="large"
                style={{ width: "100%", marginBottom: 8 }}
              />
              {splitCashReceived != null && splitAmount != null && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    borderRadius: token.borderRadiusLG,
                    background:
                      splitCashReceived >= splitAmount
                        ? token.colorSuccessBg
                        : token.colorErrorBg,
                    marginBottom: 12,
                  }}
                >
                  <Text strong>
                    {splitCashReceived >= splitAmount
                      ? "Change due"
                      : "Still owed"}
                  </Text>
                  <Text strong style={{ fontSize: 18 }}>
                    {fmtMoney(
                      Math.abs(
                        Math.round((splitCashReceived - splitAmount) * 100),
                      ),
                    )}
                  </Text>
                </div>
              )}
              <Space.Compact block>
                <Button
                  size="large"
                  onClick={() => setSplitCashMode(false)}
                  aria-label="Back to split amount"
                  style={{ height: 56 }}
                >
                  Back
                </Button>
                <Button
                  type="primary"
                  size="large"
                  icon={<DollarOutlined />}
                  disabled={
                    splitBusy ||
                    splitCashReceived == null ||
                    splitAmount == null ||
                    splitCashReceived < splitAmount
                  }
                  loading={splitBusy}
                  onClick={() => paySplitPortion("cash")}
                  aria-label="Confirm cash portion"
                  style={{ flex: 1, height: 56 }}
                >
                  Confirm Cash
                </Button>
              </Space.Compact>
            </>
          )}
        </>
      ) : (
        <>
          {/* Cash tendered → change due */}
          <Text strong style={{ display: "block", marginBottom: 6 }}>
            Cash received
          </Text>
          <Space wrap style={{ marginBottom: 8 }}>
            <Button onClick={() => setCashReceived(total / 100)}>
              Exact {fmtMoney(total)}
            </Button>
            {[20, 50, 100]
              .filter((bill) => bill * 100 >= total)
              .map((bill) => (
                <Button key={bill} onClick={() => setCashReceived(bill)}>
                  ${bill}
                </Button>
              ))}
          </Space>
          <InputNumber
            min={0}
            step={1}
            precision={2}
            prefix="$"
            value={cashReceived}
            onChange={(v) => setCashReceived(finiteOrNull(v))}
            placeholder="Amount from customer"
            aria-label="Cash received"
            size="large"
            style={{ width: "100%", marginBottom: 8 }}
          />
          {cashReceivedCents != null && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "8px 12px",
                borderRadius: token.borderRadiusLG,
                background:
                  cashReceivedCents >= total
                    ? token.colorSuccessBg
                    : token.colorErrorBg,
                marginBottom: 12,
              }}
            >
              <Text strong>
                {cashReceivedCents >= total ? "Change due" : "Still owed"}
              </Text>
              <Text
                strong
                style={{ fontSize: 18, fontVariantNumeric: "tabular-nums" }}
              >
                {fmtMoney(Math.abs(cashReceivedCents - total))}
              </Text>
            </div>
          )}
          <Space.Compact block>
            <Button
              size="large"
              onClick={() => setPayStep("select")}
              aria-label="Back to payment methods"
              style={{ height: 56 }}
            >
              Back
            </Button>
            <Button
              type="primary"
              size="large"
              icon={<DollarOutlined />}
              disabled={
                charging !== null ||
                cashReceivedCents == null ||
                cashReceivedCents < total
              }
              loading={charging === "cash"}
              onClick={() => onCharge("cash")}
              aria-label="Complete cash payment"
              style={{ flex: 1, height: 56, fontSize: 16 }}
            >
              Complete Cash Payment
            </Button>
          </Space.Compact>
        </>
      )}
    </Modal>
  );
}
