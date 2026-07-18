import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import type { SMSTransactionOut } from '../types/api';

interface Props {
  tx: SMSTransactionOut;
  onCategoryFix?: (purchaseDetailId: number, currentCategory: string) => void;
  onPress?: (tx: SMSTransactionOut) => void;
  highlight?: boolean;
}

function formatRWF(amount: number): string {
  return `${Math.round(amount).toLocaleString()} RWF`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function TransactionCard({ tx, onCategoryFix, onPress, highlight }: Props) {
  const isIncome = tx.transaction_type === 'income';
  const merchantLabel = isIncome ? tx.from_who ?? 'Income' : tx.to_who ?? 'Payment';
  const purchaseDetails = tx.purchase_details ?? [];
  const hasDetails = purchaseDetails.length > 0;
  
  // Get first item for display
  const pd = purchaseDetails[0] ?? null;
  const itemName = pd?.item_name || null;
  const category = pd?.final_category ?? pd?.predicted_category ?? null;
  const confidence = pd?.category_confidence;

  const canFix = !isIncome && pd != null && onCategoryFix != null;

  // Highlight animation
  const highlightAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (highlight) {
      highlightAnim.setValue(1);
      Animated.timing(highlightAnim, {
        toValue: 0,
        duration: 1200,
        useNativeDriver: false,
      }).start();
    }
  }, [highlight]);

  const cardBg = highlightAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.surface, colors.primaryLight],
  });

  const cardContent = (
    <Animated.View style={[styles.card, { backgroundColor: cardBg }]}>
      <View style={[styles.dot, { backgroundColor: isIncome ? colors.income : colors.expense }]} />
      <View style={styles.body}>
        <Text style={styles.label} numberOfLines={1}>
          {merchantLabel}
        </Text>
        <View style={styles.metaRow}>
          {/* Item Name Tag - only for expenses */}
          {!isIncome && (
            <View style={styles.itemBadge}>
              <Text style={styles.itemText} numberOfLines={1}>
                {itemName || 'Unknown'}
              </Text>
            </View>
          )}
          {/* Category Tag - only for expenses */}
          {!isIncome && (
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText} numberOfLines={1}>
                {category || 'Unknown'}
              </Text>
            </View>
          )}
          {!isIncome && confidence != null && (
            <>
              <Text style={styles.metaDot}>·</Text>
              <Text style={styles.meta}>{Math.round(confidence * 100)}%</Text>
            </>
          )}
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
            onPress={() => onCategoryFix!(pd!.id, category || 'Expense')}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={styles.fixBtn}
          >
            <Ionicons name="create-outline" size={14} color={colors.primary} />
            <Text style={styles.fixText}>Fix</Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );

  if (onPress && !isIncome) {
    return (
      <Pressable onPress={() => onPress(tx)}>
        {cardContent}
      </Pressable>
    );
  }

  return cardContent;
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface, // default, overridden by animated style when highlighting
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
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  itemBadge: {
    backgroundColor: '#e3f2fd',
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 120,
  },
  itemText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1565c0',
  },
  categoryBadge: {
    backgroundColor: '#f3e5f5',
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 120,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6a1b9a',
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

