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
import { ApiClient, ApiNetworkError, ApiRequestError } from '../api/client';
import type { Employee } from '../types';
import { useApp } from './AppContext';

const EMPLOYEE_KEY = 'pos.employee.v1';

interface EmployeeContextValue {
  ready: boolean;
  employee: Employee | null;
  signIn: (email: string, pin: string) => Promise<Employee>;
  signOut: () => Promise<void>;
  /** Resolve a manager PIN. Returns the verified manager or throws. */
  verifyManagerPin: (pin: string) => Promise<Employee>;
  isManager: boolean;
  /** ISO timestamp of the current shift's clock-in, or null if not clocked in. */
  clockedInSince: string | null;
}

const EmployeeContext = createContext<EmployeeContextValue | null>(null);

export function EmployeeProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useApp();
  const [ready, setReady] = useState(false);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [clockedInSince, setClockedInSince] = useState<string | null>(null);
  const employeeRef = useRef<Employee | null>(null);
  employeeRef.current = employee;

  const client = useMemo(
    () => new ApiClient(settings.apiUrl, settings.apiKey),
    [settings.apiUrl, settings.apiKey],
  );

  useEffect(() => {
    AsyncStorage.getItem(EMPLOYEE_KEY)
      .then(async (raw) => {
        if (!raw) return;
        const restored = JSON.parse(raw) as Employee;
        setEmployee(restored);
        if (client.isConfigured) {
          try {
            const status = await client.clockStatus(restored.id);
            setClockedInSince(status.clockedIn ? status.since : null);
          } catch {
            // Offline or unreachable — clock status just stays unknown until the
            // next successful check; it never blocks sign-in.
          }
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
    // Runs once on mount only — `client` depends on settings which are already
    // loaded by the time this provider mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback(async (next: Employee | null) => {
    setEmployee(next);
    if (next) await AsyncStorage.setItem(EMPLOYEE_KEY, JSON.stringify(next));
    else await AsyncStorage.removeItem(EMPLOYEE_KEY);
  }, []);

  const signIn = useCallback(
    async (email: string, pin: string): Promise<Employee> => {
      if (!client.isConfigured) {
        throw new ApiNetworkError('POS not configured (missing API URL or key).');
      }
      try {
        const next = await client.signInEmployee(email, pin);
        await persist(next);
        // Sign-on doubles as a shift punch — the register's whole reason for
        // asking for a PIN is "who's working right now," so treat it as one.
        try {
          const { clockInAt } = await client.clockIn(next.id);
          setClockedInSince(clockInAt);
        } catch {
          // Clock tracking is best-effort; a failed punch never blocks sign-in.
        }
        return next;
      } catch (err) {
        if (err instanceof ApiRequestError && (err.status === 401 || err.status === 404)) {
          throw new Error('Invalid email or PIN.');
        }
        throw err;
      }
    },
    [client, persist],
  );

  const signOut = useCallback(async () => {
    const current = employeeRef.current;
    if (current) {
      try {
        await client.clockOut(current.id);
      } catch {
        // Best-effort — signing out must never get stuck on a network call.
      }
    }
    setClockedInSince(null);
    await persist(null);
  }, [client, persist]);

  const verifyManagerPin = useCallback(
    async (pin: string): Promise<Employee> => {
      if (!client.isConfigured) {
        throw new ApiNetworkError('POS not configured.');
      }
      const self = employeeRef.current?.id;
      try {
        return await client.verifyManagerPin(pin, self);
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) {
          throw new Error('Invalid manager PIN.');
        }
        throw err;
      }
    },
    [client],
  );

  const value = useMemo<EmployeeContextValue>(
    () => ({
      ready,
      employee,
      signIn,
      signOut,
      verifyManagerPin,
      isManager: employee?.isManager ?? false,
      clockedInSince,
    }),
    [ready, employee, signIn, signOut, verifyManagerPin, clockedInSince],
  );

  return (
    <EmployeeContext.Provider value={value}>
      {children}
   </EmployeeContext.Provider>
  );
}

export function useEmployee(): EmployeeContextValue {
  const ctx = useContext(EmployeeContext);
  if (!ctx) throw new Error('useEmployee must be used inside EmployeeProvider');
  return ctx;
}
