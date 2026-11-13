import type { ThemeConfig } from "antd";

// CSS is the runtime token owner. The library adapter reads the same values.
const styles = getComputedStyle(document.documentElement);
const token = (name: string) => styles.getPropertyValue(name).trim();
const size = (name: string) => Number.parseFloat(token(name));

export const appTheme: ThemeConfig = {
  token: {
    colorPrimary: token("--secondary-color"),
    colorSuccess: token("--success-color"),
    colorWarning: token("--warning-color"),
    colorError: token("--error-color"),
    colorText: token("--text-primary"),
    colorTextSecondary: token("--text-secondary"),
    colorBorder: token("--border-color"),
    colorBgLayout: token("--background-color"),
    colorBgContainer: token("--surface-color"),
    fontFamily: token("--font-sans"),
    lineHeight: 1.6,
    controlHeight: size("--control-height"),
    borderRadius: size("--border-radius-sm"),
    borderRadiusLG: size("--border-radius-md"),
    boxShadowSecondary: token("--shadow-lg"),
  },
  components: {
    Button: { fontWeight: 500, primaryShadow: "none" },
    Card: { headerFontSize: 15, bodyPadding: 24 },
    Table: {
      headerBg: token("--table-header-bg"),
      cellPaddingBlock: 16,
      cellPaddingInline: 20,
    },
    Menu: {
      darkItemBg: token("--nav-background"),
      darkItemColor: token("--nav-text"),
      darkItemHoverBg: token("--nav-hover"),
      darkItemSelectedBg: token("--nav-selected"),
      darkItemSelectedColor: token("--nav-selected-text"),
      darkGroupTitleColor: token("--nav-muted"),
      itemHeight: 44,
      itemBorderRadius: size("--border-radius-sm"),
    },
    Select: { optionSelectedBg: token("--accent-soft") },
    Modal: { borderRadiusLG: size("--border-radius-lg") },
  },
};
