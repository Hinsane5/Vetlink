import { Modal, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Button } from './Button';
import { colors, fonts, radii, spacing, typeScale, type UserRole } from '../theme/tokens';

export type ConfirmationDialogProps = {
  visible: boolean;
  title: string;
  message: string;
  role: UserRole;
  confirmLabel: string;
  onConfirm: () => void;
  cancelLabel?: string;
  onCancel: () => void;
  loading?: boolean;
  confirmDisabled?: boolean;
  destructive?: boolean;
  dismissOnBackdrop?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function ConfirmationDialog({
  visible,
  title,
  message,
  role,
  confirmLabel,
  onConfirm,
  cancelLabel = 'Batal',
  onCancel,
  loading = false,
  confirmDisabled = false,
  destructive = false,
  dismissOnBackdrop = false,
  style,
}: ConfirmationDialogProps) {
  const close = () => {
    if (!loading) onCancel();
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={close}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={dismissOnBackdrop ? close : undefined}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[styles.dialog, style]}
        >
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.messageScroll}
          >
            <Text style={styles.message}>{message}</Text>
          </ScrollView>
          <View style={styles.actions}>
            <Button
              label={cancelLabel}
              role={role}
              variant="secondary"
              disabled={loading}
              onPress={close}
              style={styles.actionButton}
            />
            <Button
              label={confirmLabel}
              role={role}
              variant={destructive ? 'accent' : 'primary'}
              disabled={confirmDisabled}
              loading={loading}
              onPress={onConfirm}
              style={styles.actionButton}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing[5],
    backgroundColor: 'rgba(58, 23, 13, 0.48)',
  },
  dialog: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 350,
    maxHeight: '85%',
    padding: spacing[5],
    gap: spacing[4],
    borderRadius: radii.cardVet,
    backgroundColor: colors.white,
  },
  title: {
    color: colors.brown,
    fontFamily: fonts.bold,
    fontSize: typeScale.heading,
    lineHeight: 29,
    flexShrink: 1,
  },
  messageScroll: {
    flexShrink: 1,
  },
  message: {
    color: colors.dark,
    fontFamily: fonts.regular,
    fontSize: typeScale.body,
    lineHeight: 21,
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing[2],
  },
  actionButton: {
    flex: 1,
    minWidth: 0,
  },
});
