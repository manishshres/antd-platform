import { useCallback, useEffect, useRef, useState } from 'react';
import { NativeEventEmitter, PermissionsAndroid, Platform, type Permission } from 'react-native';

export interface DiscoveredPrinter {
  /** Bluetooth MAC address — what gets saved as PosSettings.printerTarget. */
  target: string;
  deviceName: string;
}

/**
 * This library predates Android 12's runtime Bluetooth permission model and
 * only requests the legacy ACCESS_COARSE_LOCATION itself — on a targetSdk 31+
 * build, BLUETOOTH_SCAN/BLUETOOTH_CONNECT also need an explicit runtime ask or
 * the native scan silently returns nothing.
 */
async function ensureAndroidBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const permissions = [
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  ].filter((p): p is Permission => Boolean(p));
  const results = await PermissionsAndroid.requestMultiple(permissions);
  return Object.values(results).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
}

interface RawDevice {
  name?: string;
  address?: string;
}

function parseDevices(json: string | undefined): DiscoveredPrinter[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json) as RawDevice[];
    return raw
      .filter((d): d is Required<RawDevice> => Boolean(d.address))
      .map((d) => ({ target: d.address, deviceName: d.name || d.address }));
  } catch {
    return [];
  }
}

function mergeDevices(prev: DiscoveredPrinter[], next: DiscoveredPrinter[]): DiscoveredPrinter[] {
  const byTarget = new Map(prev.map((d) => [d.target, d]));
  for (const d of next) byTarget.set(d.target, d);
  return Array.from(byTarget.values());
}

/**
 * Wraps @vardrz/react-native-bluetooth-escpos-printer's Bluetooth Classic scan,
 * loaded lazily via require() so Settings still renders in a build where the
 * native module hasn't been linked yet (see printerService.ts for why). Paired
 * printers (the common case — set up once via Android's own Bluetooth settings)
 * surface immediately; nearby unpaired ones stream in as discovery finds them.
 */
export function usePrinterDiscovery() {
  const [supported, setSupported] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [printers, setPrinters] = useState<DiscoveredPrinter[]>([]);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const moduleRef = useRef<any>(null);

  const getModule = useCallback(() => {
    if (moduleRef.current) return moduleRef.current;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      moduleRef.current = require('@vardrz/react-native-bluetooth-escpos-printer');
      return moduleRef.current;
    } catch {
      setSupported(false);
      return null;
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const mod = getModule();
    if (!mod) return;
    const emitter = new NativeEventEmitter(mod.BluetoothManager);

    const paired = emitter.addListener('EVENT_DEVICE_ALREADY_PAIRED', (e: { devices?: string }) => {
      setPrinters((prev) => mergeDevices(prev, parseDevices(e.devices)));
    });
    const found = emitter.addListener('EVENT_DEVICE_FOUND', (e: { device?: string }) => {
      if (!e.device) return;
      setPrinters((prev) => mergeDevices(prev, parseDevices(`[${e.device}]`)));
    });
    const done = emitter.addListener('EVENT_DEVICE_DISCOVER_DONE', () => setDiscovering(false));

    return () => {
      paired.remove();
      found.remove();
      done.remove();
    };
  }, [getModule]);

  const start = useCallback(() => {
    const mod = getModule();
    if (!mod) {
      setError('Printer support isn’t built into this app yet — rebuild it after installing the printer dependency.');
      return;
    }
    setError(null);
    setPrinters([]);
    setDiscovering(true);
    void ensureAndroidBluetoothPermissions().then((granted) => {
      if (!granted) {
        setDiscovering(false);
        setError(
          'Bluetooth and location permissions are required to find printers — grant them in Android Settings → Apps → Coneeko POS → Permissions.',
        );
        return;
      }
      mod.BluetoothManager.scanDevices().catch((err: unknown) => {
        // Paired devices already arrived via EVENT_DEVICE_ALREADY_PAIRED regardless
        // of whether the live discovery scan below succeeds.
        setError(err instanceof Error ? err.message : 'Could not search for printers — check that Bluetooth is on.');
      }).finally(() => setDiscovering(false));
    });
  }, [getModule]);

  const stop = useCallback(() => {
    setDiscovering(false);
  }, []);

  return { supported, discovering, printers, error, start, stop };
}
