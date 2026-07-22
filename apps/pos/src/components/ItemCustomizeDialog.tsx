import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Dialog,
  Divider,
  IconButton,
  Portal,
  Text,
  TextInput,
  TouchableRipple,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { formatMoney } from '../utils/money';
import {
  COURSE_LABELS,
  type Course,
  type Product,
  type SelectedModifier,
} from '../types';

const COURSES: Course[] = [1, 2, 3];

interface Props {
  visible: boolean;
  product: Product | null;
  onDismiss: () => void;
  onConfirm: (
    product: Product,
    quantity: number,
    notes: string,
    course?: Course,
    selectedModifiers?: SelectedModifier[],
  ) => void;
  /** When editing an existing cart line: pre-fill these values. */
  initialQuantity?: number;
  initialNotes?: string;
  initialCourse?: Course;
  initialSelectedModifiers?: SelectedModifier[];
  /** Only shown when the order is set to fire by course. */
  showCourses?: boolean;
  mode?: 'add' | 'edit';
}

export function ItemCustomizeDialog({
  visible,
  product,
  onDismiss,
  onConfirm,
  initialQuantity,
  initialNotes,
  initialCourse,
  initialSelectedModifiers,
  showCourses = false,
  mode = 'add',
}: Props) {
  const [quantity, setQuantity] = useState(initialQuantity ?? 1);
  const [notes, setNotes] = useState(initialNotes ?? '');
  const [course, setCourse] = useState<Course | undefined>(initialCourse);
  // Selected option ids, keyed by modifier group id.
  const [selections, setSelections] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (visible) {
      setQuantity(initialQuantity ?? 1);
      setNotes(initialNotes ?? '');
      setCourse(initialCourse);
      const byGroup: Record<string, string[]> = {};
      for (const m of initialSelectedModifiers ?? []) {
        (byGroup[m.modifierId] ??= []).push(m.optionId);
      }
      setSelections(byGroup);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, product?.id]);

  if (!product) return null;

  const modifierGroups = product.modifiers ?? [];

  const toggleOption = (groupId: string, optionId: string, multi: boolean, max: number | null) => {
    setSelections((prev) => {
      const current = prev[groupId] ?? [];
      if (multi) {
        if (current.includes(optionId)) {
          return { ...prev, [groupId]: current.filter((id) => id !== optionId) };
        }
        if (max != null && current.length >= max) return prev; // at the selection cap
        return { ...prev, [groupId]: [...current, optionId] };
      }
      // Single-select: tapping the active option clears it (unless required).
      return { ...prev, [groupId]: current.includes(optionId) ? [] : [optionId] };
    });
  };

  const missingRequired = modifierGroups.filter(
    (g) => g.isRequired && (selections[g.id]?.length ?? 0) === 0,
  );

  const selectedModifiers: SelectedModifier[] = modifierGroups.flatMap((g) =>
    (selections[g.id] ?? []).flatMap((optionId) => {
      const opt = g.options.find((o) => o.id === optionId);
      return opt
        ? [{ modifierId: g.id, optionId: opt.id, name: opt.name, priceAdjustment: opt.priceAdjustment }]
        : [];
    }),
  );

  const modifierTotal = selectedModifiers.reduce((sum, m) => sum + m.priceAdjustment, 0);
  const lineTotal = (product.price + modifierTotal) * quantity;

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
        <Dialog.Title style={styles.title}>{product.name}</Dialog.Title>
        <Dialog.Content style={styles.content}>
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          {product.imageUrl ? (
            <Image source={{ uri: product.imageUrl }} style={styles.image} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <MaterialCommunityIcons name="food" size={40} color={antd.textQuaternary} />
            </View>
          )}

          {product.description ? (
            <Text variant="bodySmall" style={styles.description}>
              {product.description}
            </Text>
          ) : null}

          <Text variant="titleMedium" style={styles.price}>
            {formatMoney(product.price)}
          </Text>

          <Divider style={{ marginVertical: 12 }} />

          <View style={styles.qtyRow}>
            <Text variant="labelMedium" style={styles.qtyLabel}>
              Quantity
            </Text>
            <View style={styles.stepper}>
              <IconButton
                icon="minus"
                size={18}
                style={styles.stepBtn}
                disabled={quantity <= 1}
                onPress={() => setQuantity((q) => Math.max(1, q - 1))}
              />
              <Text variant="titleMedium" style={styles.qty}>
                {quantity}
              </Text>
              <IconButton
                icon="plus"
                size={18}
                style={styles.stepBtn}
                disabled={quantity >= 20}
                onPress={() => setQuantity((q) => Math.min(20, q + 1))}
              />
            </View>
          </View>

          {product.isCombo && modifierGroups.length > 0 && (
            <View style={styles.comboHeader}>
              <MaterialCommunityIcons
                name="silverware-fork-knife"
                size={16}
                color={antd.primary}
              />
              <Text variant="labelMedium" style={styles.comboHeaderText}>
                Build Your Combo
              </Text>
            </View>
          )}

          {modifierGroups.map((group) => {
            const selected = selections[group.id] ?? [];
            const atMax =
              group.multiSelect &&
              group.maxSelections != null &&
              selected.length >= group.maxSelections;
            return (
              <View key={group.id} style={styles.modGroup}>
                <View style={styles.modGroupHeader}>
                  <Text variant="labelMedium" style={styles.courseLabel}>
                    {group.name}
                  </Text>
                  <Text variant="labelSmall" style={styles.modGroupHint}>
                    {group.isRequired ? 'Required' : 'Optional'}
                    {group.multiSelect && group.maxSelections
                      ? ` · up to ${group.maxSelections}`
                      : ''}
                  </Text>
                </View>
                <View style={styles.modOptions}>
                  {group.options.map((opt) => {
                    const active = selected.includes(opt.id);
                    const disabled = !active && atMax;
                    return (
                      <TouchableRipple
                        key={opt.id}
                        disabled={disabled}
                        onPress={() =>
                          toggleOption(
                            group.id,
                            opt.id,
                            group.multiSelect,
                            group.maxSelections,
                          )
                        }
                        style={[
                          styles.modChip,
                          active && styles.modChipActive,
                          disabled && styles.modChipDisabled,
                        ]}
                        borderless
                      >
                        <View style={styles.modChipRow}>
                          <MaterialCommunityIcons
                            name={
                              group.multiSelect
                                ? active
                                  ? 'checkbox-marked'
                                  : 'checkbox-blank-outline'
                                : active
                                  ? 'radiobox-marked'
                                  : 'radiobox-blank'
                            }
                            size={16}
                            color={active ? antd.primary : antd.textTertiary}
                          />
                          <Text
                            style={[
                              styles.modChipText,
                              active && styles.modChipTextActive,
                            ]}
                          >
                            {opt.name}
                            {opt.priceAdjustment
                              ? ` (+${formatMoney(opt.priceAdjustment)})`
                              : ''}
                          </Text>
                        </View>
                      </TouchableRipple>
                    );
                  })}
                </View>
              </View>
            );
          })}

          {showCourses && (
            <View style={styles.courseBlock}>
              <Text variant="labelMedium" style={styles.courseLabel}>
                Course
              </Text>
              <View style={styles.courseRow}>
                {COURSES.map((c) => {
                  const active = course === c;
                  return (
                    <TouchableRipple
                      key={c}
                      onPress={() => setCourse(active ? undefined : c)}
                      style={[styles.courseChip, active && styles.courseChipActive]}
                      borderless
                    >
                      <Text
                        style={[
                          styles.courseChipText,
                          active && styles.courseChipTextActive,
                        ]}
                      >
                        {COURSE_LABELS[c]}
                      </Text>
                    </TouchableRipple>
                  );
                })}
              </View>
            </View>
          )}

          <TextInput
            label="Special instructions / notes"
            mode="outlined"
            multiline
            numberOfLines={3}
            value={notes}
            onChangeText={setNotes}
            placeholder="e.g. no onions, extra sauce, allergy info…"
            style={styles.notes}
            outlineStyle={{ borderRadius: RADIUS }}
          />
        </ScrollView>
        </Dialog.Content>

        {missingRequired.length > 0 && (
          <Text variant="labelSmall" style={styles.requiredWarning}>
            Choose {missingRequired.map((g) => g.name).join(', ')} to continue
          </Text>
        )}

        <Dialog.Actions style={styles.actions}>
          <Button onPress={onDismiss} textColor={antd.textSecondary}>
            Cancel
          </Button>
          <Button
            mode="contained"
            disabled={missingRequired.length > 0}
            onPress={() => {
              onConfirm(product, quantity, notes.trim(), course, selectedModifiers);
              onDismiss();
            }}
            style={{ borderRadius: RADIUS }}
          >
            {mode === 'edit' ? `Update Item · ${formatMoney(lineTotal)}` : `Add to Cart · ${formatMoney(lineTotal)}`}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: {
    borderRadius: RADIUS,
    backgroundColor: antd.bgContainer,
    maxWidth: 440,
    alignSelf: 'center',
    width: '100%',
  },
  title: { color: antd.text, fontWeight: '700' },
  content: { gap: 8, maxHeight: 460 },
  scroll: { gap: 8 },
  comboHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  comboHeaderText: { color: antd.primary, fontWeight: '700' },
  modGroup: { gap: 6, marginBottom: 12 },
  modGroupHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  modGroupHint: { color: antd.textQuaternary },
  modOptions: { gap: 6 },
  modChip: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
  },
  modChipActive: { borderColor: antd.primary, backgroundColor: antd.primaryBg },
  modChipDisabled: { opacity: 0.4 },
  modChipRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modChipText: { color: antd.textSecondary, fontSize: 13 },
  modChipTextActive: { color: antd.text, fontWeight: '600' },
  requiredWarning: {
    color: antd.error,
    paddingHorizontal: 24,
    paddingBottom: 4,
  },
  image: { width: '100%', height: 160, borderRadius: RADIUS, backgroundColor: antd.bgLayout },
  imagePlaceholder: {
    width: '100%',
    height: 100,
    borderRadius: RADIUS,
    backgroundColor: antd.bgLayout,
    alignItems: 'center',
    justifyContent: 'center',
  },
  description: { color: antd.textSecondary },
  price: { color: antd.primary, fontWeight: '700' },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  qtyLabel: { color: antd.textSecondary },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: antd.border,
    borderRadius: RADIUS,
  },
  stepBtn: { margin: 0, width: 36, height: 36 },
  qty: {
    minWidth: 36,
    textAlign: 'center',
    color: antd.text,
    fontWeight: '700',
  },
  notes: { backgroundColor: antd.bgContainer },
  courseBlock: { gap: 6, marginBottom: 12 },
  courseLabel: { color: antd.textSecondary },
  courseRow: { flexDirection: 'row', gap: 8 },
  courseChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    alignItems: 'center',
  },
  courseChipActive: { borderColor: antd.primary, backgroundColor: antd.primary },
  courseChipText: { fontSize: 13, fontWeight: '600', color: antd.textSecondary },
  courseChipTextActive: { color: '#fff' },
  actions: { gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
});
