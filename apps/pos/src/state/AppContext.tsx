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
import { syncEngine, type SyncState } from '../sync/syncEngine';
import type { PosSettings } from '../types';

const SETTINGS_KEY = 'pos.settings.v1';

const DEFAULT_SETTINGS: PosSettings = {
  apiUrl: '',
  apiKey: '',
  locationId: '',
  locationName: '',
  taxRateBps: 0,
  syncIntervalSec: 60,
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
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const wasSyncing = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((raw) => {
        if (raw) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    return syncEngine.subscribe((state) => {
      setSync(state);
      if (wasSyncing.current && !state.syncing) {
        setDataVersion((v) => v + 1);
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
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }, []);

  const value = useMemo(
    () => ({ ready, online, settings, saveSettings, sync, syncNow, dataVersion }),
    [ready, online, settings, saveSettings, sync, syncNow, dataVersion],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
