import React, { useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text, TextInput, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { usePrinterDiscovery } from '../printing/usePrinterDiscovery';
import { testPrint } from '../printing/printerService';
import * as printerStationsRepo from '../db/printerStationsRepo';
import type { PosSettings, PrinterStation } from '../types';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onSaved: () => void;
  settings: PosSettings;
  /** Present when editing an existing station; absent when creating a new one. */
  station?: PrinterStation;
}

/** Create/edit a kitchen station: name + its own paired Bluetooth printer. */
export function StationEditorModal({ visible, onDismiss, onSaved, settings, station }: Props) {
  const [name, setName] = useState(station?.name ?? '');
  const [printerTarget, setPrinterTarget] = useState(station?.printerTarget ?? '');
  const [printerDeviceName, setPrinterDeviceName] = useState(station?.printerDeviceName ?? '');
  const [testStatus, setTestStatus] = useState<'idle' | 'printing' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);
  const discovery = usePrinterDiscovery();

  // Reset local state whenever a different station (or a fresh "add") opens.
  React.useEffect(() => {
    if (!visible) return;
    setName(station?.name ?? '');
    setPrinterTarget(station?.printerTarget ?? '');
    setPrinterDeviceName(station?.printerDeviceName ?? '');
    setTestStatus('idle');
    setTestError(null);
  }, [visible, station]);

  const canSave = name.trim().length > 0 && printerTarget.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    if (station) {
      printerStationsRepo.updateStation(station.id, {
        name: name.trim(),
        printerTarget: printerTarget.trim(),
        printerDeviceName: printerDeviceName.trim(),
      });
    } else {
      printerStationsRepo.createStation({
        name: name.trim(),
        printerTarget: printerTarget.trim(),
        printerDeviceName: printerDeviceName.trim(),
      });
    }
    onSaved();
  };

  const remove = () => {
    if (!station) return;
    Alert.alert('Delete Station', `Delete "${station.name}"? Its categories fall back to the default printer.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          printerStationsRepo.deleteStation(station.id);
          onSaved();
        },
      },
    ]);
  };

  const runTestPrint = async () => {
    if (!printerTarget.trim()) return;
    setTestStatus('printing');
    setTestError(null);
    const result = await testPrint(settings, printerTarget.trim());
    if (result.ok) {
      setTestStatus('ok');
    } else {
      setTestStatus('error');
      setTestError(result.error ?? 'Failed to print.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text variant="titleMedium" style={styles.headerTitle}>
              {station ? 'Edit Station' : 'Add Station'}
            </Text>
            <Button mode="text" compact onPress={onDismiss} textColor={antd.textSecondary} icon="close">
              Close
            </Button>
          </View>

          <ScrollView contentContainerStyle={{ gap: 14 }}>
            <TextInput
              label="Station name"
              mode="outlined"
              placeholder="Grill, Fry Station, Bar…"
              value={name}
              onChangeText={setName}
              outlineStyle={{ borderRadius: RADIUS }}
            />

            <View>
              <Text variant="labelLarge" style={styles.sectionLabel}>
                Paired printer
              </Text>
              <TextInput
                label="Printer Bluetooth address"
                mode="outlined"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="AA:BB:CC:DD:EE:FF"
                value={printerTarget}
                onChangeText={setPrinterTarget}
                outlineStyle={{ borderRadius: RADIUS }}
              />
              <TextInput
                label="Printer name"
                mode="outlined"
                autoCorrect={false}
                placeholder="Kitchen printer 2"
                value={printerDeviceName}
                onChangeText={setPrinterDeviceName}
                outlineStyle={{ borderRadius: RADIUS, marginTop: 8 }}
              />
            </View>

            <View>
              <View style={styles.rowBetween}>
                <Text variant="labelLarge" style={styles.sectionLabel}>
                  Discover printers
                </Text>
                <Button
                  mode="outlined"
                  compact
                  icon="magnify"
                  loading={discovery.discovering}
                  onPress={discovery.discovering ? discovery.stop : discovery.start}
                  style={{ borderRadius: RADIUS }}
                >
                  {discovery.discovering ? 'Searching…' : 'Search'}
                </Button>
              </View>
              {discovery.error ? (
                <Text variant="labelSmall" style={{ color: antd.error }}>
                  {discovery.error}
                </Text>
              ) : null}
              {discovery.printers.map((p) => (
                <TouchableRipple
                  key={p.target}
                  onPress={() => {
                    setPrinterTarget(p.target);
                    setPrinterDeviceName(p.deviceName || p.target);
                  }}
                  style={[styles.printerRow, printerTarget === p.target && styles.printerRowSelected]}
                  borderless
                >
                  <View style={styles.printerRowInner}>
                    <MaterialCommunityIcons
                      name={printerTarget === p.target ? 'radiobox-marked' : 'radiobox-blank'}
                      size={18}
                      color={printerTarget === p.target ? antd.primary : antd.textTertiary}
                    />
                    <Text variant="bodySmall" style={{ color: antd.text, flex: 1 }}>
                      {p.deviceName || 'Unnamed printer'}
                    </Text>
                    <Text variant="labelSmall" style={{ color: antd.textTertiary }}>
                      {p.target}
                    </Text>
                  </View>
                </TouchableRipple>
              ))}
            </View>

            <View style={styles.rowBetween}>
              {testStatus === 'ok' && (
                <Text variant="labelMedium" style={{ color: antd.success }}>
                  Printed
                </Text>
              )}
              {testStatus === 'error' && (
                <Text variant="labelMedium" style={{ color: antd.error, flex: 1 }}>
                  {testError}
                </Text>
              )}
              <Button
                mode="outlined"
                icon="printer-check"
                loading={testStatus === 'printing'}
                disabled={!printerTarget.trim() || testStatus === 'printing'}
                onPress={runTestPrint}
                style={{ borderRadius: RADIUS }}
              >
                Test Print
              </Button>
            </View>
          </ScrollView>

          <View style={styles.formActions}>
            {station ? (
              <Button mode="outlined" textColor={antd.error} onPress={remove} style={{ borderRadius: RADIUS }}>
                Delete
              </Button>
            ) : null}
            <View style={{ flex: 1 }} />
            <Button mode="outlined" onPress={onDismiss} style={{ borderRadius: RADIUS }}>
              Cancel
            </Button>
            <Button mode="contained" disabled={!canSave} onPress={save} style={{ borderRadius: RADIUS }}>
              Save
            </Button>
          </View>
        </View>
      </View>
    </Modal>
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
    maxWidth: 480,
    maxHeight: '85%',
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS * 2,
    padding: 16,
    gap: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: antd.text, fontWeight: '700' },
  sectionLabel: { color: antd.textSecondary, marginBottom: 6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  printerRow: {
    borderWidth: 1,
    borderColor: antd.border,
    borderRadius: RADIUS,
    marginTop: 6,
  },
  printerRowSelected: { borderColor: antd.primary, backgroundColor: antd.primaryBg },
  printerRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  formActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
