export type UserRole = 'farmer' | 'vet';

export const colors = {
  cream: '#F6EDCE',
  brown: '#5C2F27',
  dark: '#3A170D',
  gold: '#DBA75B',
  orange: '#C3883D',
  white: '#FFFFFF',
  muted: '#7B665E',
} as const;

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  12: 48,
} as const;

export const radii = {
  button: 12,
  cardFarmer: 14,
  cardVet: 16,
  pill: 999,
} as const;

export const fonts = {
  regular: 'InterRegular',
  medium: 'InterMedium',
  semiBold: 'InterSemiBold',
  bold: 'InterBold',
} as const;

export const typeScale = {
  caption: 11,
  small: 12,
  label: 13,
  body: 14,
  section: 18,
  heading: 20,
  title: 24,
} as const;

export const roleTokens = {
  farmer: {
    primary: colors.brown,
    accent: colors.orange,
    text: colors.dark,
    muted: colors.muted,
    cardRadius: radii.cardFarmer,
    buttonMinHeight: 52,
    navigationHeight: 70,
    cardGap: 14,
    actionGap: 10,
  },
  vet: {
    primary: colors.brown,
    accent: colors.gold,
    text: colors.dark,
    muted: colors.brown,
    cardRadius: radii.cardVet,
    buttonMinHeight: 48,
    navigationHeight: 80,
    cardGap: 16,
    actionGap: 8,
  },
} as const;

export const layout = {
  contentHorizontal: 20,
  minimumTouchTarget: 44,
  referenceWidth: 390,
  referenceHeight: 844,
} as const;
