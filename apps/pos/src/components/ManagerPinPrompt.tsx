import React from 'react';
import { PinPadModal } from './PinPadModal';

interface Props {
  visible: boolean;
  title?: string;
  reason?: string;
  busy?: boolean;
  errorMessage?: string | null;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}

export function ManagerPinPrompt({
  visible,
  title = 'Manager approval required',
  reason,
  busy = false,
  errorMessage = null,
  onSubmit,
  onCancel,
}: Props) {
  return (
    <PinPadModal
      visible={visible}
      title={title}
      subtitle={reason}
      busy={busy}
      errorMessage={errorMessage}
      onSubmit={onSubmit}
      onCancel={busy ? undefined : onCancel}
    />
  );
}
