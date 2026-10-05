import { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { colors, fonts, radii, spacing, typeScale } from '../theme/tokens';

export type TextFieldProps = Omit<
  TextInputProps,
  'style' | 'editable' | 'multiline' | 'onFocus' | 'onBlur' | 'accessibilityLabel' | 'accessibilityHint'
> & {
  label: string;
  helperText?: string;
  errorText?: string;
  readOnly?: boolean;
  editable?: boolean;
  multiline?: boolean;
  inputStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  onFocus?: TextInputProps['onFocus'];
  onBlur?: TextInputProps['onBlur'];
};

export function TextField({
  label,
  helperText,
  errorText,
  readOnly = false,
  editable = true,
  multiline = false,
  inputStyle,
  containerStyle,
  accessibilityLabel,
  accessibilityHint,
  onFocus,
  onBlur,
  ...inputProps
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const canEdit = editable && !readOnly;
  const hint = [accessibilityHint, helperText, errorText].filter(Boolean).join('. ');

  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.label}>{label}</Text>
      <View
        style={[
          styles.inputFrame,
          multiline && styles.multilineFrame,
          { borderColor: focused && canEdit ? colors.brown : colors.gold },
          !canEdit && styles.readOnlyFrame,
        ]}
      >
        <TextInput
          {...inputProps}
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityHint={hint || undefined}
          accessibilityState={{ disabled: !canEdit }}
          accessibilityLiveRegion={errorText ? 'polite' : 'none'}
          allowFontScaling
          editable={canEdit}
          multiline={multiline}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          placeholderTextColor={colors.muted}
          style={[styles.input, multiline && styles.multilineInput, inputStyle]}
          textAlignVertical={multiline ? 'top' : 'center'}
        />
      </View>
      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
      {!errorText && helperText ? <Text style={styles.helper}>{helperText}</Text> : null}
    </View>
  );
}

export function TextArea(props: Omit<TextFieldProps, 'multiline'>) {
  return <TextField {...props} multiline />;
}

const styles = StyleSheet.create({
  field: {
    alignSelf: 'stretch',
    minHeight: 104,
    gap: 6,
  },
  label: {
    color: colors.brown,
    fontFamily: fonts.semiBold,
    fontSize: typeScale.label,
    lineHeight: 19,
    flexShrink: 1,
  },
  inputFrame: {
    minHeight: 74,
    paddingHorizontal: 14,
    paddingVertical: spacing[3],
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: radii.button,
    backgroundColor: colors.white,
    justifyContent: 'center',
  },
  multilineFrame: {
    minHeight: 120,
    justifyContent: 'flex-start',
  },
  readOnlyFrame: {
    backgroundColor: colors.white,
  },
  input: {
    minHeight: 44,
    padding: 0,
    color: colors.dark,
    fontFamily: fonts.regular,
    fontSize: typeScale.body,
    lineHeight: 20,
    flexShrink: 1,
  },
  multilineInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  helper: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: typeScale.small,
    lineHeight: 18,
    flexShrink: 1,
  },
  error: {
    color: colors.orange,
    fontFamily: fonts.medium,
    fontSize: typeScale.small,
    lineHeight: 18,
    flexShrink: 1,
  },
});
