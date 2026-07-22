import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '../theme';

interface Props {
  message: string;
  onRetry?: () => void;
}

export function ErrorBanner({ message, onRetry }: Props) {
  return (
    <View style={styles.container}>
      <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
      <Text style={styles.text}>{message}</Text>
      {onRetry && (
        <TouchableOpacity onPress={onRetry} style={styles.retry}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.errorLight,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: '#F0CACA',
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  text: {
    flex: 1,
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.error,
  },
  retry: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: colors.error,
  },
  retryText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.error,
  },
});
