import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { Button, Divider, Text, TextInput } from 'react-native-paper';
import { antd, RADIUS } from '../theme';
import { useApp } from '../state/AppContext';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';

/**
 * First-run gate: the register can't sync a catalog, sign an employee in, or
 * do anything else until it knows which organization it belongs to. Shown
 * before SignOnScreen whenever the API URL/key aren't set yet; saving here
 * (or a matching QR scan) flips AppContext's settings and the app
 * automatically advances to Sign On.
 */
export function ConnectionSetupScreen() {
  const { saveSettings } = useApp();
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const connect = async () => {
    if (!apiUrl.trim() || !apiKey.trim()) {
      setError('Enter both the API URL and key, or scan the connection QR code.');
      return;
    }
    setError(null);
    await saveSettings({ apiUrl: apiUrl.trim(), apiKey: apiKey.trim() });
  };

  const handleQrScanned = async (data: string) => {
    let parsed: { apiUrl?: unknown; apiKey?: unknown };
    try {
      parsed = JSON.parse(data);
    } catch {
      setError("That QR code isn't a Coneeko POS connection code.");
      return;
    }
    if (typeof parsed.apiUrl !== 'string' || typeof parsed.apiKey !== 'string' || !parsed.apiUrl || !parsed.apiKey) {
      setError('That QR code is missing the API URL or key.');
      return;
    }
    setScannerOpen(false);
    setError(null);
    await saveSettings({ apiUrl: parsed.apiUrl.trim(), apiKey: parsed.apiKey.trim() });
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text variant="headlineSmall" style={styles.title}>
          Connect this register
        </Text>
        <Text variant="bodyMedium" style={styles.subtitle}>
          Scan the connection QR code from Dashboard → Settings → API Keys, or
          enter the API URL and key by hand.
        </Text>

        <Button
          mode="contained"
          icon="qrcode-scan"
          onPress={() => setScannerOpen(true)}
          style={styles.scanBtn}
          contentStyle={{ paddingVertical: 6 }}
        >
          Scan QR Code
        </Button>

        <Divider style={{ marginVertical: 4 }} />
        <Text variant="labelSmall" style={styles.orText}>
          OR ENTER MANUALLY
        </Text>

        <TextInput
          mode="outlined"
          label="API base URL"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://api.example.com"
          value={apiUrl}
          onChangeText={setApiUrl}
          style={styles.input}
        />
        <TextInput
          mode="outlined"
          label="API key"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          value={apiKey}
          onChangeText={setApiKey}
          style={styles.input}
        />
        {error ? (
          <Text variant="labelSmall" style={styles.errorText}>
            {error}
          </Text>
        ) : null}

        <Button
          mode="outlined"
          onPress={connect}
          style={styles.cta}
          contentStyle={{ paddingVertical: 6 }}
        >
          Connect
        </Button>
      </View>

      <BarcodeScannerModal
        visible={scannerOpen}
        onDismiss={() => setScannerOpen(false)}
        onScan={(data) => void handleQrScanned(data)}
        title="Scan Connection QR Code"
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: antd.bgLayout,
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS * 2,
    padding: 28,
    gap: 12,
    borderWidth: 1,
    borderColor: antd.split,
  },
  title: { color: antd.text, fontWeight: '800' },
  subtitle: { color: antd.textSecondary, marginBottom: 6 },
  scanBtn: { marginTop: 4 },
  orText: { color: antd.textQuaternary, textAlign: 'center', letterSpacing: 0.5 },
  input: { marginTop: 4 },
  errorText: { color: antd.error },
  cta: { marginTop: 4 },
});
