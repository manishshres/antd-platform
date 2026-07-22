import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple, Badge } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import {
  PRIMARY_NAV,
  visibleNav,
  isSecondaryScreen,
  type NavContext,
  type ScreenName,
} from '../navigation';

interface Props {
  active: ScreenName;
  onNavigate: (screen: ScreenName) => void;
  pendingOfflineCount: number;
  employeeName?: string | null;
  onSwitchEmployee?: () => void;
  /** ISO timestamp of the current shift's clock-in, if any. */
  clockedInSince?: string | null;
  ctx: NavContext;
  onOpenMore: () => void;
}

export function Sidebar({
  active,
  onNavigate,
  pendingOfflineCount,
  employeeName = null,
  onSwitchEmployee,
  clockedInSince = null,
  ctx,
  onOpenMore,
}: Props) {
  const items = visibleNav(PRIMARY_NAV, ctx);
  // While the cashier is on a secondary screen the rail has no lit item, so More
  // carries the active state — otherwise the nav reads as "nowhere selected".
  const moreActive = isSecondaryScreen(active);

  return (
    <View style={styles.container}>
      <View style={styles.logo}>
        <MaterialCommunityIcons
          name="silverware-fork-knife"
          size={26}
          color={antd.primary}
        />
      </View>
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <TouchableRipple
            key={item.key}
            onPress={() => onNavigate(item.key)}
            style={[styles.item, isActive && styles.itemActive]}
            borderless
          >
            <View style={styles.itemInner}>
              <MaterialCommunityIcons
                name={item.icon as never}
                size={24}
                color={isActive ? antd.primary : antd.textTertiary}
              />
              <Text
                variant="labelSmall"
                style={[styles.label, isActive && styles.labelActive]}
                numberOfLines={1}
              >
                {item.label}
              </Text>
              {item.key === 'history' && pendingOfflineCount > 0 && (
                <Badge size={16} style={styles.badge}>
                  {pendingOfflineCount}
                </Badge>
              )}
            </View>
          </TouchableRipple>
        );
      })}

      <TouchableRipple
        onPress={onOpenMore}
        style={[styles.item, moreActive && styles.itemActive]}
        borderless
      >
        <View style={styles.itemInner}>
          <MaterialCommunityIcons
            name="dots-horizontal-circle-outline"
            size={24}
            color={moreActive ? antd.primary : antd.textTertiary}
          />
          <Text
            variant="labelSmall"
            style={[styles.label, moreActive && styles.labelActive]}
            numberOfLines={1}
          >
            More
          </Text>
        </View>
      </TouchableRipple>

      {employeeName ? (
        <View style={styles.employeeBlock}>
          <MaterialCommunityIcons
            name="account-circle-outline"
            size={20}
            color={antd.textTertiary}
          />
          <Text
            variant="labelSmall"
            numberOfLines={2}
            style={styles.employeeName}
          >
            {employeeName}
          </Text>
          {clockedInSince && (
            <View style={styles.clockBadge}>
              <MaterialCommunityIcons
                name="clock-check-outline"
                size={12}
                color={antd.success}
              />
              <Text variant="labelSmall" style={styles.clockText}>
                {new Date(clockedInSince).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Text>
            </View>
          )}
          {onSwitchEmployee ? (
            <TouchableRipple onPress={onSwitchEmployee} style={styles.switchBtn} borderless>
              <MaterialCommunityIcons
                name="swap-horizontal"
                size={18}
                color={antd.textSecondary}
              />
            </TouchableRipple>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 84,
    backgroundColor: antd.bgContainer,
    borderRightWidth: 1,
    borderRightColor: antd.split,
    alignItems: 'center',
    paddingVertical: 12,
    gap: 4,
  },
  logo: {
    width: 48,
    height: 48,
    borderRadius: RADIUS,
    backgroundColor: antd.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  item: {
    width: 68,
    borderRadius: RADIUS,
    // 56pt of vertical target — comfortably above the 48dp Android touch minimum
    // for a rail that gets hit at speed with wet or gloved hands.
    paddingVertical: 12,
  },
  itemActive: {
    backgroundColor: antd.primaryBg,
  },
  itemInner: {
    alignItems: 'center',
    gap: 4,
  },
  label: {
    color: antd.textTertiary,
    fontSize: 11,
  },
  labelActive: {
    color: antd.primary,
    fontWeight: '600',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: 8,
    backgroundColor: antd.error,
  },
  employeeBlock: {
    marginTop: 'auto',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: antd.split,
    width: 68,
    alignItems: 'center',
    gap: 4,
  },
  employeeName: {
    color: antd.textSecondary,
    fontSize: 10,
    textAlign: 'center',
  },
  clockBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  clockText: { color: antd.success, fontSize: 9, fontWeight: '600' },
  switchBtn: {
    marginTop: 2,
    width: 32,
    height: 24,
    borderRadius: RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
