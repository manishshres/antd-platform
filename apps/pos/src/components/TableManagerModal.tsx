import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Button, IconButton, SegmentedButtons, Text, TextInput, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { ApiClient } from '../api/client';
import { useEmployee } from '../state/EmployeeContext';
import { ManagerPinPrompt } from './ManagerPinPrompt';
import { FloorPlanCanvas } from './FloorPlanCanvas';
import type { DiningTable, PosSettings } from '../types';

interface Plan {
  id: string;
  name: string;
  tables: DiningTable[];
}

interface Props {
  visible: boolean;
  onDismiss: () => void;
  settings: PosSettings;
  tables: DiningTable[];
  /** Called after any successful change so the caller can pull the canonical state back down. */
  onMutated: () => void;
}

function groupByFloorPlan(tables: DiningTable[]): Plan[] {
  const map = new Map<string, Plan>();
  for (const t of tables) {
    if (!map.has(t.floorPlanId)) {
      map.set(t.floorPlanId, { id: t.floorPlanId, name: t.floorPlanName, tables: [] });
    }
    map.get(t.floorPlanId)!.tables.push(t);
  }
  return Array.from(map.values());
}

type PlanDialog = { mode: 'add' | 'rename'; id?: string; name: string };
type TableDialog = {
  mode: 'add' | 'edit';
  id?: string;
  floorPlanId: string;
  name: string;
  capacity: string;
  shape: string;
};
type DeleteTarget = { kind: 'plan' | 'table'; id: string; name: string };

/**
 * Structural floor-plan/table manager, reached from TablesScreen. Every
 * mutation is server-first (like the other admin-ish screens — History,
 * Reports, Call History) rather than queued offline, since renaming a table
 * has no useful offline meaning; `onMutated` triggers a sync so the change
 * shows up everywhere else immediately.
 */
export function TableManagerModal({ visible, onDismiss, settings, tables, onMutated }: Props) {
  const { isManager, verifyManagerPin } = useEmployee();
  const client = useMemo(
    () => new ApiClient(settings.apiUrl, settings.apiKey),
    [settings.apiUrl, settings.apiKey],
  );

  const [plans, setPlans] = useState<Plan[]>(() => groupByFloorPlan(tables));
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState(false);
  const [columnWidth, setColumnWidth] = useState(0);

  const [planDialog, setPlanDialog] = useState<PlanDialog | null>(null);
  const [tableDialog, setTableDialog] = useState<TableDialog | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const grouped = groupByFloorPlan(tables);
    setPlans(grouped);
    setSelectedPlanId((prev) => (prev && grouped.some((p) => p.id === prev) ? prev : (grouped[0]?.id ?? null)));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;

  const execute = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      onMutated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  };

  const runGated = (action: () => Promise<void>) => {
    if (isManager) {
      void execute(action);
      return;
    }
    setPinError(null);
    setPendingAction(() => action);
  };

  const submitManagerPin = async (pin: string) => {
    if (!pendingAction) return;
    setPinBusy(true);
    setPinError(null);
    try {
      await verifyManagerPin(pin);
      const action = pendingAction;
      setPendingAction(null);
      await execute(action);
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Could not verify PIN.');
    } finally {
      setPinBusy(false);
    }
  };

  const submitPlanDialog = () => {
    if (!planDialog) return;
    const name = planDialog.name.trim();
    if (!name) {
      setError('Enter a floor plan name.');
      return;
    }
    const dialog = planDialog;
    setPlanDialog(null);
    runGated(async () => {
      if (dialog.mode === 'add') {
        const created = await client.createFloorPlan({ locationId: settings.locationId, name });
        setPlans((prev) => [...prev, { id: created.id, name: created.name, tables: [] }]);
        setSelectedPlanId(created.id);
      } else if (dialog.id) {
        await client.updateFloorPlan(dialog.id, { name });
        setPlans((prev) => prev.map((p) => (p.id === dialog.id ? { ...p, name } : p)));
      }
    });
  };

  const submitTableDialog = () => {
    if (!tableDialog) return;
    const name = tableDialog.name.trim();
    const capacity = parseInt(tableDialog.capacity, 10);
    if (!name) {
      setError('Enter a table name.');
      return;
    }
    if (!Number.isFinite(capacity) || capacity <= 0) {
      setError('Enter a valid seat count.');
      return;
    }
    const dialog = tableDialog;
    setTableDialog(null);
    runGated(async () => {
      if (dialog.mode === 'add') {
        const created = await client.createTable({
          floorPlanId: dialog.floorPlanId,
          name,
          capacity,
          shape: dialog.shape,
        });
        setPlans((prev) =>
          prev.map((p) =>
            p.id === dialog.floorPlanId
              ? {
                  ...p,
                  tables: [
                    ...p.tables,
                    {
                      id: created.id,
                      floorPlanId: dialog.floorPlanId,
                      floorPlanName: p.name,
                      floorPlanWidth: p.tables[0]?.floorPlanWidth ?? 800,
                      floorPlanHeight: p.tables[0]?.floorPlanHeight ?? 600,
                      name: created.name,
                      capacity,
                      shape: dialog.shape,
                      status: 'vacant',
                      activeOrderId: null,
                      activeOrderTotal: 0,
                      posX: 0,
                      posY: 0,
                    },
                  ],
                }
              : p,
          ),
        );
      } else if (dialog.id) {
        await client.updateTable(dialog.id, { name, capacity, shape: dialog.shape });
        setPlans((prev) =>
          prev.map((p) =>
            p.id === dialog.floorPlanId
              ? { ...p, tables: p.tables.map((t) => (t.id === dialog.id ? { ...t, name, capacity, shape: dialog.shape } : t)) }
              : p,
          ),
        );
      }
    });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    runGated(async () => {
      if (target.kind === 'plan') {
        await client.deleteFloorPlan(target.id);
        setPlans((prev) => prev.filter((p) => p.id !== target.id));
        setSelectedPlanId((prev) => (prev === target.id ? null : prev));
      } else {
        await client.deleteTable(target.id);
        setPlans((prev) => prev.map((p) => ({ ...p, tables: p.tables.filter((t) => t.id !== target.id) })));
      }
    });
  };

  // Repositioning is purely visual and trivially reversible (drag it back), so — unlike
  // structural CRUD above — it doesn't go through the manager PIN gate.
  const moveTable = (table: DiningTable, posX: number, posY: number) => {
    void execute(async () => {
      await client.updateTable(table.id, { posX, posY });
      setPlans((prev) =>
        prev.map((p) =>
          p.id === table.floorPlanId
            ? { ...p, tables: p.tables.map((t) => (t.id === table.id ? { ...t, posX, posY } : t)) }
            : p,
        ),
      );
    });
  };

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text variant="titleMedium" style={styles.headerTitle}>
                Manage Tables &amp; Floor Plans
              </Text>
              <Button mode="text" compact onPress={onDismiss} textColor={antd.textSecondary} icon="close">
                Close
              </Button>
            </View>

            {error ? (
              <View style={styles.errorBanner}>
                <MaterialCommunityIcons name="alert-circle-outline" size={16} color={antd.error} />
                <Text variant="labelSmall" style={{ color: antd.error, flex: 1 }}>
                  {error}
                </Text>
              </View>
            ) : null}

            <View style={styles.body}>
              <View style={styles.plansColumn}>
                <View style={styles.columnHeader}>
                  <Text variant="labelLarge" style={styles.columnTitle}>
                    Floor Plans
                  </Text>
                  <IconButton
                    icon="plus"
                    size={18}
                    onPress={() => setPlanDialog({ mode: 'add', name: '' })}
                  />
                </View>
                <ScrollView>
                  {plans.map((p) => (
                    <TouchableRipple
                      key={p.id}
                      onPress={() => setSelectedPlanId(p.id)}
                      style={[styles.planRow, selectedPlanId === p.id && styles.planRowActive]}
                    >
                      <View style={styles.planRowInner}>
                        <View style={{ flex: 1 }}>
                          <Text
                            variant="bodyMedium"
                            style={{ color: antd.text, fontWeight: selectedPlanId === p.id ? '700' : '500' }}
                          >
                            {p.name}
                          </Text>
                          <Text variant="labelSmall" style={{ color: antd.textTertiary }}>
                            {p.tables.length} {p.tables.length === 1 ? 'table' : 'tables'}
                          </Text>
                        </View>
                        <IconButton
                          icon="pencil-outline"
                          size={16}
                          onPress={() => setPlanDialog({ mode: 'rename', id: p.id, name: p.name })}
                        />
                        <IconButton
                          icon="trash-can-outline"
                          size={16}
                          iconColor={antd.error}
                          onPress={() => setDeleteTarget({ kind: 'plan', id: p.id, name: p.name })}
                        />
                      </View>
                    </TouchableRipple>
                  ))}
                  {plans.length === 0 ? (
                    <Text variant="bodySmall" style={styles.emptyHint}>
                      No floor plans yet.
                    </Text>
                  ) : null}
                </ScrollView>
              </View>

              <View style={styles.divider} />

              <View
                style={styles.tablesColumn}
                onLayout={(e) => setColumnWidth(e.nativeEvent.layout.width)}
              >
                <View style={styles.columnHeader}>
                  <Text variant="labelLarge" style={styles.columnTitle} numberOfLines={1}>
                    {selectedPlan?.name ?? 'Tables'}
                  </Text>
                  <IconButton
                    icon={layoutMode ? 'view-grid-outline' : 'floor-plan'}
                    size={18}
                    disabled={!selectedPlanId}
                    onPress={() => setLayoutMode((v) => !v)}
                  />
                  <IconButton
                    icon="plus"
                    size={18}
                    disabled={!selectedPlanId}
                    onPress={() =>
                      selectedPlanId &&
                      setTableDialog({ mode: 'add', floorPlanId: selectedPlanId, name: '', capacity: '4', shape: 'rectangle' })
                    }
                  />
                </View>
                {layoutMode && selectedPlan ? (
                  <>
                    <Text variant="labelSmall" style={styles.emptyHint}>
                      Drag a table to reposition it — saved automatically.
                    </Text>
                    <FloorPlanCanvas
                      tables={selectedPlan.tables}
                      floorWidth={selectedPlan.tables[0]?.floorPlanWidth ?? 800}
                      floorHeight={selectedPlan.tables[0]?.floorPlanHeight ?? 600}
                      containerWidth={Math.max(columnWidth - 8, 100)}
                      editable
                      onMoveTable={moveTable}
                    />
                  </>
                ) : (
                <ScrollView contentContainerStyle={styles.tableGrid}>
                  {(selectedPlan?.tables ?? []).map((t) => (
                    <View key={t.id} style={styles.tableCard}>
                      <Text variant="bodyMedium" style={{ color: antd.text, fontWeight: '600' }} numberOfLines={1}>
                        {t.name}
                      </Text>
                      <Text variant="labelSmall" style={{ color: antd.textTertiary }}>
                        Seats {t.capacity} · {t.shape}
                      </Text>
                      <View style={styles.tableCardActions}>
                        <IconButton
                          icon="pencil-outline"
                          size={16}
                          onPress={() =>
                            setTableDialog({
                              mode: 'edit',
                              id: t.id,
                              floorPlanId: t.floorPlanId,
                              name: t.name,
                              capacity: String(t.capacity),
                              shape: t.shape,
                            })
                          }
                        />
                        <IconButton
                          icon="trash-can-outline"
                          size={16}
                          iconColor={antd.error}
                          onPress={() => setDeleteTarget({ kind: 'table', id: t.id, name: t.name })}
                        />
                      </View>
                    </View>
                  ))}
                  {selectedPlanId && (selectedPlan?.tables.length ?? 0) === 0 ? (
                    <Text variant="bodySmall" style={styles.emptyHint}>
                      No tables in this floor plan yet.
                    </Text>
                  ) : null}
                  {!selectedPlanId ? (
                    <Text variant="bodySmall" style={styles.emptyHint}>
                      Select or add a floor plan first.
                    </Text>
                  ) : null}
                </ScrollView>
                )}
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Add / rename floor plan ── */}
      <Modal visible={planDialog !== null} transparent animationType="fade" onRequestClose={() => setPlanDialog(null)}>
        <View style={styles.backdrop}>
          <View style={styles.formSheet}>
            <Text variant="titleMedium" style={styles.headerTitle}>
              {planDialog?.mode === 'add' ? 'Add Floor Plan' : 'Rename Floor Plan'}
            </Text>
            <TextInput
              mode="outlined"
              label="Name"
              value={planDialog?.name ?? ''}
              onChangeText={(v) => setPlanDialog((d) => (d ? { ...d, name: v } : d))}
              outlineStyle={{ borderRadius: RADIUS }}
              autoFocus
            />
            <View style={styles.formActions}>
              <Button onPress={() => setPlanDialog(null)}>Cancel</Button>
              <Button mode="contained" onPress={submitPlanDialog} style={{ borderRadius: RADIUS }}>
                Save
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Add / edit table ── */}
      <Modal visible={tableDialog !== null} transparent animationType="fade" onRequestClose={() => setTableDialog(null)}>
        <View style={styles.backdrop}>
          <View style={styles.formSheet}>
            <Text variant="titleMedium" style={styles.headerTitle}>
              {tableDialog?.mode === 'add' ? 'Add Table' : 'Edit Table'}
            </Text>
            <TextInput
              mode="outlined"
              label="Name"
              value={tableDialog?.name ?? ''}
              onChangeText={(v) => setTableDialog((d) => (d ? { ...d, name: v } : d))}
              outlineStyle={{ borderRadius: RADIUS }}
              autoFocus
            />
            <TextInput
              mode="outlined"
              label="Seats"
              keyboardType="number-pad"
              value={tableDialog?.capacity ?? ''}
              onChangeText={(v) => setTableDialog((d) => (d ? { ...d, capacity: v } : d))}
              outlineStyle={{ borderRadius: RADIUS }}
            />
            <SegmentedButtons
              value={tableDialog?.shape ?? 'rectangle'}
              onValueChange={(v) => setTableDialog((d) => (d ? { ...d, shape: v } : d))}
              buttons={[
                { value: 'rectangle', label: 'Rectangle' },
                { value: 'circle', label: 'Round' },
              ]}
            />
            <View style={styles.formActions}>
              <Button onPress={() => setTableDialog(null)}>Cancel</Button>
              <Button mode="contained" onPress={submitTableDialog} style={{ borderRadius: RADIUS }}>
                Save
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Delete confirmation ── */}
      <Modal visible={deleteTarget !== null} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <View style={styles.backdrop}>
          <View style={styles.formSheet}>
            <Text variant="titleMedium" style={styles.headerTitle}>
              Delete {deleteTarget?.kind === 'plan' ? 'Floor Plan' : 'Table'}?
            </Text>
            <Text variant="bodyMedium" style={{ color: antd.textSecondary }}>
              {deleteTarget?.kind === 'plan'
                ? `Delete "${deleteTarget?.name}" and everything on it? This cannot be undone.`
                : `Delete table "${deleteTarget?.name}"? This cannot be undone.`}
            </Text>
            <View style={styles.formActions}>
              <Button onPress={() => setDeleteTarget(null)}>Cancel</Button>
              <Button textColor={antd.error} onPress={confirmDelete}>
                Delete
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      <ManagerPinPrompt
        visible={pendingAction !== null}
        reason="Approve floor plan change"
        busy={pinBusy}
        errorMessage={pinError}
        onSubmit={submitManagerPin}
        onCancel={() => setPendingAction(null)}
      />
    </>
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
    maxWidth: 820,
    height: '85%',
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS * 2,
    padding: 16,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: antd.text, fontWeight: '700' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: antd.errorBg,
    borderRadius: RADIUS,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  body: { flex: 1, flexDirection: 'row', gap: 12 },
  divider: { width: 1, backgroundColor: antd.split },
  plansColumn: { width: 260 },
  tablesColumn: { flex: 1 },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  columnTitle: { color: antd.textSecondary, fontWeight: '700', flex: 1 },
  planRow: {
    borderRadius: RADIUS,
    marginVertical: 2,
  },
  planRowActive: { backgroundColor: antd.primaryBg },
  planRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  tableGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 4,
    paddingBottom: 12,
  },
  tableCard: {
    width: 150,
    borderWidth: 1,
    borderColor: antd.border,
    borderRadius: RADIUS,
    padding: 10,
    backgroundColor: antd.bgLayout,
  },
  tableCardActions: { flexDirection: 'row', marginTop: 4 },
  emptyHint: { color: antd.textTertiary, padding: 12 },
  formSheet: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS * 2,
    padding: 20,
    gap: 14,
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
});
