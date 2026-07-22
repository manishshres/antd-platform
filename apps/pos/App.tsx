import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { Button, PaperProvider, Snackbar } from 'react-native-paper';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import { posTheme, antd } from './src/theme';
import { migrate } from './src/db/database';
import { syncEngine } from './src/sync/syncEngine';
import { AppProvider, useApp } from './src/state/AppContext';
import { CartProvider } from './src/state/CartContext';
import { EmployeeProvider, useEmployee } from './src/state/EmployeeContext';
import * as catalogRepo from './src/db/catalogRepo';
import { Sidebar } from './src/components/Sidebar';
import { MoreMenuSheet } from './src/components/MoreMenuSheet';
import { printQueue } from './src/printing/printQueueService';
import { TopBar } from './src/components/TopBar';
import { CartPanel } from './src/components/CartPanel';
import { HomeScreen } from './src/screens/HomeScreen';
import { CustomersScreen } from './src/screens/CustomersScreen';
import { TablesScreen } from './src/screens/TablesScreen';
import { PaymentScreen } from './src/screens/PaymentScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { DrawerScreen } from './src/screens/DrawerScreen';
import { ReportsScreen } from './src/screens/ReportsScreen';
import { CallHistoryScreen } from './src/screens/CallHistoryScreen';
import { KdsScreen } from './src/screens/KdsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { StartDayScreen } from './src/screens/StartDayScreen';
import { SignOnScreen } from './src/screens/SignOnScreen';
import { ConnectionSetupScreen } from './src/screens/ConnectionSetupScreen';
import { isAdminScreen, type NavContext, type ScreenName } from './src/navigation';

migrate();
syncEngine.init();

function PosShell() {
  const { sync, dataVersion, settings } = useApp();
  const { employee, signOut, clockedInSince, isManager } = useEmployee();
  const [screen, setScreen] = useState<ScreenName>('home');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);

  const showCartPanel =
    screen === 'home' || screen === 'customers' || screen === 'tables';

  // A counter-only site has no floor plan, so Tables would route to an empty
  // screen — re-read after each sync in case a plan is added server-side.
  const hasTables = useMemo(() => catalogRepo.getTables().length > 0, [dataVersion]);

  const navCtx = useMemo<NavContext>(
    () => ({ isManager, hasTables }),
    [isManager, hasTables],
  );

  // Handing the tablet to a cashier via Switch Employee must not leave them
  // parked on Reports/Settings that the manager had open.
  useEffect(() => {
    if (!isManager && isAdminScreen(screen)) setScreen('home');
  }, [isManager, screen]);

  // Latest settings for the print queue's fire-and-forget callbacks, without
  // re-running the mount effect every time a setting changes.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // On launch, reclaim any kitchen ticket left mid-print by a previous crash or
  // force-quit and drain the queue. Also retry everything failed each time the
  // app returns to the foreground — the cheap stand-in for "printer reconnected"
  // without a dedicated Bluetooth event.
  useEffect(() => {
    printQueue.recoverAndProcess(settingsRef.current);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') printQueue.retryAllFailed(settingsRef.current);
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaView
      style={styles.root}
      edges={['top', 'bottom', 'left', 'right']}
    >
      <View style={styles.row}>
        <Sidebar
          active={screen}
          onNavigate={setScreen}
          pendingOfflineCount={sync.pendingOrders + sync.failedOrders}
          employeeName={employee?.displayName ?? null}
          onSwitchEmployee={() => void signOut()}
          clockedInSince={clockedInSince}
          ctx={navCtx}
          onOpenMore={() => setMoreOpen(true)}
        />
        <View style={styles.main}>
          <TopBar
            search={screen === 'home' ? search : undefined}
            onSearch={screen === 'home' ? setSearch : undefined}
            onSelectTable={() => setScreen('tables')}
          />
          <View style={styles.content}>
            <View style={styles.screen}>
              {screen === 'home' && <HomeScreen search={search} />}
              {screen === 'customers' && (
                <CustomersScreen onNavigate={setScreen} />
              )}
              {screen === 'tables' && (
                <TablesScreen onNavigate={setScreen} />
              )}
              {screen === 'payment' && (
                <PaymentScreen
                  onNavigate={setScreen}
                  onCompleted={setToast}
                />
              )}
              {screen === 'history' && (
                <HistoryScreen onNavigate={setScreen} />
              )}
              {screen === 'kds' && <KdsScreen />}
              {screen === 'drawer' && <DrawerScreen />}
              {screen === 'reports' && <ReportsScreen />}
              {screen === 'callHistory' && <CallHistoryScreen />}
              {screen === 'settings' && <SettingsScreen />}
           </View>
            {showCartPanel && (
              <CartPanel
                onProceed={() => setScreen('payment')}
                onSelectCustomer={() => setScreen('customers')}
              />
            )}
         </View>
       </View>
     </View>
      <MoreMenuSheet
        visible={moreOpen}
        onDismiss={() => setMoreOpen(false)}
        onNavigate={setScreen}
        active={screen}
        ctx={navCtx}
      />
      <Snackbar
        visible={toast.length > 0}
        onDismiss={() => setToast('')}
        duration={3500}
        style={{ backgroundColor: '#001529' }}
      >
        {toast}
     </Snackbar>
   </SafeAreaView>
  );
}

/** Gates everything behind a configured server connection — nothing else (sign-on,
 *  sync, catalog) can work until the register knows which organization it belongs to. */
function ConnectionGate({ children }: { children: React.ReactNode }) {
  const { ready, settings } = useApp();
  if (!ready) return null;
  if (!settings.apiUrl.trim() || !settings.apiKey.trim()) {
    return <ConnectionSetupScreen />;
  }
  return <>{children}</>;
}

function EmployeeGate({ children }: { children: React.ReactNode }) {
  const { ready, employee } = useEmployee();
  const [showSettings, setShowSettings] = useState(false);
  if (!ready) return null;
  if (!employee) {
    if (showSettings) {
      return (
        <View style={styles.preLoginSettings}>
          <View style={styles.preLoginBar}>
            <Button
              mode="text"
              icon="arrow-left"
              onPress={() => setShowSettings(false)}
              textColor={antd.textSecondary}
            >
              Back to Sign On
            </Button>
          </View>
          <SettingsScreen />
        </View>
      );
    }
    return <SignOnScreen onOpenSettings={() => setShowSettings(true)} />;
  }
  return <>{children}</>;
}

function BusinessDayGate({ children }: { children: React.ReactNode }) {
  const { businessDay } = useApp();
  if (!businessDay) {
    return <StartDayScreen />;
  }
  return <>{children}</>;
}

export default function App() {
  // A register can't be left to lock the screen mid-order — keep the display
  // on for as long as the app is in the foreground.
  useKeepAwake();

  return (
    <SafeAreaProvider>
      <PaperProvider theme={posTheme}>
        <AppProvider>
          <EmployeeProvider>
            <CartProvider>
              <StatusBar style="dark" />
              <ConnectionGate>
                <EmployeeGate>
                  <BusinessDayGate>
                    <PosShell />
                  </BusinessDayGate>
                </EmployeeGate>
              </ConnectionGate>
           </CartProvider>
         </EmployeeProvider>
       </AppProvider>
     </PaperProvider>
   </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: antd.bgContainer },
  row: { flex: 1, flexDirection: 'row' },
  main: { flex: 1 },
  content: { flex: 1, flexDirection: 'row' },
  screen: { flex: 1 },
  preLoginSettings: { flex: 1, backgroundColor: antd.bgLayout },
  preLoginBar: {
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
});
