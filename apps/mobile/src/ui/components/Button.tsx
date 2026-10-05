import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, fonts, layout, roleTokens, spacing, typeScale, type UserRole } from '../theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'accent';

export type ButtonProps = {
  label: string;
  role: UserRole;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  selected?: boolean;
  loadingLabel?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  label,
  role,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  selected = false,
  loadingLabel = 'Memuat…',
  accessibilityLabel,
  accessibilityHint,
  style,
}: ButtonProps) {
  const unavailable = disabled || loading || !onPress;
  const buttonColors = roleTokens[role];
  const backgroundColor = disabled
    ? colors.gold
    : variant === 'secondary'
      ? colors.white
      : variant === 'accent'
        ? buttonColors.accent
        : buttonColors.primary;
  const foregroundColor = disabled
    ? colors.brown
    : variant === 'secondary'
      ? colors.brown
      : variant === 'accent'
        ? role === 'farmer' ? colors.dark : colors.brown
        : colors.white;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (loading ? loadingLabel : label)}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: unavailable, busy: loading, selected }}
      android_ripple={{ color: 'rgba(58, 23, 13, 0.12)' }}
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: roleTokens[role].buttonMinHeight,
          backgroundColor,
          borderColor: selected ? colors.gold : variant === 'secondary' ? colors.brown : backgroundColor,
          borderWidth: variant === 'secondary' ? 1 : selected ? 2 : 0,
          opacity: pressed && !unavailable ? 0.88 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={foregroundColor} />
      ) : null}
      <Text
        allowFontScaling
        style={[styles.label, { color: foregroundColor }]}
      >
        {loading ? loadingLabel : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'stretch',
    minWidth: layout.minimumTouchTarget,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    overflow: 'hidden',
  },
  label: {
    fontFamily: fonts.semiBold,
    fontSize: typeScale.body,
    lineHeight: 20,
    textAlign: 'center',
    flexShrink: 1,
  },
});
