/**
 * Shared inline styles for the transactional email templates. Email clients
 * have no shared stylesheet and inconsistent CSS support, so every style is
 * inline and uses widely-supported properties only. Colours mirror the
 * dashboard's near-black / zinc palette so the emails read as the same product.
 */

export const colors = {
  background: "#f4f4f5",
  card: "#ffffff",
  border: "#e4e4e7",
  ink: "#18181b",
  body: "#3f3f46",
  muted: "#a1a1aa",
  buttonText: "#ffffff",
} as const;

const fontStack =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const styles = {
  main: {
    backgroundColor: colors.background,
    fontFamily: fontStack,
    margin: 0,
    padding: "32px 12px",
  },
  container: {
    backgroundColor: colors.card,
    border: `1px solid ${colors.border}`,
    borderRadius: "14px",
    maxWidth: "464px",
    margin: "0 auto",
    padding: "40px",
  },
  brand: {
    fontSize: "20px",
    fontWeight: 700,
    letterSpacing: "-0.04em",
    color: colors.ink,
    margin: 0,
  },
  heading: {
    fontSize: "20px",
    fontWeight: 600,
    color: colors.ink,
    margin: "24px 0 12px",
  },
  text: {
    fontSize: "14px",
    lineHeight: "22px",
    color: colors.body,
    margin: "0 0 16px",
  },
  button: {
    backgroundColor: colors.ink,
    borderRadius: "8px",
    color: colors.buttonText,
    fontSize: "14px",
    fontWeight: 600,
    textDecoration: "none",
    textAlign: "center" as const,
    display: "block",
    padding: "12px 20px",
    margin: "4px 0 20px",
  },
  fallbackLabel: {
    fontSize: "13px",
    lineHeight: "20px",
    color: colors.muted,
    margin: "0 0 4px",
  },
  fallbackLink: {
    fontSize: "13px",
    lineHeight: "20px",
    color: colors.body,
    wordBreak: "break-all" as const,
  },
  hr: {
    borderColor: colors.border,
    margin: "28px 0 16px",
  },
  footer: {
    fontSize: "12px",
    lineHeight: "18px",
    color: colors.muted,
    margin: "0 0 4px",
  },
} as const;
