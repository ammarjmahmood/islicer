export const COLORS = {
  bg: '#0A0A0A',
  surface: '#141414',
  surfaceLight: '#1E1E1E',
  border: '#2A2A2A',
  borderLight: '#3A3A3A',
  primary: '#00D4AA',
  primaryDim: '#00D4AA30',
  secondary: '#7C5CFC',
  secondaryDim: '#7C5CFC30',
  accent: '#FF6B35',
  accentDim: '#FF6B3530',
  text: '#FFFFFF',
  textSecondary: '#999999',
  textMuted: '#666666',
  success: '#00D4AA',
  warning: '#FFB800',
  error: '#FF4757',
  white: '#FFFFFF',
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
};

export const FONTS = {
  regular: { fontSize: 14, color: COLORS.text },
  small: { fontSize: 12, color: COLORS.textSecondary },
  body: { fontSize: 16, color: COLORS.text },
  heading: { fontSize: 24, fontWeight: '700' as const, color: COLORS.text },
  title: { fontSize: 32, fontWeight: '800' as const, color: COLORS.text },
};
