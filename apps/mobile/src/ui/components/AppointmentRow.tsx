import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { StatusBadge, type StatusTone } from './StatusBadge';
import { colors, fonts, roleTokens, spacing, typeScale, type UserRole } from '../theme/tokens';

export type AppointmentRowProps = {
  title: string;
  description: string;
  dateLabel?: string;
  statusLabel?: string;
  statusTone?: StatusTone;
  role: UserRole;
  leading?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function AppointmentRow({
  title,
  description,
  dateLabel,
  statusLabel,
  statusTone = 'default',
  role,
  leading,
  onPress,
  accessibilityLabel,
  style,
}: AppointmentRowProps) {
  const accessibleSummary = accessibilityLabel ??
    [title, description, dateLabel, statusLabel].filter(Boolean).join('. ');
  const content = (
    <View style={styles.row}>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.textContent}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        {dateLabel ? <Text style={styles.date}>{dateLabel}</Text> : null}
        {statusLabel ? (
          <StatusBadge label={statusLabel} role={role} tone={statusTone} style={styles.status} />
        ) : null}
      </View>
    </View>
  );

  if (!onPress) {
    return <View style={[styles.card, { borderRadius: roleTokens[role].cardRadius }, style]}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibleSummary}
      accessibilityHint="Buka detail layanan"
      accessibilityState={{ disabled: false }}
      android_ripple={{ color: 'rgba(58, 23, 13, 0.08)' }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { borderRadius: roleTokens[role].cardRadius, opacity: pressed ? 0.9 : 1 },
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    minHeight: 72,
    padding: spacing[4],
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
  },
  leading: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContent: {
    flex: 1,
    minWidth: 0,
    gap: spacing[1],
  },
  title: {
    color: colors.dark,
    fontFamily: fonts.semiBold,
    fontSize: typeScale.body,
    lineHeight: 20,
    flexShrink: 1,
  },
  description: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: typeScale.small,
    lineHeight: 18,
    flexShrink: 1,
  },
  date: {
    color: colors.dark,
    fontFamily: fonts.medium,
    fontSize: typeScale.small,
    lineHeight: 18,
    flexShrink: 1,
  },
  status: {
    marginTop: spacing[1],
  },
});
