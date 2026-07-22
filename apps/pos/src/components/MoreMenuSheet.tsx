import React from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { IconButton, Text, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { MORE_NAV, adminNavFor, type NavContext, type NavItem, type ScreenName } from '../navigation';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onNavigate: (screen: ScreenName) => void;
  active: ScreenName;
  ctx: NavContext;
}

/**
 * The overflow behind the rail's "More" button. Two sections only: Tools (any
 * signed-in employee) and Admin (managers). Tiles are deliberately oversized —
 * this is reached mid-service on a tablet, often one-handed.
 */
export function MoreMenuSheet({ visible, onDismiss, onNavigate, active, ctx }: Props) {
  const adminItems = adminNavFor(ctx);

  const renderTile = (item: NavItem) => {
    const isActive = item.key === active;
    return (
      <TouchableRipple
        key={item.key}
        onPress={() => {
          onNavigate(item.key);
          onDismiss();
        }}
        style={[styles.tile, isActive && styles.tileActive]}
        borderless
      >
        <View style={styles.tileInner}>
          <MaterialCommunityIcons
            name={item.icon as never}
            size={30}
            color={isActive ? antd.primary : antd.textSecondary}
          />
          <Text
            variant="bodyMedium"
            style={[styles.tileLabel, isActive && styles.tileLabelActive]}
            numberOfLines={2}
          >
            {item.label}
          </Text>
        </View>
      </TouchableRipple>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text variant="titleMedium" style={styles.headerTitle}>
              More
            </Text>
            <IconButton icon="close" size={22} onPress={onDismiss} iconColor={antd.textSecondary} />
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            <Text variant="labelMedium" style={styles.sectionLabel}>
              TOOLS
            </Text>
            <View style={styles.grid}>{MORE_NAV.map(renderTile)}</View>

            {adminItems.length > 0 && (
              <>
                <View style={styles.adminHeader}>
                  <Text variant="labelMedium" style={styles.sectionLabel}>
                    ADMIN
                  </Text>
                  <View style={styles.managerChip}>
                    <MaterialCommunityIcons
                      name="shield-account-outline"
                      size={12}
                      color={antd.warning}
                    />
                    <Text variant="labelSmall" style={styles.managerChipText}>
                      Manager
                    </Text>
                  </View>
                </View>
                <View style={styles.grid}>{adminItems.map(renderTile)}</View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '85%',
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS * 2,
    padding: 16,
    gap: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { color: antd.text, fontWeight: '700' },
  body: { paddingBottom: 8, gap: 8 },
  sectionLabel: {
    color: antd.textTertiary,
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  adminHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: antd.split,
  },
  managerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS,
    backgroundColor: antd.warningBg,
  },
  managerChipText: { color: antd.warning, fontWeight: '700', fontSize: 9 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: 140,
    height: 104,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    backgroundColor: antd.bgLayout,
  },
  tileActive: {
    borderColor: antd.primary,
    backgroundColor: antd.primaryBg,
  },
  tileInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  tileLabel: { color: antd.textSecondary, textAlign: 'center' },
  tileLabelActive: { color: antd.primary, fontWeight: '700' },
});
