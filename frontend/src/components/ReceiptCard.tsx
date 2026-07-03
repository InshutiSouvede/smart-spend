import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import type { ReceiptSummary } from '../types/api';

interface Props {
  receipt: ReceiptSummary;
  onPress?: () => void;
}

function formatRWF(amount?: number | null): string {
  if (amount == null) return '—';
  return `${Math.round(amount).toLocaleString()} RWF`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ReceiptCard({ receipt, onPress }: Props) {
  const matched = receipt.match_status === 'matched' || receipt.match_status === 'auto_matched' || receipt.match_status === 'user_confirmed';
  
  // Use receipt timestamp if available, otherwise uploaded_at
  const displayDate = receipt.receipt_timestamp 
    ? formatDateTime(receipt.receipt_timestamp) 
    : formatDate(receipt.uploaded_at);
  
  // Create a unique merchant display name
  const merchantDisplay = receipt.merchant_name || 'Unknown Merchant';
  const dateLabel = receipt.receipt_timestamp ? 'Purchase' : 'Uploaded';

  const content = (
    <>
      <View style={styles.iconBox}>
        <Ionicons name="receipt-outline" size={22} color={colors.primary} />
      </View>
      <View style={styles.body}>
        <Text style={styles.merchant} numberOfLines={1}>
          {merchantDisplay}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {dateLabel}: {displayDate}
        </Text>
        {receipt.item_count > 0 && (
          <Text style={styles.itemCount}>
            {receipt.item_count} item{receipt.item_count !== 1 ? 's' : ''}
          </Text>
        )}
      </View>
      <View style={styles.right}>
        <Text style={styles.amount}>{formatRWF(receipt.total_amount_rwf)}</Text>
        <View style={[styles.badge, matched ? styles.badgeMatched : styles.badgeUnmatched]}>
          <Text style={[styles.badgeText, matched ? styles.badgeTextMatched : styles.badgeTextUnmatched]}>
            {matched ? 'Matched' : 'Unmatched'}
          </Text>
        </View>
      </View>
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return <View style={styles.card}>{content}</View>;
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  body: {
    flex: 1,
  },
  merchant: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  meta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  itemCount: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  right: {
    alignItems: 'flex-end',
    gap: 4,
  },
  amount: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  badgeMatched: { backgroundColor: colors.successLight },
  badgeUnmatched: { backgroundColor: colors.divider },
  badgeText: { fontSize: 11, fontWeight: '600' },
  badgeTextMatched: { color: colors.success },
  badgeTextUnmatched: { color: colors.textMuted },
});
