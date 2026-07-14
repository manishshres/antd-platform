import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Divider, Text, TextInput, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { useApp } from '../state/AppContext';
import * as catalogRepo from '../db/catalogRepo';
import type { Location } from '../types';

/** Register configuration: API connection, location, and sync status. */
export function SettingsScreen() {
  const { settings, saveSettings, sync, syncNow, online, dataVersion } = useApp();
  const [apiUrl, setApiUrl] = useState(settings.apiUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [locations, setLocations] = useState<Location[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLocations(catalogRepo.getLocations());
  }, [dataVersion]);

  const saveConnection = async () => {
    await saveSettings({ apiUrl: apiUrl.trim(), apiKey: apiKey.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const pickLocation = async (loc: Location) => {
    await saveSettings({
      locationId: loc.id,
      locationName: loc.name,
      taxRateBps: loc.taxRateBps,
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text variant="titleMedium" style={styles.cardTitle}>
          Server Connection
        </Text>
        <Text variant="bodySmall" style={styles.cardSub}>
          The register talks to the platform's public API using an organization
          API key (Dashboard → Billing → API Keys).
        </Text>
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

      <View style={styles.card}>
        <Text variant="titleMedium" style={styles.cardTitle}>
          Sync
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

      <Text variant="labelSmall" style={styles.version}>
        Coneeko POS · part of the antd-platform release train
      </Text>
    </ScrollView>
  );
}

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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: antd.bgLayout },
  content: { padding: 16, gap: 16, maxWidth: 640, width: '100%', alignSelf: 'center' },
  card: {
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    padding: 16,
    gap: 12,
  },
  cardTitle: { color: antd.text, fontWeight: '700' },
  cardSub: { color: antd.textTertiary },
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
    padding: 12,
  },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  version: { color: antd.textQuaternary, textAlign: 'center', marginBottom: 24 },
});
