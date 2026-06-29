import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme';
import type { SMSTransactionOut } from '../types/api';

interface Props {
  tx: SMSTransactionOut;
}

function formatRWF(amount: number): string {
  return `${Math.round(amount).toLocaleString()} RWF`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function TransactionCard({ tx }: Props) {
  const isIncome = tx.transaction_type === 'income';
  const label = isIncome ? tx.from_who ?? 'Income' : tx.to_who ?? 'Payment';
  const category =
    tx.purchase_details?.[0]?.final_category ??
    tx.purchase_details?.[0]?.category ??
    (isIncome ? 'Income' : 'Expense');

  return (
    <View style={styles.card}>
      <View style={[styles.dot, { backgroundColor: isIncome ? colors.income : colors.expense }]} />
      <View style={styles.body}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.meta}>
          {category} · {formatDate(tx.transaction_time)}
        </Text>
      </View>
      <Text style={[styles.amount, { color: isIncome ? colors.income : colors.expense }]}>
        {isIncome ? '+' : '-'}
        {formatRWF(tx.amount_rwf)}
      </Text>
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
  meta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  amount: {
    fontSize: 14,
    fontWeight: '700',
  },
});
