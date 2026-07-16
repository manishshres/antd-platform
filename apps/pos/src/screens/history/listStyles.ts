import { StyleSheet } from 'react-native';
import { antd } from '../../theme';

/** Table/list styles shared by the three left-panel tabs. */
export const listStyles = StyleSheet.create({
  colHeader: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: antd.bgLayout,
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
  },
  colHdrText: {
    fontSize: 11,
    fontWeight: '600',
    color: antd.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
  },
  tableRowSelected: {
    backgroundColor: antd.primaryBg,
  },
  cellTicket: { fontSize: 13, fontWeight: '600', color: antd.primary },
  cellText: { fontSize: 13, color: antd.text },
  cellAmount: { fontSize: 13, fontWeight: '600', color: antd.text, textAlign: 'right' },
  cellSub: { fontSize: 11, color: antd.textTertiary, marginTop: 2 },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 10,
  },
});
