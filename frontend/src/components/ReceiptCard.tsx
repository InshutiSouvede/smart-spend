import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '../theme';
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
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function ReceiptCard({ receipt, onPress }: Props) {
  const matched =
    receipt.match_status === 'matched' ||
    receipt.match_status === 'auto_matched' ||
    receipt.match_status === 'user_confirmed';

  const displayDate = receipt.receipt_timestamp
    ? formatDateTime(receipt.receipt_timestamp)
    : formatDate(receipt.uploaded_at);

  const merchantDisplay = receipt.merchant_name || 'Unknown Merchant';
  const dateLabel = receipt.receipt_timestamp ? 'Receipt' : 'Uploaded';

  const showLowQualityWarning =
    (receipt.ocr_confidence != null && receipt.ocr_confidence < 0.5) ||
    receipt.extraction_status === 'no_items' ||
    receipt.extraction_status === 'failed';

  const content = (
    <>
      <View style={styles.iconBox}>
        <Ionicons name="receipt-outline" size={20} color={colors.textSecondary} />
      </View>
      <View style={styles.body}>
        <View style={styles.merchantRow}>
          <Text style={styles.merchant} numberOfLines={1}>{merchantDisplay}</Text>
          {showLowQualityWarning && (
            <Ionicons name="warning-outline" size={13} color={colors.warning} style={{ marginLeft: 4 }} />
          )}
        </View>
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
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.xs,
    backgroundColor: colors.surfaceContainer,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  body: {
    flex: 1,
  },
  merchantRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  merchant: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
    flex: 1,
  },
  meta: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
    marginTop: 2,
  },
  itemCount: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  right: {
    alignItems: 'flex-end',
    gap: 5,
  },
  amount: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  badge: {
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeMatched: {
    backgroundColor: colors.incomeLight,
  },
  badgeUnmatched: {
    backgroundColor: colors.surfaceContainer,
  },
  badgeText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
  },
  badgeTextMatched: {
    color: colors.income,
  },
  badgeTextUnmatched: {
    color: colors.textMuted,
  },
});
