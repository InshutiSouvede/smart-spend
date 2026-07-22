import React from 'react';
import {
  View,
  ActivityIndicator,
  Text,
  StyleSheet,
  Modal,
} from 'react-native';
import { colors, fonts, radius, spacing } from '../theme';

interface Props {
  visible: boolean;
  message?: string;
}

export function LoadingOverlay({ visible, message = 'Loading…' }: Props) {
  return (
    <Modal transparent animationType="fade" visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.text}>{message}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,17,17,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  box: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.xxl,
    paddingHorizontal: 36,
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    // Subtle floating shadow
    shadowColor: '#111111',
    shadowOpacity: 0.04,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  text: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
});
