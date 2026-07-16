"use client";

import { memo } from "react";
import {
  AutoComplete,
  Badge,
  Button,
  Divider,
  Empty,
  Input,
  Segmented,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  MinusOutlined,
  PlusOutlined,
  SaveOutlined,
  ShoppingCartOutlined,
  TagOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { fmtMoney, orderLabel } from "../types";
import type {
  CartLine,
  CustomerRow,
  Discount,
  ExistingOrder,
  FloorPlan,
} from "../types";
import type { CartAction } from "../cart";

const { Text } = Typography;

interface Props {
  cart: CartLine[];
  dispatchCart: (action: CartAction) => void;
  editingOrder: ExistingOrder | null;
  orderType: string;
  onOrderTypeChange: (v: string) => void;
  floorPlans: FloorPlan[];
  selectedTableId: string | null;
  onSelectTable: (tableId: string | null) => void;
  customerName: string;
  customerId: string | null;
  customerResults: CustomerRow[];
  onCustomerSearch: (q: string) => void;
  onCustomerSelect: (id: string) => void;
  reordering: boolean;
  onReorderLast: () => void;
  showCustomer: boolean;
  onShowCustomer: () => void;
  showNote: boolean;
  onShowNote: () => void;
  orderNotes: string;
  onOrderNotesChange: (v: string) => void;
  appliedDiscount: Discount | null;
  discountAmount: number;
  onClearDiscount: () => void;
  onOpenDiscount: () => void;
  onLineTap: (line: CartLine) => void;
  subtotal: number;
  taxRateBps: number;
  taxAmount: number;
  tipAmount: number;
  total: number;
  saving: boolean;
  busy: boolean;
  onOpenTender: () => void;
  onSaveOrder: () => void;
}

/** Ticket panel: cart lines, order meta reveals, receipt totals, actions. */
function CartPanel({
  cart,
  dispatchCart,
  editingOrder,
  orderType,
  onOrderTypeChange,
  floorPlans,
  selectedTableId,
  onSelectTable,
  customerName,
  customerId,
  customerResults,
  onCustomerSearch,
  onCustomerSelect,
  reordering,
  onReorderLast,
  showCustomer,
  onShowCustomer,
  showNote,
  onShowNote,
  orderNotes,
  onOrderNotesChange,
  appliedDiscount,
  discountAmount,
  onClearDiscount,
  onOpenDiscount,
  onLineTap,
  subtotal,
  taxRateBps,
  taxAmount,
  tipAmount,
  total,
  saving,
  busy,
  onOpenTender,
  onSaveOrder,
}: Props) {
  const { token } = theme.useToken();

  return (
    <div
      className="pos-cart"
      style={{
        display: "flex",
        flexDirection: "column",
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorder}`,
        borderRadius: token.borderRadiusLG,
        boxShadow: token.boxShadowTertiary,
        padding: token.paddingSM,
      }}
    >
      {/* Panel header strip — bleeds to the panel edges (classic POS ticket header) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          margin: `-${token.paddingSM}px -${token.paddingSM}px ${token.marginXS}px`,
          padding: `${token.paddingXS}px ${token.paddingSM}px`,
          background: token.colorFillAlter,
          borderBottom: `1px solid ${token.colorBorder}`,
          borderRadius: `${token.borderRadiusLG}px ${token.borderRadiusLG}px 0 0`,
        }}
      >
        <Space>
          <ShoppingCartOutlined style={{ color: token.colorPrimary }} />
          <Text strong style={{ fontSize: 15 }}>
            {editingOrder ? `Order ${orderLabel(editingOrder)}` : "New Order"}
          </Text>
          <Badge count={cart.reduce((s, l) => s + l.quantity, 0)} />
        </Space>
        {cart.length > 0 && (
          <Button
            size="small"
            type="text"
            danger
            icon={<DeleteOutlined />}
            aria-label="Clear order"
            onClick={() => dispatchCart({ type: "clear" })}
          />
        )}
      </div>

      <Segmented
        block
        size="large"
        value={orderType}
        onChange={(v) => onOrderTypeChange(v as string)}
        options={[
          { label: "Dine-in", value: "dine_in" },
          { label: "Pickup", value: "pickup" },
          { label: "Delivery", value: "delivery" },
        ]}
        style={{ marginBottom: token.marginSM, fontWeight: 600 }}
      />
      {/* Table picker — dine-in only; options come from the floor plans */}
      {orderType === "dine_in" && (
        <Select
          value={selectedTableId ?? undefined}
          onChange={(v) => onSelectTable(v ?? null)}
          placeholder="Select Table"
          aria-label="Select table"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: "100%", marginBottom: token.marginXS }}
          options={floorPlans.flatMap((fp) =>
            (fp.tables ?? []).map((t) => ({
              value: t.id,
              label: `${t.name}${t.capacity ? ` · ${t.capacity} pax` : ""}${
                t.activeOrderId ? ` · ${fmtMoney(t.activeOrderTotal ?? 0)}` : ""
              }`,
            })),
          )}
          notFoundContent="No tables — add them under Floor Plans"
        />
      )}
      {/* Customer + note are one-tap reveals — hidden until needed (Square pattern) */}
      {showCustomer || customerName ? (
        <div style={{ display: "flex", gap: 6, marginBottom: token.marginXS }}>
          <AutoComplete
            value={customerName}
            onChange={(v) => onCustomerSearch(v)}
            onSelect={(id: string) => onCustomerSelect(id)}
            options={customerResults.map((c) => ({
              value: c.id,
              label: `${c.name}${c.phone ? ` · ${c.phone}` : ""}`,
            }))}
            placeholder="Customer name or phone"
            aria-label="Customer name or phone"
            allowClear
            style={{ flex: 1 }}
          />
          {customerId && (
            <Tooltip title="Reorder this customer's last order">
              <Button
                icon={<HistoryOutlined />}
                loading={reordering}
                onClick={onReorderLast}
                aria-label="Reorder last order"
              >
                Reorder
              </Button>
            </Tooltip>
          )}
        </div>
      ) : null}

      <div
        className="pos-scroll"
        style={{ flex: 1, minHeight: 0, overflowY: "auto" }}
      >
        {cart.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Tap items to add them"
            style={{ marginTop: 48 }}
          />
        ) : (
          cart.map((line) => (
            <div
              key={line.key}
              style={{
                padding: "8px 0",
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <div
                role="button"
                tabIndex={0}
                aria-label={`Edit ${line.name}`}
                onClick={() => onLineTap(line)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onLineTap(line);
                }}
                style={{ cursor: "pointer" }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <Text strong style={{ fontSize: 13, flex: 1 }}>
                    {line.name}
                  </Text>
                  <Text style={{ fontSize: 13 }}>
                    {fmtMoney(line.unitPrice * line.quantity)}
                  </Text>
                </div>
                {line.options.length > 0 && (
                  <Text
                    type="secondary"
                    style={{ fontSize: 12, display: "block" }}
                  >
                    {line.options
                      .map(
                        (o) =>
                          `${o.name}${o.priceAdjustment ? ` (+${fmtMoney(o.priceAdjustment)})` : ""}`,
                      )
                      .join(" · ")}
                  </Text>
                )}
                {line.notes && (
                  <Text
                    type="secondary"
                    italic
                    style={{ fontSize: 12, display: "block" }}
                  >
                    “{line.notes}”
                  </Text>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: 4,
                }}
              >
                <Space>
                  <Button
                    size="small"
                    icon={<MinusOutlined />}
                    aria-label={`Remove one ${line.name}`}
                    onClick={() =>
                      dispatchCart({ type: "updateQty", key: line.key, delta: -1 })
                    }
                  />
                  <Text style={{ minWidth: 20, textAlign: "center" }}>
                    {line.quantity}
                  </Text>
                  <Button
                    size="small"
                    icon={<PlusOutlined />}
                    aria-label={`Add one ${line.name}`}
                    onClick={() =>
                      dispatchCart({ type: "updateQty", key: line.key, delta: 1 })
                    }
                  />
                </Space>
                <Space size={0}>
                  <Button
                    size="small"
                    type="text"
                    icon={<EditOutlined />}
                    aria-label={`Edit options for ${line.name}`}
                    onClick={() => onLineTap(line)}
                  />
                  <Button
                    size="small"
                    type="text"
                    icon={<CopyOutlined />}
                    aria-label={`Duplicate ${line.name}`}
                    onClick={() =>
                      dispatchCart({ type: "duplicate", key: line.key })
                    }
                  />
                </Space>
              </div>
            </div>
          ))
        )}
      </div>

      <Divider style={{ margin: "8px 0" }} />

      {/* Quick reveals — kept out of the way until needed */}
      <Space size={4} style={{ marginBottom: token.marginXS }}>
        {!showCustomer && !customerName && (
          <Button
            size="small"
            type="text"
            icon={<UserOutlined />}
            onClick={onShowCustomer}
            aria-label="Add customer name"
          >
            Customer
          </Button>
        )}
        {!showNote && !orderNotes && (
          <Button
            size="small"
            type="text"
            icon={<EditOutlined />}
            onClick={onShowNote}
            aria-label="Add order note"
          >
            Note
          </Button>
        )}
        {appliedDiscount && (
          <Tag
            color="green"
            closable
            onClose={onClearDiscount}
            style={{ margin: 0 }}
          >
            {appliedDiscount.name} −{fmtMoney(discountAmount)}
          </Tag>
        )}
      </Space>
      {(showNote || orderNotes) && (
        <Input.TextArea
          rows={2}
          placeholder="Order note — e.g. allergy, rush"
          value={orderNotes}
          autoFocus={showNote && !orderNotes}
          onChange={(e) => onOrderNotesChange(e.target.value)}
          maxLength={1000}
          aria-label="Order instructions"
          style={{ marginBottom: token.marginXS }}
        />
      )}

      {/* Receipt-style totals — every line the cashier reads back, tabular digits */}
      {cart.length > 0 && (
        <div
          style={{
            fontVariantNumeric: "tabular-nums",
            marginBottom: token.marginXS,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Subtotal
            </Text>
            <Text style={{ fontSize: 13 }}>{fmtMoney(subtotal)}</Text>
          </div>
          {discountAmount > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 13, color: token.colorSuccess }}>
                {appliedDiscount?.name ?? "Discount"}
              </Text>
              <Text style={{ fontSize: 13, color: token.colorSuccess }}>
                −{fmtMoney(discountAmount)}
              </Text>
            </div>
          )}
          {taxRateBps > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Text type="secondary" style={{ fontSize: 13 }}>
                Tax ({(taxRateBps / 100).toFixed(2)}%)
              </Text>
              <Text style={{ fontSize: 13 }}>{fmtMoney(taxAmount)}</Text>
            </div>
          )}
          {tipAmount > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Text type="secondary" style={{ fontSize: 13 }}>
                Tip
              </Text>
              <Text style={{ fontSize: 13 }}>{fmtMoney(tipAmount)}</Text>
            </div>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              borderTop: `1px solid ${token.colorBorder}`,
              marginTop: 4,
              paddingTop: 6,
            }}
          >
            <Text strong style={{ fontSize: 15 }}>
              Total
            </Text>
            <Text strong style={{ fontSize: 20 }}>
              {fmtMoney(total)}
            </Text>
          </div>
        </div>
      )}
      <Button
        block
        type="primary"
        size="large"
        disabled={cart.length === 0 || busy}
        onClick={onOpenTender}
        aria-label={`Charge ${fmtMoney(total)}`}
        style={{
          height: 60,
          fontSize: 18,
          fontWeight: 600,
          boxShadow: token.boxShadow,
        }}
      >
        Charge {cart.length > 0 ? fmtMoney(total) : ""}
      </Button>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <Tooltip title="Fire the kitchen ticket and park the order — pay later from Transactions">
          <Button
            size="large"
            icon={<SaveOutlined />}
            disabled={cart.length === 0 || (busy && !saving)}
            loading={saving}
            onClick={onSaveOrder}
            aria-label="Hold order and send to kitchen"
            style={{ flex: 1.2, height: 48, boxShadow: token.boxShadowTertiary }}
          >
            Hold Order
          </Button>
        </Tooltip>
        <Button
          size="large"
          icon={<TagOutlined />}
          disabled={cart.length === 0 || busy}
          onClick={onOpenDiscount}
          aria-label="Apply a discount"
          style={{ flex: 1, height: 48, boxShadow: token.boxShadowTertiary }}
        >
          Discount
        </Button>
      </div>
    </div>
  );
}

export default memo(CartPanel);
