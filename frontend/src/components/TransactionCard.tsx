import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '../theme';
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
  const pd = purchaseDetails[0] ?? null;
  const itemName = pd?.item_name || null;
  const category = pd?.final_category ?? pd?.predicted_category ?? null;
  const confidence = pd?.category_confidence;

  const canFix = !isIncome && pd != null && onCategoryFix != null;

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
      {/* Direction indicator — small colored bar */}
      <View style={[styles.indicator, { backgroundColor: isIncome ? colors.income : colors.expense }]} />
      <View style={styles.body}>
        <Text style={styles.label} numberOfLines={1}>
          {merchantLabel}
        </Text>
        <View style={styles.metaRow}>
          {!isIncome && itemName && (
            <View style={styles.itemBadge}>
              <Text style={styles.itemText} numberOfLines={1}>{itemName}</Text>
            </View>
          )}
          {!isIncome && category && (
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText} numberOfLines={1}>{category}</Text>
            </View>
          )}
          {!isIncome && confidence != null && (
            <Text style={styles.meta}>{Math.round(confidence * 100)}%</Text>
          )}
          <Text style={styles.meta}>{formatDate(tx.transaction_time)}</Text>
        </View>
      </View>
      <View style={styles.right}>
        <Text style={[styles.amount, { color: isIncome ? colors.income : colors.expense }]}>
          {isIncome ? '+' : '−'}{formatRWF(tx.amount_rwf)}
        </Text>
        {canFix && (
          <TouchableOpacity
            onPress={() => onCategoryFix!(pd!.id, category || 'Expense')}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={styles.fixBtn}
          >
            <Ionicons name="create-outline" size={12} color={colors.textSecondary} />
            <Text style={styles.fixText}>Edit</Text>
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
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  indicator: {
    width: 3,
    height: 36,
    borderRadius: 2,
    flexShrink: 0,
  },
  body: {
    flex: 1,
  },
  label: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
    marginBottom: 3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    flexWrap: 'wrap',
  },
  itemBadge: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radius.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
    maxWidth: 110,
  },
  itemText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    color: colors.textSecondary,
  },
  categoryBadge: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
    maxWidth: 110,
  },
  categoryText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    color: colors.textSecondary,
  },
  meta: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textMuted,
  },
  right: {
    alignItems: 'flex-end',
    gap: 4,
  },
  amount: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 14,
    lineHeight: 20,
  },
  fixBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fixText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.textMuted,
  },
});

