import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import {
  Button,
  Dialog,
  Portal,
  Searchbar,
  Text,
  TextInput,
  TouchableRipple,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { useApp } from '../state/AppContext';
import { useCart } from '../state/CartContext';
import * as customersRepo from '../db/customersRepo';
import type { Customer } from '../types';
import type { ScreenName } from '../navigation';

interface Props {
  onNavigate: (screen: ScreenName) => void;
}

/** Pick or create the customer attached to the current order. */
export function CustomersScreen({ onNavigate }: Props) {
  const { dataVersion, syncNow, online } = useApp();
  const cart = useCart();
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '' });

  useEffect(() => {
    setCustomers(customersRepo.listCustomers(search));
  }, [search, dataVersion]);

  const addCustomer = () => {
    if (!form.name.trim()) return;
    const created = customersRepo.createLocalCustomer(form);
    setDialogOpen(false);
    setForm({ name: '', phone: '', email: '' });
    setSearch('');
    setCustomers(customersRepo.listCustomers());
    cart.setCustomer(created);
    if (online) syncNow();
  };

  const selectCustomer = (customer: Customer) => {
    cart.setCustomer(cart.customer?.id === customer.id ? null : customer);
    onNavigate('home');
  };

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Searchbar
          placeholder="Search customers by name or phone…"
          value={search}
          onChangeText={setSearch}
          style={styles.search}
          inputStyle={styles.searchInput}
          iconColor={antd.textTertiary}
        />
        <Button
          mode="contained"
          icon="plus"
          onPress={() => setDialogOpen(true)}
          style={styles.addBtn}
        >
          Add New Customer
        </Button>
      </View>

      <Text variant="titleSmall" style={styles.sectionTitle}>
        Recent Customers
      </Text>

      <View style={styles.listContainer}>
        <FlashList
          data={customers}
          estimatedItemSize={76}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons
              name="account-search-outline"
              size={44}
              color={antd.textQuaternary}
            />
            <Text variant="bodyMedium" style={styles.emptyText}>
              No customers found
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const selected = cart.customer?.id === item.id;
          return (
            <TouchableRipple
              onPress={() => selectCustomer(item)}
              style={[styles.row, selected && styles.rowSelected]}
              borderless
            >
              <View style={styles.rowInner}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {item.name.trim().charAt(0).toUpperCase() || '?'}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text variant="bodyLarge" style={styles.name}>
                      {item.name}
                    </Text>
                    {item.dirty && (
                      <MaterialCommunityIcons
                        name="cloud-upload-outline"
                        size={16}
                        color={antd.warning}
                      />
                    )}
                  </View>
                  <Text variant="bodySmall" style={styles.detail}>
                    {[item.phone, item.email].filter(Boolean).join('  ·  ') ||
                      'No contact details'}
                  </Text>
                </View>
                {selected ? (
                  <MaterialCommunityIcons
                    name="check-circle"
                    size={22}
                    color={antd.primary}
                  />
                ) : (
                  <Text variant="labelMedium" style={styles.selectHint}>
                    Select
                  </Text>
                )}
              </View>
            </TouchableRipple>
          );
        }}
        />
      </View>

      <Portal>
        <Dialog
          visible={dialogOpen}
          onDismiss={() => setDialogOpen(false)}
          style={styles.dialog}
        >
          <Dialog.Title>Add New Customer</Dialog.Title>
          <Dialog.Content style={{ gap: 12 }}>
            <TextInput
              label="Name *"
              mode="outlined"
              value={form.name}
              onChangeText={(name) => setForm((f) => ({ ...f, name }))}
              outlineStyle={styles.inputOutline}
            />
            <TextInput
              label="Phone"
              mode="outlined"
              keyboardType="phone-pad"
              value={form.phone}
              onChangeText={(phone) => setForm((f) => ({ ...f, phone }))}
              outlineStyle={styles.inputOutline}
            />
            <TextInput
              label="Email"
              mode="outlined"
              keyboardType="email-address"
              autoCapitalize="none"
              value={form.email}
              onChangeText={(email) => setForm((f) => ({ ...f, email }))}
              outlineStyle={styles.inputOutline}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              mode="contained"
              onPress={addCustomer}
              disabled={!form.name.trim()}
              style={{ borderRadius: RADIUS }}
            >
              Save & Attach
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: antd.bgLayout, padding: 16 },
  toolbar: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  search: {
    flex: 1,
    height: 44,
    borderRadius: RADIUS,
    backgroundColor: antd.bgContainer,
    borderWidth: 1,
    borderColor: antd.border,
  },
  searchInput: { fontSize: 14, minHeight: 0, alignSelf: 'center' },
  addBtn: { borderRadius: RADIUS, justifyContent: 'center' },
  sectionTitle: { color: antd.textSecondary, marginBottom: 8 },
  listContainer: { flex: 1 },
  list: { paddingBottom: 16 },
  row: {
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    marginBottom: 8,
  },
  rowSelected: { borderColor: antd.primary, backgroundColor: antd.primaryBg },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: RADIUS,
    backgroundColor: antd.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: antd.primary, fontWeight: '700', fontSize: 16 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: antd.text, fontWeight: '600' },
  detail: { color: antd.textTertiary },
  selectHint: { color: antd.primary },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText: { color: antd.textTertiary },
  dialog: { borderRadius: RADIUS, backgroundColor: antd.bgContainer, maxWidth: 480, alignSelf: 'center', width: '100%' },
  inputOutline: { borderRadius: RADIUS },
});
