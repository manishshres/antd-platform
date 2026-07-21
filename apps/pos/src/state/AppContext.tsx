import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';
import { syncEngine, type SyncState } from '../sync/syncEngine';
import * as businessDayRepo from '../db/businessDayRepo';
import * as catalogRepo from '../db/catalogRepo';
import type { BusinessDay, PosSettings } from '../types';

const SETTINGS_KEY = 'pos.settings.v1';
const API_KEY_SECURE_STORE_KEY = 'pos.api.key';

const DEFAULT_SETTINGS: PosSettings = {
  apiUrl: '',
  apiKey: '',
  locationId: '',
  locationName: '',
  taxRateBps: 0,
  serviceChargeBps: 0,
  syncIntervalSec: 60,
  printerEnabled: false,
  printerTarget: '',
  printerDeviceName: '',
  printerCharsPerLine: 48,
  printerFontScale: 0,
  printerAutoKitchen: false,
  printerAutoReceipt: false,
};

interface AppContextValue {
  ready: boolean;
  online: boolean;
  settings: PosSettings;
  saveSettings: (patch: Partial<PosSettings>) => Promise<void>;
  sync: SyncState;
  syncNow: () => void;
  /** Bumped whenever a sync finishes so screens can re-read SQLite. */
  dataVersion: number;
  /** The currently open business day, or null if no day is active. */
  businessDay: BusinessDay | null;
  /** Open a new business day. */
  startDay: (openedBy: string) => BusinessDay;
  /** Close the current business day. */
  endDay: (closedBy: string) => void;
  /** Refresh the business day state from the database. */
  refreshBusinessDay: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(false);
  const [settings, setSettings] = useState<PosSettings>(DEFAULT_SETTINGS);
  const [sync, setSync] = useState<SyncState>({
    syncing: false,
    lastSyncAt: null,
    pendingOrders: 0,
    failedOrders: 0,
    lastError: null,
  });
  const [dataVersion, setDataVersion] = useState(0);
  const [businessDay, setBusinessDay] = useState<BusinessDay | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const wasSyncing = useRef(false);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(SETTINGS_KEY),
      SecureStore.getItemAsync(API_KEY_SECURE_STORE_KEY),
    ])
      .then(([rawSettings, secureApiKey]) => {
        let loadedSettings = { ...DEFAULT_SETTINGS };
        if (rawSettings) {
          loadedSettings = { ...loadedSettings, ...JSON.parse(rawSettings) };
        }
        if (secureApiKey !== null) {
          loadedSettings.apiKey = secureApiKey;
        } else if (loadedSettings.apiKey) {
          // Migration: if apiKey is in AsyncStorage but not SecureStore, move it to SecureStore
          void SecureStore.setItemAsync(API_KEY_SECURE_STORE_KEY, loadedSettings.apiKey);
        }
        setSettings(loadedSettings);
        // Load business day state from SQLite
        setBusinessDay(businessDayRepo.getOpenDay());
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    return syncEngine.subscribe((state) => {
      setSync(state);
      if (wasSyncing.current && !state.syncing) {
        setDataVersion((v) => v + 1);
        // Auto-select a location once one has synced. Categories are org-level
        // and show without a location, but menu items are location-scoped and
        // stay empty until locationId is set — so a fresh register looked half
        // stocked until someone opened Settings. Default to the first location;
        // changing locationId re-triggers the sync below to pull its items.
        if (!settingsRef.current.locationId) {
          const [first] = catalogRepo.getLocations();
          if (first) {
            void saveSettings({
              locationId: first.id,
              locationName: first.name,
              taxRateBps: first.taxRateBps,
              serviceChargeBps: first.serviceChargeBps,
            });
          }
        }
      }
      wasSyncing.current = state.syncing;
    });
  }, []);

  const syncNow = useCallback(() => {
    void syncEngine.syncAll(settingsRef.current);
  }, []);

  // Connectivity: track it, and kick a sync whenever we come back online.
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const isOnline = Boolean(state.isConnected);
      setOnline((prev) => {
        if (!prev && isOnline) syncNow();
        return isOnline;
      });
    });
    return unsubscribe;
  }, [syncNow]);

  // Periodic background sync while configured.
  useEffect(() => {
    if (!ready || !settings.apiUrl || !settings.apiKey) return;
    syncNow();
    const interval = setInterval(
      syncNow,
      Math.max(settings.syncIntervalSec, 15) * 1000,
    );
    return () => clearInterval(interval);
  }, [ready, settings.apiUrl, settings.apiKey, settings.locationId, settings.syncIntervalSec, syncNow]);

  const saveSettings = useCallback(async (patch: Partial<PosSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    setSettings(next);

    // Save apiKey to SecureStore independently of AsyncStorage
    if (patch.apiKey !== undefined) {
      if (patch.apiKey) {
        await SecureStore.setItemAsync(API_KEY_SECURE_STORE_KEY, patch.apiKey);
      } else {
        await SecureStore.deleteItemAsync(API_KEY_SECURE_STORE_KEY);
      }
    }

    // Do not serialize apiKey into plain-text AsyncStorage
    const safeSettings = { ...next, apiKey: '' };
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(safeSettings));
  }, []);

  const refreshBusinessDay = useCallback(() => {
    setBusinessDay(businessDayRepo.getOpenDay());
  }, []);

  const startDay = useCallback((openedBy: string): BusinessDay => {
    const day = businessDayRepo.startDay(openedBy);
    setBusinessDay(day);
    return day;
  }, []);

  const endDay = useCallback((closedBy: string) => {
    if (!businessDay) return;
    businessDayRepo.endDay(businessDay.id, closedBy);
    setBusinessDay(null);
  }, [businessDay]);

  const value = useMemo(
    () => ({
      ready, online, settings, saveSettings, sync, syncNow,
      dataVersion, businessDay, startDay, endDay, refreshBusinessDay,
    }),
    [ready, online, settings, saveSettings, sync, syncNow,
     dataVersion, businessDay, startDay, endDay, refreshBusinessDay],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
