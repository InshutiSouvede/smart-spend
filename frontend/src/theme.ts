// ─── Aurelian Finance Design System ─────────────────────────────────────────
// Color distribution: Background 60% · Structural/champagne 30% · Amber 10%

export const colors = {
  // ─── Primary backgrounds ──────────────────────────────────────────────────
  background: '#F8F8F6',             // Soft off-white — main screen background
  surface: '#FFFFFF',                // White card surface
  surfaceLow: '#F6F3F2',             // Low-elevation surface
  surfaceContainer: '#F0EDEC',       // Standard container
  surfaceHigherContainer: '#EBE7E7', // Higher container

  // ─── Champagne gradient (structural, summary cards only) ─────────────────
  gradientStart: '#E7DCCE',
  gradientEnd: '#C7B9A7',

  // ─── Charcoal text & structural elements ─────────────────────────────────
  textPrimary: '#111111',     // Primary charcoal
  textSecondary: '#4F4536',   // Warm dark-brown secondary
  textMuted: '#655D52',       // Muted structural text

  // ─── Amber accent (~10% usage) ────────────────────────────────────────────
  primary: '#DDA743',         // Amber/gold — buttons, active states, CTAs
  primaryPressed: '#C8933A',  // Pressed/hover state
  primaryLight: '#F6EDD8',    // Very light amber tint

  // ─── Borders ──────────────────────────────────────────────────────────────
  border: '#E7DCCE',          // Subtle champagne border
  borderMuted: '#D3C4B0',     // More visible border

  // ─── Income & Expense ─────────────────────────────────────────────────────
  income: '#2D5A27',          // Forest green — income text/indicators
  expense: '#A34537',         // Terracotta — expense text/indicators
  incomeLight: '#EBF2EA',
  expenseLight: '#F5ECEA',

  // ─── Status ───────────────────────────────────────────────────────────────
  error: '#BA1A1A',           // Functional error (distinct from expense)
  errorLight: '#FAEAEA',
  success: '#2D5A27',
  successLight: '#EBF2EA',
  warning: '#DDA743',         // Amber — same as primary accent
  warningLight: '#FDF2DE',

  // ─── Misc ─────────────────────────────────────────────────────────────────
  divider: '#E7DCCE',
  info: '#4A7AAC',
  infoLight: '#E7EFF8',
};

// ─── Font families (loaded via @expo-google-fonts) ────────────────────────────
export const fonts = {
  displayBold: 'Manrope_700Bold',
  headingBold: 'Manrope_700Bold',
  headingSemiBold: 'Manrope_600SemiBold',
  headingMedium: 'Manrope_500Medium',
  bodyRegular: 'HankenGrotesk_400Regular',
  bodyMedium: 'HankenGrotesk_500Medium',
  bodySemiBold: 'HankenGrotesk_600SemiBold',
};

// ─── Spacing (4px base, 8px visual rhythm) ───────────────────────────────────
export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,   // Mobile horizontal margin
  xl: 24,   // Card padding / section spacing
  xxl: 32,  // Section separation
  xxxl: 40, // Major hierarchy
};

// ─── Border radii ─────────────────────────────────────────────────────────────
export const radius = {
  xs: 4,     // Controls, buttons, inputs
  sm: 6,     // Compact elements
  md: 8,     // Standard cards
  lg: 12,    // Prominent summary cards
  full: 9999, // Pills, chips
};

// ─── Typography scale ─────────────────────────────────────────────────────────
export const typography = {
  display: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 40,
    lineHeight: 48,
    letterSpacing: -0.5,
  },
  h1: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 24,
    lineHeight: 32,
  },
  h2: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 20,
    lineHeight: 28,
  },
  h3: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 18,
    lineHeight: 26,
  },
  body: {
    fontFamily: 'HankenGrotesk_400Regular',
    fontSize: 16,
    lineHeight: 24,
  },
  bodyMedium: {
    fontFamily: 'HankenGrotesk_500Medium',
    fontSize: 16,
    lineHeight: 24,
  },
  label: {
    fontFamily: 'HankenGrotesk_500Medium',
    fontSize: 14,
    lineHeight: 20,
  },
  labelSmall: {
    fontFamily: 'HankenGrotesk_600SemiBold',
    fontSize: 12,
    lineHeight: 16,
  },
  caption: {
    fontFamily: 'HankenGrotesk_400Regular',
    fontSize: 12,
    lineHeight: 16,
  },
};
