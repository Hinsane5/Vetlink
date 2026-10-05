import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, fonts, spacing, typeScale } from '../theme/tokens';

export type ChatBubbleProps = {
  message: string;
  author: string;
  timeLabel: string;
  direction: 'incoming' | 'outgoing';
  deliveryState?: 'sent' | 'pending' | 'failed';
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function ChatBubble({
  message,
  author,
  timeLabel,
  direction,
  deliveryState = 'sent',
  onRetry,
  style,
}: ChatBubbleProps) {
  const outgoing = direction === 'outgoing';
  const foreground = outgoing ? colors.white : colors.dark;
  const metadataColor = outgoing ? colors.cream : colors.brown;
  const retryable = deliveryState !== 'sent' && Boolean(onRetry);
  const deliveryLabel = deliveryState === 'pending'
    ? ' · Menunggu terkirim'
    : deliveryState === 'failed'
      ? ' · Gagal terkirim'
      : '';

  return (
    <View
      accessible={!retryable}
      accessibilityRole="text"
      accessibilityLabel={`${message}. ${author}, ${timeLabel}${deliveryLabel}`}
      accessibilityHint={retryable ? 'Ketuk Coba lagi untuk mengirim pesan ini.' : undefined}
      style={[
        styles.bubble,
        {
          alignSelf: outgoing ? 'flex-end' : 'flex-start',
          backgroundColor: outgoing ? colors.brown : colors.white,
        },
        style,
      ]}
    >
      <Text style={[styles.message, { color: foreground }]}>{message}</Text>
      <View style={styles.metadataRow}>
        <Text style={[styles.metadata, { color: metadataColor }]}>{author} · {timeLabel}{deliveryLabel}</Text>
        {retryable && onRetry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Coba lagi mengirim pesan"
            accessibilityHint="Kirim ulang pesan yang sama pada percakapan ini."
            hitSlop={4}
            onPress={onRetry}
            style={styles.retry}
          >
            <Text style={[styles.retryLabel, { color: metadataColor }]}>Coba lagi</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: '86%',
    minWidth: 80,
    paddingHorizontal: 14,
    paddingVertical: spacing[3],
    borderRadius: 16,
    gap: spacing[2],
  },
  message: {
    fontFamily: fonts.regular,
    fontSize: typeScale.body,
    lineHeight: 20,
    flexShrink: 1,
  },
  metadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  metadata: {
    fontFamily: fonts.medium,
    fontSize: typeScale.caption,
    lineHeight: 16,
    flexShrink: 1,
  },
  retry: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing[2],
  },
  retryLabel: {
    fontFamily: fonts.semiBold,
    fontSize: typeScale.small,
    lineHeight: 18,
    textDecorationLine: 'underline',
  },
});
