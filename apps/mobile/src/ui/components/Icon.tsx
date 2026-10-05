import Lucide, { type LucideIconName } from '@react-native-vector-icons/lucide';
import type { ColorValue, StyleProp, TextStyle } from 'react-native';
import { colors } from '../theme/tokens';

export type IconName = LucideIconName;

export type IconProps = {
  name: IconName;
  size?: number;
  color?: ColorValue;
  accessibilityLabel?: string;
  style?: StyleProp<TextStyle>;
};

export function Icon({
  name,
  size = 24,
  color = colors.brown,
  accessibilityLabel,
  style,
}: IconProps) {
  return (
    <Lucide
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      allowFontScaling={false}
      color={color}
      name={name}
      size={size}
      style={style}
    />
  );
}
