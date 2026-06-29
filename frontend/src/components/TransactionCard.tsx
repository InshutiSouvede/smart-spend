import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import type { SMSTransactionOut } from '../types/api';

interface Props {
  tx: SMSTransactionOut;
  onCategoryFix?: (purchaseDetailId: number, currentCategory: string) => void;
}

function formatRWF(amount: number): string {
  return `${Math.round(amount).toLocaleString()} RWF`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function TransactionCard({ tx, onCategoryFix }: Props) {
  const isIncome = tx.transaction_type === 'income';
  const label = isIncome ? tx.from_who ?? 'Income' : tx.to_who ?? 'Payment';
  const pd = tx.purchase_details?.[0] ?? null;
  const category =
    pd?.final_category ??
    pd?.predicted_category ??
    (isIncome ? 'Income' : 'Expense');
  const confidence = pd?.category_confidence;

  const canFix = !isIncome && pd != null && onCategoryFix != null;

  return (
    <View style={styles.card}>
      <View style={[styles.dot, { backgroundColor: isIncome ? colors.income : colors.expense }]} />
      <View style={styles.body}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>
            {category}
            {confidence != null ? ` · ${Math.round(confidence * 100)}%` : ''}
          </Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.meta}>{formatDate(tx.transaction_time)}</Text>
        </View>
      </View>
      <View style={styles.right}>
        <Text style={[styles.amount, { color: isIncome ? colors.income : colors.expense }]}>
          {isIncome ? '+' : '-'}
          {formatRWF(tx.amount_rwf)}
        </Text>
        {canFix && (
          <TouchableOpacity
            onPress={() => onCategoryFix!(pd!.id, category)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={styles.fixBtn}
          >
            <Ionicons name="create-outline" size={14} color={colors.primary} />
            <Text style={styles.fixText}>Fix</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  body: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  meta: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  metaDot: {
    fontSize: 12,
    color: colors.textMuted,
  },
  right: {
    alignItems: 'flex-end',
    gap: 4,
  },
  amount: {
    fontSize: 14,
    fontWeight: '700',
  },
  fixBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  fixText: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '600',
  },
});

