import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { colors, fonts, radii, spacing, typeScale, type UserRole } from '../theme/tokens';

export type FeedbackTone = 'info' | 'success' | 'error';

export type InlineFeedbackProps = {
  message: string;
  tone?: FeedbackTone;
  style?: StyleProp<ViewStyle>;
};

export function InlineFeedback({ message, tone = 'info', style }: InlineFeedbackProps) {
  const accentColor = tone === 'error' ? colors.orange : tone === 'success' ? colors.brown : colors.gold;
  const iconName: IconName = tone === 'error' ? 'triangle-alert' : tone === 'success' ? 'circle-check' : 'info';

  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={message}
      accessibilityLiveRegion="polite"
      style={[styles.feedback, { borderLeftColor: accentColor }, style]}
    >
      <Icon name={iconName} size={18} color={accentColor} />
      <Text style={styles.feedbackText}>{message}</Text>
    </View>
  );
}

export type LoadingStateProps = {
  label?: string;
  style?: StyleProp<ViewStyle>;
};

export function LoadingState({ label = 'Memuat…', style }: LoadingStateProps) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} style={[styles.state, style]}>
      <ActivityIndicator color={colors.brown} />
      <Text style={styles.stateText}>{label}</Text>
    </View>
  );
}

export type EmptyStateProps = {
  title: string;
  description: string;
  role?: UserRole;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function EmptyState({ title, description, role, actionLabel, onAction, style }: EmptyStateProps) {
  return (
    <View style={[styles.empty, style]}>
      <Text accessibilityRole="header" style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.stateText}>{description}</Text>
      {actionLabel && onAction && role ? (
        <Button
          label={actionLabel}
          role={role}
          onPress={onAction}
          style={styles.emptyAction}
        />
      ) : null}
    </View>
  );
}

export type ErrorStateProps = {
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
  role?: UserRole;
  style?: StyleProp<ViewStyle>;
};

export function ErrorState({ message, retryLabel = 'Coba lagi', onRetry, role, style }: ErrorStateProps) {
  return (
    <View style={[styles.errorState, style]}>
      <InlineFeedback message={message} tone="error" />
      {onRetry && role ? (
        <Button label={retryLabel} role={role} variant="secondary" onPress={onRetry} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  feedback: {
    minHeight: 44,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderLeftWidth: 4,
    borderRadius: radii.button,
    backgroundColor: colors.white,
  },
  feedbackText: {
    color: colors.dark,
    fontFamily: fonts.medium,
    fontSize: typeScale.body,
    lineHeight: 21,
    flexShrink: 1,
  },
  state: {
    alignSelf: 'stretch',
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing[2],
    padding: spacing[4],
  },
  stateText: {
    color: colors.dark,
    fontFamily: fonts.regular,
    fontSize: typeScale.body,
    lineHeight: 21,
    flexShrink: 1,
  },
  empty: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[6],
  },
  emptyTitle: {
    color: colors.brown,
    fontFamily: fonts.semiBold,
    fontSize: typeScale.section,
    lineHeight: 26,
    textAlign: 'center',
    flexShrink: 1,
  },
  emptyAction: {
    alignSelf: 'center',
    minWidth: 160,
  },
  errorState: {
    alignSelf: 'stretch',
    gap: spacing[3],
  },
});
