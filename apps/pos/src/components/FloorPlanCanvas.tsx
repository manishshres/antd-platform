import React, { useEffect, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { antd, RADIUS } from '../theme';
import type { DiningTable } from '../types';

const CHIP_W = 84;
const CHIP_H = 60;

interface Props {
  tables: DiningTable[];
  /** Floor plan's own coordinate space (matches posX/posY units) — width/height come off any table row. */
  floorWidth: number;
  floorHeight: number;
  /** Rendered canvas width in screen px; height follows the floor plan's aspect ratio. */
  containerWidth: number;
  /** Drag-to-reposition when true; tap-to-select when false. */
  editable?: boolean;
  selectedTableId?: string | null;
  colorFor?: (table: DiningTable) => string;
  onPressTable?: (table: DiningTable) => void;
  /** Fires once per drag, with the new position in floor-plan units. */
  onMoveTable?: (table: DiningTable, posX: number, posY: number) => void;
}

/**
 * Spatial floor map: tables render at their stored (posX, posY), scaled to fit
 * `containerWidth`. Read-only mode (TablesScreen) taps a table to select it;
 * editable mode (the layout editor) drags a table to reposition it, firing
 * `onMoveTable` once on release rather than on every frame — the caller decides
 * whether/how to persist it.
 */
export function FloorPlanCanvas({
  tables,
  floorWidth,
  floorHeight,
  containerWidth,
  editable,
  selectedTableId,
  colorFor,
  onPressTable,
  onMoveTable,
}: Props) {
  const scale = containerWidth / Math.max(floorWidth, 1);
  const containerHeight = Math.max(floorHeight, 1) * scale;

  return (
    <View style={[styles.canvas, { width: containerWidth, height: containerHeight }]}>
      {tables.map((t) => (
        <TableChip
          key={t.id}
          table={t}
          scale={scale}
          editable={!!editable}
          selected={selectedTableId === t.id}
          color={colorFor?.(t) ?? antd.success}
          onPress={() => onPressTable?.(t)}
          onMove={(x, y) => onMoveTable?.(t, x, y)}
        />
      ))}
      {tables.length === 0 && (
        <Text variant="bodySmall" style={styles.emptyHint}>
          No tables placed on this floor plan yet.
        </Text>
      )}
    </View>
  );
}

function TableChip({
  table,
  scale,
  editable,
  selected,
  color,
  onPress,
  onMove,
}: {
  table: DiningTable;
  scale: number;
  editable: boolean;
  selected: boolean;
  color: string;
  onPress: () => void;
  onMove: (x: number, y: number) => void;
}) {
  const [pos, setPos] = useState({ x: table.posX, y: table.posY });
  const [dragging, setDragging] = useState(false);

  // Reflect server/local updates (e.g. a sync pull) unless the user is mid-drag.
  useEffect(() => {
    if (!dragging) setPos({ x: table.posX, y: table.posY });
  }, [table.posX, table.posY, dragging]);

  // Recreated each render (cheap for a handful of tables) so the closures
  // below always see the current `pos` — a PanResponder memoized in a ref
  // would otherwise capture the position from its first render only.
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => editable,
    onMoveShouldSetPanResponder: (_, gesture) =>
      editable && (Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3),
    onPanResponderGrant: () => setDragging(true),
    onPanResponderMove: (_, gesture) => {
      setPos({
        x: Math.max(0, table.posX + gesture.dx / scale),
        y: Math.max(0, table.posY + gesture.dy / scale),
      });
    },
    onPanResponderRelease: (_, gesture) => {
      setDragging(false);
      const x = Math.round(Math.max(0, table.posX + gesture.dx / scale));
      const y = Math.round(Math.max(0, table.posY + gesture.dy / scale));
      onMove(x, y);
    },
  });

  return (
    <View
      {...(editable ? panResponder.panHandlers : {})}
      onTouchEnd={editable ? undefined : onPress}
      style={[
        styles.chip,
        table.shape === 'circle' && styles.chipRound,
        { left: pos.x * scale, top: pos.y * scale, borderColor: color },
        selected && styles.chipSelected,
        dragging && styles.chipDragging,
      ]}
    >
      <Text variant="labelMedium" style={styles.chipName} numberOfLines={1}>
        {table.name}
      </Text>
      <Text variant="labelSmall" style={styles.chipCapacity}>
        {table.capacity} seats
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: antd.bgLayout,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    position: 'absolute',
    width: CHIP_W,
    height: CHIP_H,
    borderRadius: RADIUS,
    borderWidth: 2,
    backgroundColor: antd.bgContainer,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  chipRound: { borderRadius: CHIP_H / 2 },
  chipSelected: { backgroundColor: antd.primaryBg },
  chipDragging: { opacity: 0.8, zIndex: 10 },
  chipName: { color: antd.text, fontWeight: '700' },
  chipCapacity: { color: antd.textTertiary },
  emptyHint: { color: antd.textTertiary },
});
