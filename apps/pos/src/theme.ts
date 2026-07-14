import { MD3LightTheme, configureFonts, type MD3Theme } from 'react-native-paper';

/**
 * Ant Design default palette mapped onto React Native Paper's MD3 theme.
 * https://ant.design/docs/spec/colors — Daybreak Blue primary, semantic
 * green/gold/red, and the neutral text/border ramp.
 */
export const antd = {
  // Brand
  primary: '#1677ff',
  primaryHover: '#4096ff',
  primaryActive: '#0958d9',
  primaryBg: '#e6f4ff',
  primaryBorder: '#91caff',
  // Semantic
  success: '#52c41a',
  successBg: '#f6ffed',
  successBorder: '#b7eb8f',
  warning: '#faad14',
  warningBg: '#fffbe6',
  warningBorder: '#ffe58f',
  error: '#ff4d4f',
  errorBg: '#fff2f0',
  errorBorder: '#ffccc7',
  // Neutrals
  text: 'rgba(0, 0, 0, 0.88)',
  textSecondary: 'rgba(0, 0, 0, 0.65)',
  textTertiary: 'rgba(0, 0, 0, 0.45)',
  textQuaternary: 'rgba(0, 0, 0, 0.25)',
  border: '#d9d9d9',
  split: '#f0f0f0',
  fill: 'rgba(0, 0, 0, 0.15)',
  fillSecondary: 'rgba(0, 0, 0, 0.06)',
  fillTertiary: 'rgba(0, 0, 0, 0.04)',
  bgContainer: '#ffffff',
  bgLayout: '#f5f5f5',
  bgMask: 'rgba(0, 0, 0, 0.45)',
} as const;

/** Global corner radius — Ant Design's default `borderRadius: 4`. */
export const RADIUS = 4;

export const posTheme: MD3Theme = {
  ...MD3LightTheme,
  // MD3 components multiply `roundness`; 1 keeps everything near-rectangular.
  // Components that need exactly 4px get it via explicit styles using RADIUS.
  roundness: 1,
  colors: {
    ...MD3LightTheme.colors,
    primary: antd.primary,
    onPrimary: '#ffffff',
    primaryContainer: antd.primaryBg,
    onPrimaryContainer: antd.primaryActive,
    secondary: antd.textSecondary,
    onSecondary: '#ffffff',
    secondaryContainer: antd.fillSecondary,
    onSecondaryContainer: antd.text,
    tertiary: antd.success,
    onTertiary: '#ffffff',
    tertiaryContainer: antd.successBg,
    onTertiaryContainer: antd.success,
    error: antd.error,
    onError: '#ffffff',
    errorContainer: antd.errorBg,
    onErrorContainer: antd.error,
    background: antd.bgLayout,
    onBackground: antd.text,
    surface: antd.bgContainer,
    onSurface: antd.text,
    surfaceVariant: antd.bgLayout,
    onSurfaceVariant: antd.textSecondary,
    outline: antd.border,
    outlineVariant: antd.split,
    inverseSurface: '#001529',
    inverseOnSurface: '#ffffff',
    inversePrimary: antd.primaryBorder,
    surfaceDisabled: antd.fillTertiary,
    onSurfaceDisabled: antd.textQuaternary,
    backdrop: antd.bgMask,
    elevation: {
      ...MD3LightTheme.colors.elevation,
      level0: 'transparent',
      level1: '#ffffff',
      level2: '#ffffff',
      level3: '#ffffff',
      level4: '#ffffff',
      level5: '#ffffff',
    },
  },
  fonts: configureFonts({ config: { fontFamily: 'System' } }),
};
