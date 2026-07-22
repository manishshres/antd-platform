import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Chip, Divider, Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { formatMoney } from '../utils/money';
import { OrderStatusChip } from './OrderStatusChip';
import { ApiClient } from '../api/client';
import * as ordersRepo from '../db/ordersRepo';
import { paymentMethodLabel, type LocalOrder, type ServerOrderDetail } from '../types';
import type { PosSettings } from '../types';

interface Props {
  visible: boolean;
  orderId: string | null;
  isLocal: boolean;
  settings: PosSettings;
  online: boolean;
  onDismiss: () => void;
}

type DetailState =
  | { kind: 'loading' }
  | { kind: 'local'; order: LocalOrder }
  | { kind: 'server'; order: ServerOrderDetail }
  | { kind: 'error'; message: string };

export function OrderDetailModal({
  visible,
  orderId,
  isLocal,
  settings,
  online,
  onDismiss,
}: Props) {
  const [detail, setDetail] = useState<DetailState>({ kind: 'loading' });

  useEffect(() => {
    if (!visible || !orderId) return;
    setDetail({ kind: 'loading' });

    if (isLocal) {
      const order = ordersRepo.getOrderById(orderId);
      setDetail(order ? { kind: 'local', order } : { kind: 'error', message: 'Order not found locally.' });
      return;
    }

    if (online) {
      const client = new ApiClient(settings.apiUrl, settings.apiKey);
      client
        .getOrderById(orderId)
        .then((order) => setDetail({ kind: 'server', order }))
        .catch((err: Error) =>
          setDetail({ kind: 'error', message: err.message ?? 'Failed to load order.' }),
        );
    } else {
      setDetail({ kind: 'error', message: 'Go online to load server order details.' });
    }
  }, [visible, orderId, isLocal, online, settings.apiUrl, settings.apiKey]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text variant="titleMedium" style={styles.headerTitle}>
              Order Details
            </Text>
            <Button
              mode="text"
              compact
              onPress={onDismiss}
              textColor={antd.textSecondary}
              icon="close"
            >
              Close
            </Button>
          </View>
          <Divider />

          <ScrollView contentContainerStyle={styles.body}>
            {detail.kind === 'loading' && (
              <View style={styles.centered}>
                <ActivityIndicator />
              </View>
            )}
            {detail.kind === 'error' && (
              <View style={styles.centered}>
                <MaterialCommunityIcons
                  name="alert-circle-outline"
                  size={36}
                  color={antd.error}
                />
                <Text variant="bodyMedium" style={{ color: antd.textSecondary, textAlign: 'center' }}>
                  {detail.message}
                </Text>
              </View>
            )}
            {detail.kind === 'local' && <LocalOrderDetail order={detail.order} />}
            {detail.kind === 'server' && <ServerDetail order={detail.order} />}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Local order detail ──────────────────────────────────────────────────────

function LocalOrderDetail({ order }: { order: LocalOrder }) {
  return (
    <View style={styles.detail}>
      <OrderMeta
        ticket={order.ticketNumber ? `#${order.ticketNumber}` : '(not synced)'}
        status={order.status}
        createdAt={order.createdAt}
        orderType={order.orderType}
      />

      {(order.customerName !== 'Walk-in' || order.customerPhone) && (
        <Section title="Customer">
          <InfoRow label="Name" value={order.customerName} />
          {order.customerPhone ? <InfoRow label="Phone" value={order.customerPhone} /> : null}
        </Section>
      )}

      {order.tableName && (
        <Section title="Table">
          <InfoRow label="Table" value={order.tableName} />
          {order.guests ? <InfoRow label="Guests" value={String(order.guests)} /> : null}
        </Section>
      )}

      <Section title="Items">
        {order.items.map((item, i) => (
          <View key={i} style={styles.itemRow}>
            <View style={styles.itemInfo}>
              <Text variant="bodyMedium" style={{ color: antd.text }}>
                {item.quantity} × {item.name}
              </Text>
              {item.notes ? (
                <Text variant="labelSmall" style={styles.itemNote}>{item.notes}</Text>
              ) : null}
            </View>
            <Text variant="bodyMedium" style={styles.itemPrice}>
              {formatMoney(item.unitPrice * item.quantity)}
            </Text>
          </View>
        ))}
      </Section>

      {order.specialInstructions ? (
        <Section title="Special Instructions">
          <Text variant="bodySmall" style={{ color: antd.textSecondary }}>
            {order.specialInstructions}
          </Text>
        </Section>
      ) : null}

      <Section title="Totals">
        <TotalRow label="Subtotal" value={formatMoney(order.subtotal)} />
        {order.discountAmount > 0 && (
          <TotalRow
            label={order.discountName ? `Discount (${order.discountName})` : 'Discount'}
            value={`-${formatMoney(order.discountAmount)}`}
            highlight="success"
          />
        )}
        <TotalRow label="Tax" value={formatMoney(order.taxAmount)} />
        <Divider style={{ marginVertical: 6 }} />
        <TotalRow label="Total" value={formatMoney(order.totalAmount)} bold />
      </Section>

      {order.paymentMethod && (
        <Section title="Payment">
          <InfoRow label="Method" value={paymentMethodLabel(order.paymentMethod)} />
          {order.tenderedAmount != null && order.paymentMethod === 'cash' && (
            <InfoRow label="Tendered" value={formatMoney(order.tenderedAmount)} />
          )}
          {order.changeAmount != null && order.changeAmount > 0 && (
            <InfoRow label="Change" value={formatMoney(order.changeAmount)} />
          )}
        </Section>
      )}

      {order.errorMessage && (
        <Section title="Sync Error">
          <Text variant="bodySmall" style={{ color: antd.error }}>
            {order.errorMessage}
          </Text>
        </Section>
      )}
    </View>
  );
}

// ── Server order detail ─────────────────────────────────────────────────────

function ServerDetail({ order }: { order: ServerOrderDetail }) {
  return (
    <View style={styles.detail}>
      <OrderMeta
        ticket={order.ticketNumber ? `#${order.ticketNumber}` : '—'}
        status={order.status}
        createdAt={order.createdAt}
        orderType={order.orderType ?? undefined}
      />

      {(order.customer || order.customerName) && (
        <Section title="Customer">
          <InfoRow label="Name" value={order.customer?.name ?? order.customerName} />
          {(order.customer?.phone || order.customerPhone) ? (
            <InfoRow label="Phone" value={order.customer?.phone ?? order.customerPhone} />
          ) : null}
          {order.customer?.email ? (
            <InfoRow label="Email" value={order.customer.email} />
          ) : null}
        </Section>
      )}

      {order.table && (
        <Section title="Table">
          <InfoRow label="Table" value={order.table.name} />
        </Section>
      )}

      {order.items && order.items.length > 0 && (
        <Section title="Items">
          {order.items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <View style={styles.itemInfo}>
                <Text variant="bodyMedium" style={{ color: antd.text }}>
                  {item.quantity} × {item.name}
                </Text>
                {item.notes ? (
                  <Text variant="labelSmall" style={styles.itemNote}>{item.notes}</Text>
                ) : null}
              </View>
              <Text variant="bodyMedium" style={styles.itemPrice}>
                {formatMoney(item.unitPrice * item.quantity)}
              </Text>
            </View>
          ))}
        </Section>
      )}

      {order.specialInstructions ? (
        <Section title="Special Instructions">
          <Text variant="bodySmall" style={{ color: antd.textSecondary }}>
            {order.specialInstructions}
          </Text>
        </Section>
      ) : null}

      <Section title="Totals">
        {order.subtotal != null && <TotalRow label="Subtotal" value={formatMoney(order.subtotal)} />}
        {order.discountAmount != null && order.discountAmount > 0 && (
          <TotalRow label="Discount" value={`-${formatMoney(order.discountAmount)}`} highlight="success" />
        )}
        {order.taxAmount != null && <TotalRow label="Tax" value={formatMoney(order.taxAmount)} />}
        <Divider style={{ marginVertical: 6 }} />
        <TotalRow label="Total" value={formatMoney(order.totalAmount)} bold />
      </Section>

      {order.paymentMethod && (
        <Section title="Payment">
          <InfoRow label="Method" value={paymentMethodLabel(order.paymentMethod)} />
          {order.tenderedAmount != null && order.paymentMethod === 'cash' && (
            <InfoRow label="Tendered" value={formatMoney(order.tenderedAmount)} />
          )}
          {order.changeAmount != null && order.changeAmount > 0 && (
            <InfoRow label="Change" value={formatMoney(order.changeAmount)} />
          )}
          {order.paidAt && (
            <InfoRow label="Paid at" value={new Date(order.paidAt).toLocaleString()} />
          )}
        </Section>
      )}
    </View>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────

function OrderMeta({
  ticket,
  status,
  createdAt,
  orderType,
}: {
  ticket: string;
  status: string;
  createdAt: string;
  orderType?: string;
}) {
  return (
    <View style={styles.meta}>
      <View style={styles.metaRow}>
        <Text variant="headlineSmall" style={styles.ticket}>
          {ticket}
        </Text>
        <OrderStatusChip status={status} />
      </View>
      <View style={styles.metaRow}>
        <Text variant="labelMedium" style={{ color: antd.textTertiary }}>
          {new Date(createdAt).toLocaleString()}
        </Text>
        {orderType && (
          <Chip
            compact
            style={styles.typeChip}
            textStyle={{ fontSize: 11 }}
          >
            {orderType.replace('_', ' ')}
          </Chip>
        )}
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="labelSmall" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text variant="bodySmall" style={styles.infoLabel}>{label}</Text>
      <Text variant="bodySmall" style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function TotalRow({
  label,
  value,
  bold,
  highlight,
}: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: 'success' | 'error';
}) {
  const color = highlight === 'success' ? antd.success : highlight === 'error' ? antd.error : antd.text;
  return (
    <View style={styles.totalRow}>
      <Text
        variant={bold ? 'titleSmall' : 'bodySmall'}
        style={{ color: bold ? antd.text : antd.textSecondary, fontWeight: bold ? '700' : '400' }}
      >
        {label}
      </Text>
      <Text
        variant={bold ? 'titleSmall' : 'bodySmall'}
        style={{ color, fontWeight: bold ? '700' : '400' }}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '90%',
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS * 2,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerTitle: { color: antd.text, fontWeight: '700' },
  body: { padding: 20, gap: 16, paddingBottom: 28 },
  centered: { alignItems: 'center', paddingVertical: 40, gap: 12 },

  detail: { gap: 16 },
  meta: { gap: 6 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  ticket: { color: antd.text, fontWeight: '800' },
  typeChip: {
    backgroundColor: antd.bgLayout,
  },

  section: { gap: 8 },
  sectionTitle: {
    color: antd.textTertiary,
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  infoLabel: { color: antd.textSecondary },
  infoValue: { color: antd.text, fontWeight: '500', flexShrink: 1, textAlign: 'right' },

  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
  },
  itemInfo: { flex: 1, gap: 2 },
  itemNote: { color: antd.textTertiary, fontStyle: 'italic' },
  itemPrice: { color: antd.text, fontWeight: '600', minWidth: 72, textAlign: 'right' },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
});
