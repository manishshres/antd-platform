"use client";

import { useState } from "react";
import { App, Checkbox, Input, Modal, Radio, Tag, Typography, theme } from "antd";
import { fmtMoney } from "../types";
import type { CartOption, MenuItem, ModifierOption } from "../types";

const { Text } = Typography;

interface Props {
  /** Item being configured; null hides the modal. */
  item: MenuItem | null;
  /** Prefill (editing an existing cart line): option ids per group id. */
  initialSelections: Record<string, string[]>;
  initialNotes: string;
  /** True when editing an existing cart line (changes the OK label). */
  editing: boolean;
  onCancel: () => void;
  onConfirm: (options: CartOption[], notes?: string) => void;
}

/**
 * Modifier picker. Selections are arrays per group: single-select groups hold
 * at most one id, multi-select groups hold up to maxSelections ids.
 */
export default function ModifierPickerModal({
  item,
  initialSelections,
  initialNotes,
  editing,
  onCancel,
  onConfirm,
}: Props) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState("");

  // Re-seed local state each time the picker opens for an item — the
  // render-time "derive state from props" pattern (no effect needed).
  const [seededFor, setSeededFor] = useState<MenuItem | null>(null);
  if (item !== seededFor) {
    setSeededFor(item);
    if (item) {
      setSelections(initialSelections);
      setNotes(initialNotes);
    }
  }

  const confirm = () => {
    if (!item) return;
    const groups = item.modifiers ?? [];
    for (const g of groups) {
      const picked = selections[g.id] ?? [];
      if (g.isRequired && picked.length === 0) {
        message.warning(`Please choose a ${g.name}.`);
        return;
      }
      if (
        g.multiSelect &&
        g.maxSelections != null &&
        picked.length > g.maxSelections
      ) {
        message.warning(`${g.name}: choose at most ${g.maxSelections}.`);
        return;
      }
    }
    const options: CartOption[] = [];
    for (const g of groups) {
      for (const optId of selections[g.id] ?? []) {
        const opt = g.options.find((o) => o.id === optId);
        if (opt) {
          options.push({
            id: opt.id,
            name: opt.name,
            priceAdjustment: opt.priceAdjustment,
            groupName: g.name,
          });
        }
      }
    }
    onConfirm(options, notes.trim() || undefined);
  };

  return (
    <Modal
      open={item !== null}
      title={item?.name}
      onCancel={onCancel}
      onOk={confirm}
      okText={editing ? "Update item" : "Add to order"}
      destroyOnHidden
    >
      {(item?.modifiers ?? []).map((group) => {
        const picked = selections[group.id] ?? [];
        const atCap =
          group.multiSelect &&
          group.maxSelections != null &&
          picked.length >= group.maxSelections;
        const optionLabel = (opt: ModifierOption) => (
          <>
            {opt.name}
            {opt.priceAdjustment !== 0 && (
              <Text type="secondary"> (+{fmtMoney(opt.priceAdjustment)})</Text>
            )}
          </>
        );
        return (
          <div key={group.id} style={{ marginBottom: token.margin }}>
            <Text strong>
              {group.name}{" "}
              {group.isRequired ? (
                <Tag color="red">required</Tag>
              ) : (
                <Tag>optional</Tag>
              )}
              {group.multiSelect && (
                <Tag color="blue">
                  {group.maxSelections != null
                    ? `choose up to ${group.maxSelections}`
                    : "choose any"}
                </Tag>
              )}
            </Text>
            {group.multiSelect ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  marginTop: 6,
                }}
              >
                {group.options.map((opt) => (
                  <Checkbox
                    key={opt.id}
                    checked={picked.includes(opt.id)}
                    // Cap enforcement: once at maxSelections, only unchecking is allowed.
                    disabled={atCap ? !picked.includes(opt.id) : false}
                    onChange={(e) =>
                      setSelections((prev) => ({
                        ...prev,
                        [group.id]: e.target.checked
                          ? [...picked, opt.id]
                          : picked.filter((id) => id !== opt.id),
                      }))
                    }
                  >
                    {optionLabel(opt)}
                  </Checkbox>
                ))}
              </div>
            ) : (
              <Radio.Group
                value={picked[0]}
                onChange={(e) =>
                  setSelections((prev) => ({
                    ...prev,
                    [group.id]:
                      e.target.value == null ? [] : [e.target.value as string],
                  }))
                }
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  marginTop: 6,
                }}
              >
                {!group.isRequired && <Radio value={undefined}>No thanks</Radio>}
                {group.options.map((opt) => (
                  <Radio key={opt.id} value={opt.id}>
                    {optionLabel(opt)}
                  </Radio>
                ))}
              </Radio.Group>
            )}
          </div>
        );
      })}
      <Input.TextArea
        rows={2}
        placeholder="Kitchen note (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={500}
        aria-label="Kitchen note"
      />
    </Modal>
  );
}
