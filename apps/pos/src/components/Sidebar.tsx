import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple, Badge } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { NAV_ITEMS, type ScreenName } from '../navigation';

interface Props {
  active: ScreenName;
  onNavigate: (screen: ScreenName) => void;
  pendingOfflineCount: number;
}

export function Sidebar({ active, onNavigate, pendingOfflineCount }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.logo}>
        <MaterialCommunityIcons
          name="silverware-fork-knife"
          size={26}
          color={antd.primary}
        />
      </View>
      {NAV_ITEMS.map((item) => {
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
                size={22}
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
    paddingVertical: 10,
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
});
