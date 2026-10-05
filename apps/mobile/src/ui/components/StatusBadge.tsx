import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, fonts, radii, spacing, typeScale, type UserRole } from '../theme/tokens';
import { Icon, type IconName } from './Icon';

export type StatusTone = 'default' | 'pending' | 'success' | 'error';

export type StatusBadgeProps = {
  label: string;
  role: UserRole;
  tone?: StatusTone;
  style?: StyleProp<ViewStyle>;
};

export function StatusBadge({ label, role, tone = 'default', style }: StatusBadgeProps) {
  const mark: IconName | undefined = tone === 'success'
    ? 'check'
    : tone === 'pending'
      ? 'clock-3'
      : tone === 'error'
        ? 'circle-alert'
        : role === 'vet' ? 'check' : undefined;
  const foreground = role === 'farmer' ? colors.dark : colors.brown;
  const background = role === 'farmer' && tone === 'success' ? colors.gold : colors.cream;

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[styles.badge, { backgroundColor: background }, style]}
    >
      {mark ? <Icon name={mark} size={14} color={foreground} /> : null}
      <Text style={[styles.label, { color: foreground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minHeight: 32,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radii.pill,
  },
  label: {
    fontFamily: fonts.medium,
    fontSize: typeScale.small,
    lineHeight: 18,
    flexShrink: 1,
  },
});
