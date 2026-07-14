import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Searchbar, Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { useApp } from '../state/AppContext';
import { useCart } from '../state/CartContext';

interface Props {
  search?: string;
  onSearch?: (value: string) => void;
  onSelectTable: () => void;
}

/** Search + connectivity/sync status + table shortcut, shown on every screen. */
export function TopBar({ search, onSearch, onSelectTable }: Props) {
  const { online, sync, syncNow, settings } = useApp();
  const { table } = useCart();

  return (
    <View style={styles.container}>
      {onSearch ? (
        <Searchbar
          placeholder="Search products…"
          value={search ?? ''}
          onChangeText={onSearch}
          style={styles.search}
          inputStyle={styles.searchInput}
          iconColor={antd.textTertiary}
        />
      ) : (
        <View style={styles.titleWrap}>
          <Text variant="titleMedium" style={styles.title}>
            {settings.locationName || 'Coneeko POS'}
          </Text>
        </View>
      )}

      <View style={styles.right}>
        <View style={styles.status}>
          <MaterialCommunityIcons
            name={online ? 'wifi' : 'wifi-off'}
            size={18}
            color={online ? antd.success : antd.error}
          />
          <Text variant="labelSmall" style={styles.statusText}>
            {online ? 'Online' : 'Offline'}
          </Text>
        </View>
        <Button
          mode="text"
          compact
          icon={sync.syncing ? 'sync' : 'cloud-sync-outline'}
          loading={sync.syncing}
          disabled={!online || sync.syncing}
          onPress={syncNow}
          textColor={antd.textSecondary}
        >
          Sync
        </Button>
        <Button
          mode="contained"
          icon="table-furniture"
          onPress={onSelectTable}
          style={styles.tableButton}
          contentStyle={styles.tableButtonContent}
        >
          {table ? `Table ${table.name}` : 'Select Table'}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
    backgroundColor: antd.bgContainer,
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
  },
  search: {
    flex: 1,
    maxWidth: 420,
    height: 40,
    borderRadius: RADIUS,
    backgroundColor: antd.bgLayout,
    borderWidth: 1,
    borderColor: antd.border,
  },
  searchInput: {
    fontSize: 14,
    minHeight: 0,
    alignSelf: 'center',
  },
  titleWrap: { flex: 1 },
  title: { color: antd.text, fontWeight: '600' },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 'auto',
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS,
    backgroundColor: antd.bgLayout,
    borderWidth: 1,
    borderColor: antd.split,
  },
  statusText: { color: antd.textSecondary },
  tableButton: { borderRadius: RADIUS },
  tableButtonContent: { height: 40 },
});
