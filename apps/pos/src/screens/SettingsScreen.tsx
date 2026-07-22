import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Divider, Menu, Text, TextInput, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { antd, RADIUS } from '../theme';
import { useApp } from '../state/AppContext';
import { useEmployee } from '../state/EmployeeContext';
import { db } from '../db/database';
import * as catalogRepo from '../db/catalogRepo';
import * as printerStationsRepo from '../db/printerStationsRepo';
import type { Location, PrinterStation } from '../types';
import { usePrinterDiscovery } from '../printing/usePrinterDiscovery';
import { testPrint } from '../printing/printerService';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { FontSizeSlider } from '../components/FontSizeSlider';
import { PrinterSizePreview } from '../components/PrinterSizePreview';
import { StationEditorModal } from '../components/StationEditorModal';
import { CloseStoreDialog } from '../components/CloseStoreDialog';

import * as SecureStore from 'expo-secure-store';

/* ─── Constants read from app.json at build time ─── */
const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';
const BUILD_NUMBER =
  Platform.OS === 'android'
    ? Constants.expoConfig?.android?.versionCode ?? '—'
    : Constants.expoConfig?.ios?.buildNumber ?? '—';

const PRIVACY_POLICY_URL = 'https://www.coneeko.com/privacy-policy';
const TERMS_OF_SERVICE_URL = 'https://www.coneeko.com/terms-and-condition';
const CONTACT_URL = 'https://www.coneeko.com/contact-us';

type SettingsTab = 'connection' | 'location' | 'printer' | 'data' | 'about';

interface TabConfig {
  id: SettingsTab;
  label: string;
  icon: string;
}

const TABS: TabConfig[] = [
  { id: 'connection', label: 'Connection & Sync', icon: 'server-network' },
  { id: 'location', label: 'Location', icon: 'map-marker-outline' },
  { id: 'printer', label: 'Receipt Printer', icon: 'printer-outline' },
  { id: 'data', label: 'Data Management', icon: 'database-outline' },
  { id: 'about', label: 'About & Legal', icon: 'information-outline' },
];

/** Register configuration: API connection, location, sync status, and legal links. */
export function SettingsScreen() {
  const { settings, saveSettings, sync, syncNow, online, dataVersion, businessDay, startDay, endDay } = useApp();
  const { employee } = useEmployee();
  const [activeTab, setActiveTab] = useState<SettingsTab>('connection');
  const [apiUrl, setApiUrl] = useState(settings.apiUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [locations, setLocations] = useState<Location[]>([]);
  const [saved, setSaved] = useState(false);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);

  const [printerTarget, setPrinterTarget] = useState(settings.printerTarget);
  const [printerDeviceName, setPrinterDeviceName] = useState(settings.printerDeviceName);
  const [printerSaved, setPrinterSaved] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'printing' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);
  const discovery = usePrinterDiscovery();

  const [taxRateText, setTaxRateText] = useState('');
  const [serviceChargeText, setServiceChargeText] = useState('');
  const [locationSaved, setLocationSaved] = useState(false);
  const [closeStoreOpen, setCloseStoreOpen] = useState(false);

  const [stations, setStations] = useState<PrinterStation[]>([]);
  const [categoryStationMap, setCategoryStationMap] = useState<Record<string, string>>({});
  const [editingStation, setEditingStation] = useState<PrinterStation | 'new' | null>(null);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState<string | null>(null);
  const categories = catalogRepo.getCategories();

  const selectedLocation = locations.find((l) => l.id === settings.locationId);
  const selectedLocationAddress = selectedLocation
    ? [selectedLocation.address, selectedLocation.city, selectedLocation.state, selectedLocation.postalCode]
        .filter(Boolean)
        .join(', ')
    : '';

  useEffect(() => {
    if (selectedLocation) {
      setTaxRateText((selectedLocation.taxRateBps / 100).toFixed(2));
      setServiceChargeText((selectedLocation.serviceChargeBps / 100).toFixed(2));
    }
  }, [selectedLocation]);

  const refreshStations = useCallback(() => {
    setStations(printerStationsRepo.listStations());
    setCategoryStationMap(printerStationsRepo.getCategoryStationMap());
  }, []);

  useEffect(() => {
    refreshStations();
  }, [refreshStations]);

  useEffect(() => {
    setPrinterTarget(settings.printerTarget);
    setPrinterDeviceName(settings.printerDeviceName);
  }, [settings.printerTarget, settings.printerDeviceName]);

  const savePrinterConnection = async () => {
    await saveSettings({
      printerTarget: printerTarget.trim(),
      printerDeviceName: printerDeviceName.trim(),
      printerEnabled: true,
    });
    setPrinterSaved(true);
    setTimeout(() => setPrinterSaved(false), 2000);
  };

  const runTestPrint = async () => {
    setTestStatus('printing');
    setTestError(null);
    const result = await testPrint({
      ...settings,
      printerTarget: printerTarget.trim(),
      printerDeviceName: printerDeviceName.trim(),
      printerEnabled: true,
    });
    if (result.ok) {
      setTestStatus('ok');
    } else {
      setTestStatus('error');
      setTestError(result.error ?? 'Failed to print.');
    }
    setTimeout(() => setTestStatus('idle'), 3000);
  };

  useEffect(() => {
    setLocations(catalogRepo.getLocations());
  }, [dataVersion]);

  // Update local state if settings context loads later or changes
  useEffect(() => {
    setApiUrl(settings.apiUrl);
    setApiKey(settings.apiKey);
  }, [settings.apiUrl, settings.apiKey]);

  const saveConnection = async () => {
    await saveSettings({ apiUrl: apiUrl.trim(), apiKey: apiKey.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const saveLocation = async () => {
    if (!selectedLocation) return;
    const taxBps = Math.round(parseFloat(taxRateText) * 100) || 0;
    const scBps = Math.round(parseFloat(serviceChargeText) * 100) || 0;
    
    catalogRepo.updateLocationTax(selectedLocation.id, taxBps, scBps);
    await saveSettings({ taxRateBps: taxBps, serviceChargeBps: scBps });
    
    setLocationSaved(true);
    setTimeout(() => setLocationSaved(false), 2000);
  };

  const toggleBusinessDay = () => {
    const empName = employee?.displayName ?? 'Manager';
    if (businessDay) {
      setCloseStoreOpen(true);
    } else {
      startDay(empName);
    }
  };

  const handleQrScanned = async (data: string) => {
    let parsed: { apiUrl?: unknown; apiKey?: unknown };
    try {
      parsed = JSON.parse(data);
    } catch {
      Alert.alert('Invalid QR Code', "This doesn't look like a Coneeko POS connection code.");
      return;
    }
    if (typeof parsed.apiUrl !== 'string' || typeof parsed.apiKey !== 'string' || !parsed.apiUrl || !parsed.apiKey) {
      Alert.alert('Invalid QR Code', 'This QR code is missing the API URL or key.');
      return;
    }
    setQrScannerOpen(false);
    const nextUrl = parsed.apiUrl.trim();
    const nextKey = parsed.apiKey.trim();
    setApiUrl(nextUrl);
    setApiKey(nextKey);
    await saveSettings({ apiUrl: nextUrl, apiKey: nextKey });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const pickLocation = async (loc: Location) => {
    await saveSettings({
      locationId: loc.id,
      locationName: loc.name,
      taxRateBps: loc.taxRateBps,
      serviceChargeBps: loc.serviceChargeBps,
    });
  };

  const clearLocalData = useCallback(() => {
    Alert.alert(
      'Clear Local Data',
      'This will remove all cached menus, orders, customers, and local settings from this device. Data stored on the server is not affected.\n\nYou will need to reconnect and sync after clearing.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Everything',
          style: 'destructive',
          onPress: async () => {
            try {
              // Wipe SQLite tables
              db.execSync(`
                DELETE FROM categories;
                DELETE FROM products;
                DELETE FROM customers;
                DELETE FROM dining_tables;
                DELETE FROM orders;
                DELETE FROM order_mutations;
                DELETE FROM drawer_sessions;
                DELETE FROM discounts;
                DELETE FROM locations;
                DELETE FROM meta;
              `);
              // Wipe AsyncStorage and SecureStore
              await AsyncStorage.clear();
              await SecureStore.deleteItemAsync('pos.api.key');
              Alert.alert('Done', 'All local data has been cleared. Please restart the app.');
            } catch {
              Alert.alert('Error', 'Failed to clear local data. Please try again.');
            }
          },
        },
      ],
    );
  }, []);

  return (
    <View style={styles.container}>
      {/* ─── Left Sidebar (Tabs) ─── */}
      <View style={styles.sidebar}>
        <Text variant="titleLarge" style={styles.sidebarTitle}>
          Settings
        </Text>
        <ScrollView style={styles.tabList} contentContainerStyle={styles.tabListContent}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <TouchableRipple
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                style={[styles.tabItem, isActive && styles.tabItemSelected]}
                borderless
              >
                <View style={styles.tabInner}>
                  <MaterialCommunityIcons
                    name={tab.icon as never}
                    size={22}
                    color={isActive ? '#fff' : antd.textSecondary}
                  />
                  <Text
                    variant="bodyMedium"
                    style={{ color: isActive ? '#fff' : antd.text, fontWeight: isActive ? '600' : '400' }}
                  >
                    {tab.label}
                  </Text>
                </View>
              </TouchableRipple>
            );
          })}
        </ScrollView>
      </View>

      {/* ─── Right Content Area ─── */}
      <View style={styles.mainContent}>
        <ScrollView contentContainerStyle={styles.contentScroll}>
          {activeTab === 'connection' && (
            <>
              <View style={styles.card}>
                <Text variant="titleMedium" style={styles.cardTitle}>
                  Server Connection
                </Text>
                <Text variant="bodySmall" style={styles.cardSub}>
                  The register talks to the platform's public API using an organization
                  API key (Dashboard → Billing → API Keys).
                </Text>
                <Button
                  mode="outlined"
                  icon="qrcode-scan"
                  onPress={() => setQrScannerOpen(true)}
                  style={[{ borderRadius: RADIUS, alignSelf: 'flex-start' }]}
                >
                  Scan QR Code
                </Button>
                <TextInput
                  label="API base URL"
                  mode="outlined"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="https://api.example.com"
                  value={apiUrl}
                  onChangeText={setApiUrl}
                  outlineStyle={styles.inputOutline}
                />
                <TextInput
                  label="API key"
                  mode="outlined"
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  value={apiKey}
                  onChangeText={setApiKey}
                  outlineStyle={styles.inputOutline}
                />
                <View style={styles.rowEnd}>
                  {saved && (
                    <Text variant="labelMedium" style={{ color: antd.success }}>
                      Saved
                    </Text>
                  )}
                  <Button
                    mode="contained"
                    icon="content-save-outline"
                    onPress={saveConnection}
                    style={{ borderRadius: RADIUS }}
                  >
                    Save & Connect
                  </Button>
                </View>
              </View>

              <View style={styles.card}>
                <Text variant="titleMedium" style={styles.cardTitle}>
                  Sync & Network
                </Text>
                <StatusLine
                  icon={online ? 'wifi' : 'wifi-off'}
                  color={online ? antd.success : antd.error}
                  text={online ? 'Connected to the network' : 'Offline — orders queue locally'}
                />
                <StatusLine
                  icon="clock-outline"
                  color={antd.textSecondary}
                  text={
                    sync.lastSyncAt
                      ? `Last synced ${new Date(sync.lastSyncAt).toLocaleString()}`
                      : 'Never synced'
                  }
                />
                <StatusLine
                  icon="tray-full"
                  color={sync.pendingOrders > 0 ? antd.warning : antd.textSecondary}
                  text={`${sync.pendingOrders} orders pending · ${sync.failedOrders} failed`}
                />
                {sync.lastError && (
                  <StatusLine icon="alert-circle-outline" color={antd.error} text={sync.lastError} />
                )}
                <Divider style={{ marginVertical: 8 }} />
                <View style={styles.rowEnd}>
                  <Button
                    mode="outlined"
                    icon="cloud-sync-outline"
                    loading={sync.syncing}
                    disabled={!online || sync.syncing}
                    onPress={syncNow}
                    style={{ borderRadius: RADIUS }}
                  >
                    Sync Now
                  </Button>
                </View>
              </View>
            </>
          )}

          {activeTab === 'location' && (
            <View style={styles.card}>
              <Text variant="titleMedium" style={styles.cardTitle}>
                Location
              </Text>
              <Text variant="bodySmall" style={styles.cardSub}>
                Orders, tables, and tax rates are scoped to one restaurant location.
                {locations.length === 0
                  ? ' Connect and sync first to load your locations.'
                  : ''}
              </Text>
              {locations.map((loc) => {
                const selected = settings.locationId === loc.id;
                return (
                  <TouchableRipple
                    key={loc.id}
                    onPress={() => pickLocation(loc)}
                    style={[styles.location, selected && styles.locationSelected]}
                    borderless
                  >
                    <View style={styles.locationInner}>
                      <MaterialCommunityIcons
                        name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                        size={20}
                        color={selected ? antd.primary : antd.textTertiary}
                      />
                      <Text variant="bodyMedium" style={{ color: antd.text, flex: 1 }}>
                        {loc.name}
                      </Text>
                      <Text variant="labelSmall" style={{ color: antd.textTertiary }}>
                        tax {(loc.taxRateBps / 100).toFixed(2)}%
                      </Text>
                    </View>
                  </TouchableRipple>
                );
              })}
            </View>
          )}

          {activeTab === 'location' && selectedLocation && (
            <View style={styles.card}>
              <View style={styles.rowEnd}>
                <Text variant="titleMedium" style={styles.cardTitle}>
                  Location Details
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Text variant="labelLarge" style={{ color: businessDay ? antd.success : antd.error, fontWeight: 'bold' }}>
                    {businessDay ? 'STORE OPEN' : 'STORE CLOSED'}
                  </Text>
                  <Button
                    mode={businessDay ? 'outlined' : 'contained'}
                    buttonColor={businessDay ? undefined : antd.success}
                    textColor={businessDay ? antd.error : undefined}
                    onPress={toggleBusinessDay}
                    style={{ borderRadius: RADIUS }}
                  >
                    {businessDay ? 'Close Store' : 'Open Store'}
                  </Button>
                </View>
              </View>
              <Text variant="bodySmall" style={[styles.cardSub, { marginTop: 16 }]}>
                Core info is managed in the dashboard, but you can override tax and service charge rates here.
              </Text>
              
              <View style={[styles.infoRow, { alignItems: 'center' }]}>
                <Text variant="bodyMedium" style={{ flex: 1, color: antd.text }}>Tax Rate (%)</Text>
                <TextInput
                  mode="outlined"
                  value={taxRateText}
                  onChangeText={setTaxRateText}
                  keyboardType="numeric"
                  style={{ width: 100, backgroundColor: antd.bgContainer }}
                  dense
                />
              </View>

              <View style={[styles.infoRow, { alignItems: 'center' }]}>
                <Text variant="bodyMedium" style={{ flex: 1, color: antd.text }}>Service Charge (%)</Text>
                <TextInput
                  mode="outlined"
                  value={serviceChargeText}
                  onChangeText={setServiceChargeText}
                  keyboardType="numeric"
                  style={{ width: 100, backgroundColor: antd.bgContainer }}
                  dense
                />
              </View>

              <Button
                mode="contained"
                onPress={saveLocation}
                style={{ alignSelf: 'flex-start', borderRadius: RADIUS, marginTop: 8 }}
              >
                {locationSaved ? 'Saved' : 'Save Rates'}
              </Button>

              <Divider style={{ marginVertical: 16 }} />

              {selectedLocationAddress ? (
                <View style={styles.infoRow}>
                  <Text variant="bodySmall" style={styles.infoLabel}>Address</Text>
                  <Text variant="bodySmall" style={[styles.infoValue, { flex: 1, textAlign: 'right' }]}>
                    {selectedLocationAddress}
                  </Text>
                </View>
              ) : null}
              {selectedLocation.phoneNumber ? (
                <View style={styles.infoRow}>
                  <Text variant="bodySmall" style={styles.infoLabel}>Phone</Text>
                  <Text variant="bodySmall" style={styles.infoValue}>{selectedLocation.phoneNumber}</Text>
                </View>
              ) : null}
              {!selectedLocationAddress && !selectedLocation.phoneNumber ? (
                <Text variant="bodySmall" style={{ color: antd.textTertiary }}>
                  No address or phone on file for this location yet.
                </Text>
              ) : null}
            </View>
          )}

          {activeTab === 'printer' && (
            <>
              <View style={styles.card}>
                <Text variant="titleMedium" style={styles.cardTitle}>
                  Thermal Printer
                </Text>
                <Text variant="bodySmall" style={styles.cardSub}>
                  Prints kitchen tickets and customer receipts on an ESC/POS thermal
                  printer connected over Wi-Fi or Bluetooth.
                </Text>
                <TouchableRipple
                  onPress={() => saveSettings({ printerEnabled: !settings.printerEnabled })}
                  style={styles.toggleRow}
                  borderless
                >
                  <View style={styles.toggleRowInner}>
                    <MaterialCommunityIcons
                      name={settings.printerEnabled ? 'checkbox-marked' : 'checkbox-blank-outline'}
                      size={20}
                      color={settings.printerEnabled ? antd.primary : antd.textTertiary}
                    />
                    <Text variant="bodyMedium" style={{ color: antd.text, flex: 1 }}>
                      Enable thermal printer
                    </Text>
                  </View>
                </TouchableRipple>
              </View>

              <View style={styles.card}>
                <Text variant="titleMedium" style={styles.cardTitle}>
                  Discover Printers
                </Text>
                <Text variant="bodySmall" style={styles.cardSub}>
                  Lists Bluetooth ESC/POS printers already paired in Android's
                  Bluetooth settings, plus any nearby ones still being paired.
                </Text>
                <View style={styles.rowEnd}>
                  <Button
                    mode="outlined"
                    icon="magnify"
                    loading={discovery.discovering}
                    onPress={discovery.discovering ? discovery.stop : discovery.start}
                    style={{ borderRadius: RADIUS }}
                  >
                    {discovery.discovering ? 'Searching…' : 'Search'}
                  </Button>
                </View>
                {discovery.error && (
                  <StatusLine icon="alert-circle-outline" color={antd.error} text={discovery.error} />
                )}
                {discovery.printers.map((p) => (
                  <TouchableRipple
                    key={p.target}
                    onPress={() => {
                      setPrinterTarget(p.target);
                      setPrinterDeviceName(p.deviceName || p.target);
                    }}
                    style={[
                      styles.location,
                      printerTarget === p.target && styles.locationSelected,
                    ]}
                    borderless
                  >
                    <View style={styles.locationInner}>
                      <MaterialCommunityIcons
                        name={printerTarget === p.target ? 'radiobox-marked' : 'radiobox-blank'}
                        size={20}
                        color={printerTarget === p.target ? antd.primary : antd.textTertiary}
                      />
                      <Text variant="bodyMedium" style={{ color: antd.text, flex: 1 }}>
                        {p.deviceName || 'Unnamed printer'}
                      </Text>
                      <Text variant="labelSmall" style={{ color: antd.textTertiary }}>
                        {p.target}
                      </Text>
                    </View>
                  </TouchableRipple>
                ))}
              </View>

              <View style={styles.card}>
                <Text variant="titleMedium" style={styles.cardTitle}>
                  Connection
                </Text>
                <Text variant="bodySmall" style={styles.cardSub}>
                  Pick a printer above, or enter its Bluetooth MAC address
                  directly — pair it in Android's Bluetooth settings first.
                </Text>
                <TextInput
                  label="Printer Bluetooth address"
                  mode="outlined"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="AA:BB:CC:DD:EE:FF"
                  value={printerTarget}
                  onChangeText={setPrinterTarget}
                  outlineStyle={styles.inputOutline}
                />
                <TextInput
                  label="Printer name"
                  mode="outlined"
                  autoCorrect={false}
                  placeholder="Front counter printer"
                  value={printerDeviceName}
                  onChangeText={setPrinterDeviceName}
                  outlineStyle={styles.inputOutline}
                />
                <View style={styles.rowEnd}>
                  {printerSaved && (
                    <Text variant="labelMedium" style={{ color: antd.success }}>
                      Saved
                    </Text>
                  )}
                  <Button
                    mode="contained"
                    icon="content-save-outline"
                    onPress={savePrinterConnection}
                    disabled={!printerTarget.trim()}
                    style={{ borderRadius: RADIUS }}
                  >
                    Save Printer
                  </Button>
                </View>
              </View>

              <View style={styles.card}>
                <Text variant="titleMedium" style={styles.cardTitle}>
                  Paper & Behavior
                </Text>
                <View style={styles.rowEnd}>
                  {([32, 48] as const).map((width) => (
                    <Button
                      key={width}
                      mode={settings.printerCharsPerLine === width ? 'contained' : 'outlined'}
                      onPress={() => saveSettings({ printerCharsPerLine: width })}
                      style={{ borderRadius: RADIUS }}
                    >
                      {width === 32 ? '58mm paper' : '80mm paper'}
                    </Button>
                  ))}
                </View>
                <Divider style={{ marginVertical: 4 }} />
                <Text variant="bodyMedium" style={{ color: antd.text }}>
                  Print text size
                </Text>
                <FontSizeSlider
                  value={settings.printerFontScale}
                  onChange={(v) => saveSettings({ printerFontScale: v })}
                />
                <PrinterSizePreview fontScale={settings.printerFontScale} />
                <Divider style={{ marginVertical: 4 }} />
                <TouchableRipple
                  onPress={() => saveSettings({ printerAutoKitchen: !settings.printerAutoKitchen })}
                  style={styles.toggleRow}
                  borderless
                >
                  <View style={styles.toggleRowInner}>
                    <MaterialCommunityIcons
                      name={settings.printerAutoKitchen ? 'checkbox-marked' : 'checkbox-blank-outline'}
                      size={20}
                      color={settings.printerAutoKitchen ? antd.primary : antd.textTertiary}
                    />
                    <Text variant="bodyMedium" style={{ color: antd.text, flex: 1 }}>
                      Auto-print kitchen ticket when an order is sent or held
                    </Text>
                  </View>
                </TouchableRipple>
                <TouchableRipple
                  onPress={() => saveSettings({ printerAutoReceipt: !settings.printerAutoReceipt })}
                  style={styles.toggleRow}
                  borderless
                >
                  <View style={styles.toggleRowInner}>
                    <MaterialCommunityIcons
                      name={settings.printerAutoReceipt ? 'checkbox-marked' : 'checkbox-blank-outline'}
                      size={20}
                      color={settings.printerAutoReceipt ? antd.primary : antd.textTertiary}
                    />
                    <Text variant="bodyMedium" style={{ color: antd.text, flex: 1 }}>
                      Auto-print customer receipt when payment is confirmed
                    </Text>
                  </View>
                </TouchableRipple>
              </View>

              <View style={styles.card}>
                <Text variant="titleMedium" style={styles.cardTitle}>
                  Test
                </Text>
                <View style={styles.rowEnd}>
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
              </View>

              <View style={styles.card}>
                <View style={styles.rowEnd}>
                  <Text variant="titleMedium" style={[styles.cardTitle, { flex: 1 }]}>
                    Kitchen Stations
                  </Text>
                  <Button
                    mode="outlined"
                    icon="plus"
                    compact
                    onPress={() => setEditingStation('new')}
                    style={{ borderRadius: RADIUS }}
                  >
                    Add Station
                  </Button>
                </View>
                <Text variant="bodySmall" style={styles.cardSub}>
                  Pair a Bluetooth printer with each station, then route menu
                  categories to it below. An order's items split automatically —
                  each station only prints what it's responsible for.
                </Text>
                {stations.length === 0 ? (
                  <Text variant="bodySmall" style={{ color: antd.textTertiary }}>
                    No stations yet — every order prints as one kitchen ticket on
                    the default printer above.
                  </Text>
                ) : (
                  stations.map((s) => {
                    const categoryCount = categories.filter((c) => categoryStationMap[c.id] === s.id).length;
                    return (
                      <TouchableRipple
                        key={s.id}
                        onPress={() => setEditingStation(s)}
                        style={styles.stationRow}
                        borderless
                      >
                        <View style={styles.stationRowInner}>
                          <MaterialCommunityIcons
                            name={s.enabled ? 'printer-check' : 'printer-off-outline'}
                            size={20}
                            color={s.enabled ? antd.primary : antd.textQuaternary}
                          />
                          <View style={{ flex: 1 }}>
                            <Text variant="bodyMedium" style={{ color: antd.text, fontWeight: '600' }}>
                              {s.name}
                            </Text>
                            <Text variant="labelSmall" style={{ color: antd.textTertiary }}>
                              {s.printerDeviceName || s.printerTarget || 'No printer paired'} ·{' '}
                              {categoryCount} categor{categoryCount === 1 ? 'y' : 'ies'}
                            </Text>
                          </View>
                          <MaterialCommunityIcons name="chevron-right" size={20} color={antd.textQuaternary} />
                        </View>
                      </TouchableRipple>
                    );
                  })
                )}
              </View>

              {categories.length > 0 && (
                <View style={styles.card}>
                  <Text variant="titleMedium" style={styles.cardTitle}>
                    Category Routing
                  </Text>
                  <Text variant="bodySmall" style={styles.cardSub}>
                    Send each menu category's items to a station's printer.
                  </Text>
                  {categories.map((c) => {
                    const assignedId = categoryStationMap[c.id];
                    const assigned = stations.find((s) => s.id === assignedId);
                    return (
                      <View key={c.id} style={styles.categoryRow}>
                        <Text variant="bodyMedium" style={{ color: antd.text, flex: 1 }}>
                          {c.name}
                        </Text>
                        <Menu
                          visible={categoryMenuOpen === c.id}
                          onDismiss={() => setCategoryMenuOpen(null)}
                          anchor={
                            <TouchableRipple
                              onPress={() => setCategoryMenuOpen(c.id)}
                              style={styles.categoryPicker}
                            >
                              <View style={styles.categoryPickerInner}>
                                <Text
                                  variant="labelMedium"
                                  style={{ color: assigned ? antd.primary : antd.textTertiary }}
                                >
                                  {assigned ? assigned.name : 'Default printer'}
                                </Text>
                                <MaterialCommunityIcons name="menu-down" size={18} color={antd.textTertiary} />
                              </View>
                            </TouchableRipple>
                          }
                        >
                          <Menu.Item
                            title="Default printer"
                            onPress={() => {
                              printerStationsRepo.setCategoryStation(c.id, null);
                              setCategoryMenuOpen(null);
                              refreshStations();
                            }}
                          />
                          {stations.map((s) => (
                            <Menu.Item
                              key={s.id}
                              title={s.name}
                              onPress={() => {
                                printerStationsRepo.setCategoryStation(c.id, s.id);
                                setCategoryMenuOpen(null);
                                refreshStations();
                              }}
                            />
                          ))}
                        </Menu>
                      </View>
                    );
                  })}
                </View>
              )}
            </>
          )}

          {activeTab === 'data' && (
            <View style={styles.card}>
              <Text variant="titleMedium" style={styles.cardTitle}>
                Data Management
              </Text>
              <Text variant="bodySmall" style={styles.cardSub}>
                This app stores menu, order, and customer data locally on your device
                for offline operation. Data is also synced with your organization's
                cloud account when connected.
              </Text>
              <Divider />
              <Button
                mode="outlined"
                icon="delete-outline"
                textColor={antd.error}
                onPress={clearLocalData}
                style={[styles.dangerButton, { borderRadius: RADIUS }]}
              >
                Clear Local Data
              </Button>
            </View>
          )}

          {activeTab === 'about' && (
            <>
              <View style={styles.card}>
                <Text variant="titleMedium" style={styles.cardTitle}>
                  About Coneeko POS
                </Text>
                <InfoRow label="App Version" value={`${APP_VERSION} (${BUILD_NUMBER})`} />
              </View>

              <View style={styles.card}>
                <Text variant="titleMedium" style={styles.cardTitle}>
                  Legal & Support
                </Text>
                <LinkRow
                  icon="shield-check-outline"
                  label="Privacy Policy"
                  onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
                />
                <Divider style={{ marginLeft: 36 }} />
                <LinkRow
                  icon="file-document-outline"
                  label="Terms of Service"
                  onPress={() => void Linking.openURL(TERMS_OF_SERVICE_URL)}
                />
                <Divider style={{ marginLeft: 36 }} />
                <LinkRow
                  icon="email-outline"
                  label="Contact Support"
                  onPress={() => void Linking.openURL(CONTACT_URL)}
                />
              </View>
            </>
          )}
        </ScrollView>
      </View>

      <BarcodeScannerModal
        visible={qrScannerOpen}
        onDismiss={() => setQrScannerOpen(false)}
        onScan={(data) => void handleQrScanned(data)}
        title="Scan Connection QR Code"
      />

      <StationEditorModal
        visible={editingStation !== null}
        onDismiss={() => setEditingStation(null)}
        onSaved={() => {
          setEditingStation(null);
          refreshStations();
        }}
        settings={settings}
        station={editingStation && editingStation !== 'new' ? editingStation : undefined}
      />

      <CloseStoreDialog
        visible={closeStoreOpen}
        onDismiss={() => setCloseStoreOpen(false)}
      />
    </View>
  );
}

/* ─── Reusable sub-components ─── */

function StatusLine({ icon, color, text }: { icon: string; color: string; text: string }) {
  return (
    <View style={styles.statusLine}>
      <MaterialCommunityIcons name={icon as never} size={18} color={color} />
      <Text variant="bodySmall" style={{ color: antd.textSecondary, flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

function LinkRow({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <TouchableRipple onPress={onPress} style={styles.linkRow} borderless>
      <View style={styles.linkRowInner}>
        <MaterialCommunityIcons
          name={icon as never}
          size={20}
          color={danger ? antd.error : antd.primary}
        />
        <Text
          variant="bodyMedium"
          style={{ flex: 1, color: danger ? antd.error : antd.primary, fontWeight: '500' }}
        >
          {label}
        </Text>
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={antd.textQuaternary}
        />
      </View>
    </TouchableRipple>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text variant="bodyMedium" style={styles.infoLabel}>
        {label}
      </Text>
      <Text variant="bodyMedium" style={styles.infoValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: antd.bgLayout },
  sidebar: {
    width: 280,
    backgroundColor: antd.bgContainer,
    borderRightWidth: 1,
    borderRightColor: antd.split,
  },
  sidebarTitle: {
    fontWeight: '700',
    padding: 24,
    paddingBottom: 16,
    color: antd.text,
  },
  tabList: { flex: 1 },
  tabListContent: { paddingHorizontal: 12, paddingBottom: 24, gap: 4 },
  tabItem: {
    borderRadius: RADIUS,
    overflow: 'hidden',
  },
  tabItemSelected: {
    backgroundColor: antd.primary,
  },
  tabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  mainContent: { flex: 1 },
  contentScroll: { padding: 32, maxWidth: 640, width: '100%', alignSelf: 'center', gap: 24 },
  card: {
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    padding: 24,
    gap: 16,
  },
  cardTitle: { color: antd.text, fontWeight: '700' },
  cardSub: { color: antd.textTertiary, lineHeight: 20 },
  inputOutline: { borderRadius: RADIUS },
  rowEnd: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 12 },
  location: {
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
  },
  locationSelected: { borderColor: antd.primary, backgroundColor: antd.primaryBg },
  locationInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
  },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stationRow: {
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    marginTop: 8,
  },
  stationRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
  },
  categoryPicker: {
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
  },
  categoryPickerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  toggleRow: { borderRadius: RADIUS, marginHorizontal: -8 },
  toggleRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  linkRow: { borderRadius: RADIUS, marginHorizontal: -8 },
  linkRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  dangerButton: { borderColor: antd.errorBorder, alignSelf: 'flex-start' },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  infoLabel: { color: antd.text, fontWeight: '500' },
  infoValue: { color: antd.textSecondary },
});
