import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../theme/tokens';

/** Plays a media file only after the owning repository has downloaded it to private app storage. */
export function PrivateVideoPlayer({ uri, label, style }: { uri: string; label: string; style?: StyleProp<ViewStyle> }) {
  const player = useVideoPlayer(uri, (instance) => { instance.loop = false; });
  return <View accessibilityLabel={label} style={[styles.frame, style]}>
    <VideoView
      player={player}
      style={styles.video}
      contentFit="contain"
      nativeControls
      fullscreenOptions={{ enable: true }}
    />
  </View>;
}

const styles = StyleSheet.create({
  frame: { width: '100%', minHeight: 200, overflow: 'hidden', borderRadius: 12, backgroundColor: colors.dark },
  video: { width: '100%', height: 220 },
});
