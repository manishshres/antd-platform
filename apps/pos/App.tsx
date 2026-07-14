import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { PaperProvider, Snackbar } from 'react-native-paper';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { posTheme, antd } from './src/theme';
import { migrate } from './src/db/database';
import { syncEngine } from './src/sync/syncEngine';
import { AppProvider, useApp } from './src/state/AppContext';
import { CartProvider } from './src/state/CartContext';
import { Sidebar } from './src/components/Sidebar';
import { TopBar } from './src/components/TopBar';
import { CartPanel } from './src/components/CartPanel';
import { HomeScreen } from './src/screens/HomeScreen';
import { CustomersScreen } from './src/screens/CustomersScreen';
import { TablesScreen } from './src/screens/TablesScreen';
import { PaymentScreen } from './src/screens/PaymentScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { ReportsScreen } from './src/screens/ReportsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import type { ScreenName } from './src/navigation';

// Open + migrate the local database before first render; every screen reads it.
migrate();
syncEngine.init();

function PosShell() {
  const { sync } = useApp();
  const [screen, setScreen] = useState<ScreenName>('home');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');

  const showCartPanel = screen === 'home' || screen === 'customers' || screen === 'tables';

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.row}>
        <Sidebar
          active={screen}
          onNavigate={setScreen}
          pendingOfflineCount={sync.pendingOrders + sync.failedOrders}
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
              {screen === 'customers' && <CustomersScreen onNavigate={setScreen} />}
              {screen === 'tables' && <TablesScreen onNavigate={setScreen} />}
              {screen === 'payment' && (
                <PaymentScreen onNavigate={setScreen} onCompleted={setToast} />
              )}
              {screen === 'history' && <HistoryScreen onNavigate={setScreen} />}
              {screen === 'reports' && <ReportsScreen />}
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

export default function App() {
  return (
    <SafeAreaProvider>
      <PaperProvider theme={posTheme}>
        <AppProvider>
          <CartProvider>
            <StatusBar style="dark" />
            <PosShell />
          </CartProvider>
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
});
