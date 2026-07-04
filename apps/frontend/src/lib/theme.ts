import { ThemeConfig } from "antd";

/**
 * Unified Ant Design v6 Theme Configuration
 * Adheres strictly to an 8px spacing system and design tokens.
 */
export const themeConfig: ThemeConfig = {
  token: {
    // Colors
    colorPrimary: "#1677ff",
    colorSuccess: "#52c41a",
    colorWarning: "#faad14",
    colorError: "#f5222d",
    colorInfo: "#1677ff",
    
    // Typography
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    fontSize: 14,
    fontSizeHeading1: 32,
    fontSizeHeading2: 24,
    fontSizeHeading3: 20,
    fontSizeHeading4: 16,
    
    // Spacing (8px grid system)
    marginXXS: 4,
    marginXS: 8,
    marginSM: 16,
    margin: 24,
    marginMD: 32,
    marginLG: 40,
    marginXL: 48,
    marginXXL: 64,

    paddingXXS: 4,
    paddingXS: 8,
    paddingSM: 16,
    padding: 24,
    paddingMD: 32,
    paddingLG: 40,
    paddingXL: 48,

    // Border Radius
    borderRadius: 4,
    borderRadiusSM: 2,
    borderRadiusLG: 4,

    // Shadows
    boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
    boxShadowSecondary: "0 1px 2px rgba(0,0,0,0.04)",
  },
  components: {
    Layout: {
      headerBg: "#ffffff",
      siderBg: "#001529",
    },
    Card: {
      paddingLG: 24,
      borderRadiusLG: 4,
    },
    Button: {
      paddingInline: 16,
      controlHeight: 36,
      borderRadius: 4,
    },
    Table: {
      padding: 16,
      borderRadius: 4,
    },
  },
};
