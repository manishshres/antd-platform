import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Button, IconButton, Text, TextInput, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { ApiClient } from '../api/client';
import { useEmployee } from '../state/EmployeeContext';
import { ManagerPinPrompt } from './ManagerPinPrompt';
import { formatMoney, parseMoney } from '../utils/money';
import * as catalogRepo from '../db/catalogRepo';
import type { Category, ModifierGroup, PosSettings, Product } from '../types';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  settings: PosSettings;
  /** Called after any successful change so the caller can pull the canonical state back down. */
  onMutated: () => void;
}

type CategoryDialog = { mode: 'add' | 'rename'; id?: string; name: string };
type ItemDialog = {
  mode: 'add' | 'edit';
  id?: string;
  categoryId: string;
  name: string;
  price: string;
  description: string;
  sku: string;
  imageUrl: string;
  isAvailable: boolean;
  isFavorite: boolean;
  taxExempt: boolean;
  modifiers: ModifierGroup[];
};
type GroupDialog = { name: string; isRequired: boolean; multiSelect: boolean; maxSelections: string };
type OptionDialog = { modifierId: string; name: string; priceAdjustment: string };
type DeleteTarget =
  | { kind: 'category'; id: string; name: string }
  | { kind: 'item'; id: string; name: string; categoryId: string }
  | { kind: 'group'; id: string; name: string }
  | { kind: 'option'; id: string; name: string; modifierId: string };

/**
 * Menu structure manager reachable from HomeScreen. Every mutation is
 * server-first (same reasoning as TableManagerModal — a menu edit has no
 * useful offline meaning); `onMutated` triggers a sync so the change shows
 * up everywhere else immediately.
 */
export function MenuManagementModal({ visible, onDismiss, settings, onMutated }: Props) {
  const { isManager, verifyManagerPin } = useEmployee();
  const client = useMemo(
    () => new ApiClient(settings.apiUrl, settings.apiKey),
    [settings.apiUrl, settings.apiKey],
  );

  const [categories, setCategories] = useState<Category[]>([]);
  const [itemsByCategory, setItemsByCategory] = useState<Record<string, Product[]>>({});
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showGroups, setShowGroups] = useState(false);

  const [categoryDialog, setCategoryDialog] = useState<CategoryDialog | null>(null);
  const [itemDialog, setItemDialog] = useState<ItemDialog | null>(null);
  const [groupDialog, setGroupDialog] = useState<GroupDialog | null>(null);
  const [optionDialog, setOptionDialog] = useState<OptionDialog | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const cats = catalogRepo.getCategories();
    setCategories(cats);
    setItemsByCategory(Object.fromEntries(cats.map((c) => [c.id, catalogRepo.getAllProducts(c.id)])));
    setSelectedCategoryId((prev) => (prev && cats.some((c) => c.id === prev) ? prev : (cats[0]?.id ?? null)));
    setError(null);
    client
      .getModifierGroups(settings.locationId || undefined)
      .then(setGroups)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load modifier groups.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const selectedItems = selectedCategoryId ? (itemsByCategory[selectedCategoryId] ?? []) : [];

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

  // ── Categories ──────────────────────────────────────────────────────────
  const submitCategoryDialog = () => {
    if (!categoryDialog) return;
    const name = categoryDialog.name.trim();
    if (!name) {
      setError('Enter a category name.');
      return;
    }
    const dialog = categoryDialog;
    setCategoryDialog(null);
    runGated(async () => {
      if (dialog.mode === 'add') {
        const created = await client.createCategory({ name, locationId: settings.locationId || undefined });
        setCategories((prev) => [...prev, { id: created.id, name: created.name, sortOrder: prev.length }]);
        setItemsByCategory((prev) => ({ ...prev, [created.id]: [] }));
        setSelectedCategoryId(created.id);
      } else if (dialog.id) {
        await client.updateCategory(dialog.id, { name });
        setCategories((prev) => prev.map((c) => (c.id === dialog.id ? { ...c, name } : c)));
      }
    });
  };

  // ── Items ───────────────────────────────────────────────────────────────
  const submitItemDialog = () => {
    if (!itemDialog) return;
    const name = itemDialog.name.trim();
    const price = parseMoney(itemDialog.price);
    if (!name) {
      setError('Enter an item name.');
      return;
    }
    if (Number.isNaN(price) || price < 0) {
      setError('Enter a valid price.');
      return;
    }
    const dialog = itemDialog;
    setItemDialog(null);
    runGated(async () => {
      const common = {
        name,
        price,
        description: dialog.description.trim() || undefined,
        sku: dialog.sku.trim() || undefined,
        imageUrl: dialog.imageUrl.trim() || undefined,
        isAvailable: dialog.isAvailable,
        isFavorite: dialog.isFavorite,
        taxExempt: dialog.taxExempt,
      };
      if (dialog.mode === 'add') {
        const created = await client.createMenuItem({ ...common, categoryId: dialog.categoryId });
        const newProduct: Product = {
          id: created.id,
          categoryId: dialog.categoryId,
          name: created.name,
          description: common.description ?? null,
          price,
          imageUrl: common.imageUrl ?? null,
          isAvailable: dialog.isAvailable,
          isFavorite: dialog.isFavorite,
          sortOrder: (itemsByCategory[dialog.categoryId]?.length ?? 0),
          modifiers: [],
          sku: common.sku ?? null,
          isCombo: false,
          taxExempt: dialog.taxExempt,
          stockQuantity: null,
          lowStockThreshold: null,
        };
        setItemsByCategory((prev) => ({
          ...prev,
          [dialog.categoryId]: [...(prev[dialog.categoryId] ?? []), newProduct],
        }));
      } else if (dialog.id) {
        await client.updateMenuItem(dialog.id, common);
        setItemsByCategory((prev) => ({
          ...prev,
          [dialog.categoryId]: (prev[dialog.categoryId] ?? []).map((p) =>
            p.id === dialog.id
              ? {
                  ...p,
                  name,
                  price,
                  description: common.description ?? null,
                  imageUrl: common.imageUrl ?? null,
                  sku: common.sku ?? null,
                  isAvailable: dialog.isAvailable,
                  isFavorite: dialog.isFavorite,
                  taxExempt: dialog.taxExempt,
                }
              : p,
          ),
        }));
      }
    });
  };

  const assignGroupToItem = (item: Product, group: ModifierGroup) => {
    runGated(async () => {
      await client.assignModifierToItem(item.id, group.id);
      setItemsByCategory((prev) => ({
        ...prev,
        [item.categoryId]: (prev[item.categoryId] ?? []).map((p) =>
          p.id === item.id ? { ...p, modifiers: [...p.modifiers, group] } : p,
        ),
      }));
      setItemDialog((d) => (d && d.id === item.id ? { ...d, modifiers: [...d.modifiers, group] } : d));
    });
  };

  // ── Modifier groups ─────────────────────────────────────────────────────
  const submitGroupDialog = () => {
    if (!groupDialog) return;
    const name = groupDialog.name.trim();
    if (!name) {
      setError('Enter a modifier group name.');
      return;
    }
    const maxSelections = groupDialog.maxSelections.trim()
      ? parseInt(groupDialog.maxSelections, 10)
      : undefined;
    const dialog = groupDialog;
    setGroupDialog(null);
    runGated(async () => {
      const created = await client.createModifierGroup({
        name,
        locationId: settings.locationId || undefined,
        isRequired: dialog.isRequired,
        multiSelect: dialog.multiSelect,
        maxSelections,
      });
      setGroups((prev) => [
        ...prev,
        {
          id: created.id,
          name: created.name,
          isRequired: dialog.isRequired,
          multiSelect: dialog.multiSelect,
          maxSelections: maxSelections ?? null,
          options: [],
        },
      ]);
    });
  };

  const submitOptionDialog = () => {
    if (!optionDialog) return;
    const name = optionDialog.name.trim();
    const priceAdjustment = parseMoney(optionDialog.priceAdjustment || '0');
    if (!name) {
      setError('Enter an option name.');
      return;
    }
    const dialog = optionDialog;
    setOptionDialog(null);
    runGated(async () => {
      const created = await client.createModifierOption(dialog.modifierId, { name, priceAdjustment });
      setGroups((prev) =>
        prev.map((g) =>
          g.id === dialog.modifierId
            ? { ...g, options: [...g.options, { id: created.id, name: created.name, priceAdjustment }] }
            : g,
        ),
      );
    });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    runGated(async () => {
      if (target.kind === 'category') {
        await client.deleteCategory(target.id);
        setCategories((prev) => prev.filter((c) => c.id !== target.id));
        setSelectedCategoryId((prev) => (prev === target.id ? null : prev));
      } else if (target.kind === 'item') {
        await client.deleteMenuItem(target.id);
        setItemsByCategory((prev) => ({
          ...prev,
          [target.categoryId]: (prev[target.categoryId] ?? []).filter((p) => p.id !== target.id),
        }));
      } else if (target.kind === 'group') {
        await client.deleteModifierGroup(target.id);
        setGroups((prev) => prev.filter((g) => g.id !== target.id));
      } else {
        await client.deleteModifierOption(target.id);
        setGroups((prev) =>
          prev.map((g) =>
            g.id === target.modifierId ? { ...g, options: g.options.filter((o) => o.id !== target.id) } : g,
          ),
        );
      }
    });
  };

  const openAddItem = () => {
    if (!selectedCategoryId) return;
    setItemDialog({
      mode: 'add',
      categoryId: selectedCategoryId,
      name: '',
      price: '',
      description: '',
      sku: '',
      imageUrl: '',
      isAvailable: true,
      isFavorite: false,
      taxExempt: false,
      modifiers: [],
    });
  };

  const openEditItem = (item: Product) => {
    setItemDialog({
      mode: 'edit',
      id: item.id,
      categoryId: item.categoryId,
      name: item.name,
      price: (item.price / 100).toFixed(2),
      description: item.description ?? '',
      sku: item.sku ?? '',
      imageUrl: item.imageUrl ?? '',
      isAvailable: item.isAvailable,
      isFavorite: item.isFavorite,
      taxExempt: item.taxExempt,
      modifiers: item.modifiers,
    });
  };

  const unassignedGroups = itemDialog
    ? groups.filter((g) => !itemDialog.modifiers.some((m) => m.id === g.id))
    : [];

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text variant="titleMedium" style={styles.headerTitle}>
                Manage Menu
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Button mode="text" compact icon="tune" onPress={() => setShowGroups(true)}>
                  Modifier Groups
                </Button>
                <Button mode="text" compact onPress={onDismiss} textColor={antd.textSecondary} icon="close">
                  Close
                </Button>
              </View>
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
              <View style={styles.categoriesColumn}>
                <View style={styles.columnHeader}>
                  <Text variant="labelLarge" style={styles.columnTitle}>
                    Categories
                  </Text>
                  <IconButton icon="plus" size={18} onPress={() => setCategoryDialog({ mode: 'add', name: '' })} />
                </View>
                <ScrollView>
                  {categories.map((c) => (
                    <TouchableRipple
                      key={c.id}
                      onPress={() => setSelectedCategoryId(c.id)}
                      style={[styles.rowItem, selectedCategoryId === c.id && styles.rowItemActive]}
                    >
                      <View style={styles.rowItemInner}>
                        <View style={{ flex: 1 }}>
                          <Text
                            variant="bodyMedium"
                            style={{ color: antd.text, fontWeight: selectedCategoryId === c.id ? '700' : '500' }}
                            numberOfLines={1}
                          >
                            {c.name}
                          </Text>
                          <Text variant="labelSmall" style={{ color: antd.textTertiary }}>
                            {(itemsByCategory[c.id] ?? []).length} items
                          </Text>
                        </View>
                        <IconButton
                          icon="pencil-outline"
                          size={16}
                          onPress={() => setCategoryDialog({ mode: 'rename', id: c.id, name: c.name })}
                        />
                        <IconButton
                          icon="trash-can-outline"
                          size={16}
                          iconColor={antd.error}
                          onPress={() => setDeleteTarget({ kind: 'category', id: c.id, name: c.name })}
                        />
                      </View>
                    </TouchableRipple>
                  ))}
                  {categories.length === 0 ? (
                    <Text variant="bodySmall" style={styles.emptyHint}>
                      No categories yet.
                    </Text>
                  ) : null}
                </ScrollView>
              </View>

              <View style={styles.divider} />

              <View style={styles.itemsColumn}>
                <View style={styles.columnHeader}>
                  <Text variant="labelLarge" style={styles.columnTitle} numberOfLines={1}>
                    {categories.find((c) => c.id === selectedCategoryId)?.name ?? 'Items'}
                  </Text>
                  <IconButton icon="plus" size={18} disabled={!selectedCategoryId} onPress={openAddItem} />
                </View>
                <ScrollView>
                  {selectedItems.map((item) => (
                    <View key={item.id} style={styles.itemRow}>
                      <TouchableRipple onPress={() => openEditItem(item)} style={{ flex: 1 }}>
                        <View style={styles.itemRowInner}>
                          <View style={{ flex: 1 }}>
                            <Text
                              variant="bodyMedium"
                              style={{ color: antd.text, fontWeight: '600', opacity: item.isAvailable ? 1 : 0.5 }}
                              numberOfLines={1}
                            >
                              {item.name}
                            </Text>
                            <Text variant="labelSmall" style={{ color: antd.textTertiary }}>
                              {formatMoney(item.price)}
                              {!item.isAvailable ? '  ·  disabled' : ''}
                              {item.sku ? `  ·  ${item.sku}` : ''}
                            </Text>
                          </View>
                        </View>
                      </TouchableRipple>
                      <Switch
                        value={item.isAvailable}
                        onValueChange={(v) =>
                          runGated(async () => {
                            await client.updateMenuItem(item.id, { isAvailable: v });
                            setItemsByCategory((prev) => ({
                              ...prev,
                              [item.categoryId]: (prev[item.categoryId] ?? []).map((p) =>
                                p.id === item.id ? { ...p, isAvailable: v } : p,
                              ),
                            }));
                          })
                        }
                      />
                      <IconButton
                        icon="trash-can-outline"
                        size={16}
                        iconColor={antd.error}
                        onPress={() => setDeleteTarget({ kind: 'item', id: item.id, name: item.name, categoryId: item.categoryId })}
                      />
                    </View>
                  ))}
                  {selectedCategoryId && selectedItems.length === 0 ? (
                    <Text variant="bodySmall" style={styles.emptyHint}>
                      No items in this category yet.
                    </Text>
                  ) : null}
                  {!selectedCategoryId ? (
                    <Text variant="bodySmall" style={styles.emptyHint}>
                      Select or add a category first.
                    </Text>
                  ) : null}
                </ScrollView>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Add / rename category ── */}
      <Modal visible={categoryDialog !== null} transparent animationType="fade" onRequestClose={() => setCategoryDialog(null)}>
        <View style={styles.backdrop}>
          <View style={styles.formSheet}>
            <Text variant="titleMedium" style={styles.headerTitle}>
              {categoryDialog?.mode === 'add' ? 'Add Category' : 'Rename Category'}
            </Text>
            <TextInput
              mode="outlined"
              label="Name"
              value={categoryDialog?.name ?? ''}
              onChangeText={(v) => setCategoryDialog((d) => (d ? { ...d, name: v } : d))}
              outlineStyle={{ borderRadius: RADIUS }}
              autoFocus
            />
            <View style={styles.formActions}>
              <Button onPress={() => setCategoryDialog(null)}>Cancel</Button>
              <Button mode="contained" onPress={submitCategoryDialog} style={{ borderRadius: RADIUS }}>
                Save
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Add / edit item — full-screen-style takeover, roomier than a small popup ── */}
      <Modal visible={itemDialog !== null} transparent animationType="fade" onRequestClose={() => setItemDialog(null)}>
        <View style={styles.backdrop}>
          <View style={styles.itemSheet}>
            <View style={styles.header}>
              <Text variant="titleLarge" style={styles.headerTitle}>
                {itemDialog?.mode === 'add' ? 'Add Item' : 'Edit Item'}
              </Text>
              <Button mode="text" compact onPress={() => setItemDialog(null)} textColor={antd.textSecondary} icon="close">
                Close
              </Button>
            </View>
            <ScrollView contentContainerStyle={styles.itemSheetScroll}>
              <View style={styles.formColumns}>
                <View style={styles.formColumn}>
                  <TextInput
                    mode="outlined"
                    label="Name"
                    value={itemDialog?.name ?? ''}
                    onChangeText={(v) => setItemDialog((d) => (d ? { ...d, name: v } : d))}
                    outlineStyle={{ borderRadius: RADIUS }}
                    autoFocus
                  />
                  <TextInput
                    mode="outlined"
                    label="Price"
                    keyboardType="decimal-pad"
                    left={<TextInput.Icon icon="currency-usd" />}
                    value={itemDialog?.price ?? ''}
                    onChangeText={(v) => setItemDialog((d) => (d ? { ...d, price: v } : d))}
                    outlineStyle={{ borderRadius: RADIUS }}
                  />
                  <TextInput
                    mode="outlined"
                    label="Description"
                    multiline
                    numberOfLines={4}
                    value={itemDialog?.description ?? ''}
                    onChangeText={(v) => setItemDialog((d) => (d ? { ...d, description: v } : d))}
                    outlineStyle={{ borderRadius: RADIUS }}
                    style={{ minHeight: 100 }}
                  />
                  <TextInput
                    mode="outlined"
                    label="SKU / barcode (optional)"
                    value={itemDialog?.sku ?? ''}
                    onChangeText={(v) => setItemDialog((d) => (d ? { ...d, sku: v } : d))}
                    outlineStyle={{ borderRadius: RADIUS }}
                  />
                  <TextInput
                    mode="outlined"
                    label="Image URL (optional)"
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={itemDialog?.imageUrl ?? ''}
                    onChangeText={(v) => setItemDialog((d) => (d ? { ...d, imageUrl: v } : d))}
                    outlineStyle={{ borderRadius: RADIUS }}
                  />
                </View>

                <View style={styles.formColumn}>
                  <View style={styles.toggleRow}>
                    <Text variant="bodyMedium" style={{ color: antd.text, flex: 1 }}>
                      Available for ordering
                    </Text>
                    <Switch
                      value={itemDialog?.isAvailable ?? true}
                      onValueChange={(v) => setItemDialog((d) => (d ? { ...d, isAvailable: v } : d))}
                    />
                  </View>
                  <View style={styles.toggleRow}>
                    <Text variant="bodyMedium" style={{ color: antd.text, flex: 1 }}>
                      Favorite (POS quick-pick)
                    </Text>
                    <Switch
                      value={itemDialog?.isFavorite ?? false}
                      onValueChange={(v) => setItemDialog((d) => (d ? { ...d, isFavorite: v } : d))}
                    />
                  </View>
                  <View style={styles.toggleRow}>
                    <Text variant="bodyMedium" style={{ color: antd.text, flex: 1 }}>
                      Tax exempt
                    </Text>
                    <Switch
                      value={itemDialog?.taxExempt ?? false}
                      onValueChange={(v) => setItemDialog((d) => (d ? { ...d, taxExempt: v } : d))}
                    />
                  </View>

                  {itemDialog?.mode === 'edit' ? (
                    <View style={{ gap: 6, marginTop: 8 }}>
                      <Text variant="labelMedium" style={{ color: antd.textSecondary }}>
                        Modifier groups
                      </Text>
                      <View style={styles.chipRow}>
                        {itemDialog.modifiers.length === 0 ? (
                          <Text variant="labelSmall" style={{ color: antd.textTertiary }}>
                            None assigned.
                          </Text>
                        ) : (
                          itemDialog.modifiers.map((m) => (
                            <View key={m.id} style={styles.chip}>
                              <Text variant="labelSmall" style={{ color: antd.text }}>
                                {m.name}
                              </Text>
                            </View>
                          ))
                        )}
                      </View>
                      {unassignedGroups.length > 0 ? (
                        <>
                          <Text variant="labelSmall" style={{ color: antd.textTertiary, marginTop: 4 }}>
                            Tap to assign:
                          </Text>
                          <View style={styles.chipRow}>
                            {unassignedGroups.map((g) => {
                              const item = selectedItems.find((p) => p.id === itemDialog.id);
                              return (
                                <TouchableRipple
                                  key={g.id}
                                  onPress={() => item && assignGroupToItem(item, g)}
                                  style={[styles.chip, styles.chipTappable]}
                                >
                                  <Text variant="labelSmall" style={{ color: antd.primary }}>
                                    + {g.name}
                                  </Text>
                                </TouchableRipple>
                              );
                            })}
                          </View>
                        </>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              </View>
            </ScrollView>

            <View style={styles.formActions}>
              <Button onPress={() => setItemDialog(null)}>Cancel</Button>
              <Button mode="contained" onPress={submitItemDialog} style={{ borderRadius: RADIUS }}>
                Save
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Modifier groups management ── */}
      <Modal visible={showGroups} transparent animationType="fade" onRequestClose={() => setShowGroups(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text variant="titleMedium" style={styles.headerTitle}>
                Modifier Groups
              </Text>
              <View style={{ flexDirection: 'row' }}>
                <IconButton
                  icon="plus"
                  size={20}
                  onPress={() => setGroupDialog({ name: '', isRequired: false, multiSelect: false, maxSelections: '' })}
                />
                <Button mode="text" compact onPress={() => setShowGroups(false)} textColor={antd.textSecondary} icon="close">
                  Close
                </Button>
              </View>
            </View>
            <ScrollView>
              {groups.map((g) => (
                <View key={g.id} style={styles.groupCard}>
                  <TouchableRipple onPress={() => setExpandedGroupId((id) => (id === g.id ? null : g.id))}>
                    <View style={styles.rowItemInner}>
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyMedium" style={{ color: antd.text, fontWeight: '600' }}>
                          {g.name}
                        </Text>
                        <Text variant="labelSmall" style={{ color: antd.textTertiary }}>
                          {g.options.length} options
                          {g.isRequired ? '  ·  required' : ''}
                          {g.multiSelect ? '  ·  multi-select' : ''}
                        </Text>
                      </View>
                      <IconButton
                        icon="trash-can-outline"
                        size={16}
                        iconColor={antd.error}
                        onPress={() => setDeleteTarget({ kind: 'group', id: g.id, name: g.name })}
                      />
                    </View>
                  </TouchableRipple>
                  {expandedGroupId === g.id ? (
                    <View style={styles.optionsWrap}>
                      {g.options.map((o) => (
                        <View key={o.id} style={styles.optionRow}>
                          <Text variant="bodySmall" style={{ color: antd.text, flex: 1 }}>
                            {o.name}
                          </Text>
                          <Text variant="labelSmall" style={{ color: antd.textTertiary }}>
                            {o.priceAdjustment > 0 ? `+${formatMoney(o.priceAdjustment)}` : 'No charge'}
                          </Text>
                          <IconButton
                            icon="close"
                            size={14}
                            iconColor={antd.error}
                            onPress={() => setDeleteTarget({ kind: 'option', id: o.id, name: o.name, modifierId: g.id })}
                          />
                        </View>
                      ))}
                      <Button
                        mode="text"
                        compact
                        icon="plus"
                        onPress={() => setOptionDialog({ modifierId: g.id, name: '', priceAdjustment: '' })}
                      >
                        Add option
                      </Button>
                    </View>
                  ) : null}
                </View>
              ))}
              {groups.length === 0 ? (
                <Text variant="bodySmall" style={styles.emptyHint}>
                  No modifier groups yet.
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Add modifier group ── */}
      <Modal visible={groupDialog !== null} transparent animationType="fade" onRequestClose={() => setGroupDialog(null)}>
        <View style={styles.backdrop}>
          <View style={styles.formSheet}>
            <Text variant="titleMedium" style={styles.headerTitle}>
              Add Modifier Group
            </Text>
            <TextInput
              mode="outlined"
              label="Name (e.g. Size)"
              value={groupDialog?.name ?? ''}
              onChangeText={(v) => setGroupDialog((d) => (d ? { ...d, name: v } : d))}
              outlineStyle={{ borderRadius: RADIUS }}
              autoFocus
            />
            <View style={styles.toggleRow}>
              <Text variant="bodyMedium" style={{ color: antd.text, flex: 1 }}>
                Required
              </Text>
              <Switch
                value={groupDialog?.isRequired ?? false}
                onValueChange={(v) => setGroupDialog((d) => (d ? { ...d, isRequired: v } : d))}
              />
            </View>
            <View style={styles.toggleRow}>
              <Text variant="bodyMedium" style={{ color: antd.text, flex: 1 }}>
                Allow multiple selections
              </Text>
              <Switch
                value={groupDialog?.multiSelect ?? false}
                onValueChange={(v) => setGroupDialog((d) => (d ? { ...d, multiSelect: v } : d))}
              />
            </View>
            {groupDialog?.multiSelect ? (
              <TextInput
                mode="outlined"
                label="Max selections (optional)"
                keyboardType="number-pad"
                value={groupDialog?.maxSelections ?? ''}
                onChangeText={(v) => setGroupDialog((d) => (d ? { ...d, maxSelections: v } : d))}
                outlineStyle={{ borderRadius: RADIUS }}
              />
            ) : null}
            <View style={styles.formActions}>
              <Button onPress={() => setGroupDialog(null)}>Cancel</Button>
              <Button mode="contained" onPress={submitGroupDialog} style={{ borderRadius: RADIUS }}>
                Save
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Add modifier option ── */}
      <Modal visible={optionDialog !== null} transparent animationType="fade" onRequestClose={() => setOptionDialog(null)}>
        <View style={styles.backdrop}>
          <View style={styles.formSheet}>
            <Text variant="titleMedium" style={styles.headerTitle}>
              Add Option
            </Text>
            <TextInput
              mode="outlined"
              label="Name (e.g. Large)"
              value={optionDialog?.name ?? ''}
              onChangeText={(v) => setOptionDialog((d) => (d ? { ...d, name: v } : d))}
              outlineStyle={{ borderRadius: RADIUS }}
              autoFocus
            />
            <TextInput
              mode="outlined"
              label="Price adjustment"
              keyboardType="decimal-pad"
              placeholder="0.00"
              left={<TextInput.Icon icon="currency-usd" />}
              value={optionDialog?.priceAdjustment ?? ''}
              onChangeText={(v) => setOptionDialog((d) => (d ? { ...d, priceAdjustment: v } : d))}
              outlineStyle={{ borderRadius: RADIUS }}
            />
            <View style={styles.formActions}>
              <Button onPress={() => setOptionDialog(null)}>Cancel</Button>
              <Button mode="contained" onPress={submitOptionDialog} style={{ borderRadius: RADIUS }}>
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
              Delete "{deleteTarget?.name}"?
            </Text>
            <Text variant="bodyMedium" style={{ color: antd.textSecondary }}>
              {deleteTarget?.kind === 'category'
                ? 'This also deletes every item in the category. This cannot be undone.'
                : 'This cannot be undone.'}
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
        reason="Approve menu change"
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
    maxWidth: 1100,
    height: '92%',
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
  categoriesColumn: { width: 260 },
  itemsColumn: { flex: 1 },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  columnTitle: { color: antd.textSecondary, fontWeight: '700', flex: 1 },
  rowItem: { borderRadius: RADIUS, marginVertical: 2 },
  rowItemActive: { backgroundColor: antd.primaryBg },
  rowItemInner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    marginBottom: 8,
    paddingRight: 4,
  },
  itemRowInner: { paddingHorizontal: 10, paddingVertical: 8 },
  emptyHint: { color: antd.textTertiary, padding: 12 },
  formSheet: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS * 2,
    padding: 20,
    gap: 14,
  },
  itemSheet: {
    width: '100%',
    maxWidth: 960,
    height: '88%',
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS * 2,
    padding: 24,
    gap: 12,
  },
  itemSheetScroll: { flexGrow: 1, paddingVertical: 8 },
  formColumns: { flexDirection: 'row', gap: 24 },
  formColumn: { flex: 1, gap: 14 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: antd.border,
    borderRadius: RADIUS,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipTappable: { borderColor: antd.primary },
  groupCard: {
    borderWidth: 1,
    borderColor: antd.border,
    borderRadius: RADIUS,
    marginBottom: 8,
    overflow: 'hidden',
  },
  optionsWrap: { paddingHorizontal: 12, paddingBottom: 10, gap: 4 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
