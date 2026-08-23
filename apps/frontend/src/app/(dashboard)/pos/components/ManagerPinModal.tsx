"use client";

import React, { useEffect, useState } from "react";
import { Alert, Input, Modal, Typography } from "antd";

const { Text } = Typography;

interface Props {
  open: boolean;
  /** What the PIN is authorising, e.g. "Save changes to order #47". */
  title: string;
  busy?: boolean;
  /** Server-side rejection (wrong PIN, order already paid) shown above the field. */
  error?: string | null;
  onCancel: () => void;
  onSubmit: (pin: string) => void;
}

/**
 * Manager PIN gate for editing an order after it has been placed.
 *
 * The backend requires a manager PIN on `PUT /orders/:id/items` — an order already sent
 * to the kitchen is a financial record, so changing it needs someone accountable. The
 * register never collected one, so every edit came back 400 and the operator was left
 * on a screen that would not save.
 */
export default function ManagerPinModal({
  open,
  title,
  busy = false,
  error,
  onCancel,
  onSubmit,
}: Props) {
  const [pin, setPin] = useState("");

  // Never carry a PIN across openings — the next edit may be a different manager.
  useEffect(() => {
    if (!open) setPin("");
  }, [open]);

  return (
    <Modal
      open={open}
      title={title}
      okText="Authorize"
      onOk={() => onSubmit(pin)}
      okButtonProps={{ disabled: pin.length !== 6, loading: busy }}
      onCancel={onCancel}
      cancelButtonProps={{ disabled: busy }}
      destroyOnHidden
    >
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          style={{ marginBottom: 12 }}
        />
      )}
      <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
        Enter a manager PIN to authorize this change.
      </Text>
      <Input.OTP
        length={6}
        mask="●"
        value={pin}
        onChange={setPin}
        // Enter submits, so a manager can authorise without reaching for the mouse.
        onInput={(value) => {
          if (value.join("").length === 6) setPin(value.join(""));
        }}
        aria-label="Manager PIN"
      />
    </Modal>
  );
}
