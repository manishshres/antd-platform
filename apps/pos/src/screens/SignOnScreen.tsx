import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { antd, RADIUS } from '../theme';
import { useEmployee } from '../state/EmployeeContext';
import { useApp } from '../state/AppContext';
import { PinPadModal } from '../components/PinPadModal';

interface Props {
  onOpenSettings: () => void;
}

export function SignOnScreen({ onOpenSettings }: Props) {
  const { settings } = useApp();
  const { signIn } = useEmployee();
  const [email, setEmail] = useState('');
  const [pinModal, setPinModal] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const beginPinEntry = () => {
    if (!email.trim()) {
      setEmailError('Enter your work email.');
      return;
    }
    setEmailError(null);
    setPinError(null);
    setPinModal(true);
  };

  const handleSubmitPin = async (pin: string) => {
    setBusy(true);
    setPinError(null);
    try {
      await signIn(email.trim(), pin);
    } catch (err) {
      setPinModal(true);
      setPinError(err instanceof Error ? err.message : 'Unable to sign in.');
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text variant="headlineSmall" style={styles.title}>
          {settings.locationName || 'Coneeko POS'}
       </Text>
        <Text variant="bodyMedium" style={styles.subtitle}>
          Sign on with your work email and 6-digit PIN.
       </Text>

        <TextInput
          mode="outlined"
          label="Email"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          error={Boolean(emailError)}
          style={styles.input}
        />
        {emailError ? (
          <Text variant="labelSmall" style={styles.errorText}>
            {emailError}
          </Text>
        ) : null}

        <Button
          mode="contained"
          onPress={beginPinEntry}
          disabled={busy}
          style={styles.cta}
          contentStyle={{ paddingVertical: 6 }}
        >
          Continue
       </Button>

        <Button
          mode="outlined"
          icon="cog-outline"
          onPress={onOpenSettings}
          style={styles.settingsBtn}
        >
          Open Settings
        </Button>
     </View>

      <PinPadModal
        visible={pinModal}
        title="Enter PIN"
        subtitle={email}
        busy={busy}
        errorMessage={pinError}
        onSubmit={handleSubmitPin}
        onCancel={() => {
          if (busy) return;
          setPinModal(false);
          setPinError(null);
        }}
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
  input: { marginTop: 4 },
  errorText: { color: antd.error },
  cta: { marginTop: 12 },
  settingsBtn: { marginTop: 4 },
});
