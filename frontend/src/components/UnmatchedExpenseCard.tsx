import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { colors, spacing, radius, fonts } from '../theme';
import type { SMSTransactionOut } from '../types/api';
import { transactionsApi } from '../api/transactions';
import { getErrorMessage } from '../api/client';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface ItemEntry {
  id: string;
  item_name: string;
  quantity: string;
  unit_cost_rwf: string;
  total_cost_rwf: string;
}

interface Props {
  tx: SMSTransactionOut;
}

function formatDate(iso?: string | null): string {
  if (!iso) return 'Unknown date';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function UnmatchedExpenseCard({ tx }: Props) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [merchantName, setMerchantName] = useState(tx.to_who || '');
  const [items, setItems] = useState<ItemEntry[]>([
    { id: '1', item_name: '', quantity: '1', unit_cost_rwf: '', total_cost_rwf: tx.amount_rwf.toString() },
  ]);
  const [loading, setLoading] = useState(false);

  const toggleExpand = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(!expanded);
  };

  const addItem = () => {
    setItems([
      ...items,
      { id: Date.now().toString(), item_name: '', quantity: '1', unit_cost_rwf: '', total_cost_rwf: '' },
    ]);
  };

  const removeItem = (id: string) => {
    if (items.length === 1) {
      Alert.alert('Cannot remove', 'At least one item is required.');
      return;
    }
    setItems(items.filter((item) => item.id !== id));
  };

  const updateItem = (id: string, field: keyof ItemEntry, value: string) => {
    setItems(items.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  };

  const handleSubmit = async () => {
    if (!merchantName.trim()) {
      Alert.alert('Validation Error', 'Please enter a merchant name.');
      return;
    }
    const validItems = items.filter((item) => item.item_name.trim() !== '');
    if (validItems.length === 0) {
      Alert.alert('Validation Error', 'Please enter at least one item name.');
      return;
    }
    for (const item of validItems) {
      if (!item.total_cost_rwf || parseFloat(item.total_cost_rwf) <= 0) {
        Alert.alert('Validation Error', 'Please enter a valid total cost for all items.');
        return;
      }
    }
    setLoading(true);
    try {
      await transactionsApi.submitItemDetails(tx.id, {
        merchant_name: merchantName.trim(),
        items: validItems.map((item) => ({
          item_name: item.item_name.trim(),
          quantity: parseFloat(item.quantity) || 1,
          unit_cost_rwf: item.unit_cost_rwf ? parseFloat(item.unit_cost_rwf) : undefined,
          total_cost_rwf: parseFloat(item.total_cost_rwf),
        })),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['transactions', 'unmatched'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['analytics'] }),
      ]);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setExpanded(false);
    } catch (error) {
      Alert.alert('Error', getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const totalAmount = items.reduce((sum, item) => {
    const cost = parseFloat(item.total_cost_rwf) || 0;
    return sum + cost;
  }, 0);

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.headerRow} onPress={toggleExpand} activeOpacity={0.7}>
        <View style={styles.iconCircle}>
          <Ionicons name="help-circle-outline" size={22} color={colors.warning} />
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.amount}>{Math.round(tx.amount_rwf).toLocaleString()} RWF</Text>
          <Text style={styles.merchant} numberOfLines={1}>{tx.to_who || 'Unknown merchant'}</Text>
          <Text style={styles.date}>{formatDate(tx.transaction_time)}</Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textMuted}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.form}>
          <View style={styles.divider} />

          <Text style={styles.fieldLabel}>
            Merchant / Store Name <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={merchantName}
            onChangeText={setMerchantName}
            placeholder="e.g., Bourbon Coffee"
            placeholderTextColor={colors.textMuted}
            editable={!loading}
          />

          <View style={styles.itemsHeader}>
            <Text style={styles.sectionTitle}>Items Purchased</Text>
            <TouchableOpacity onPress={addItem} style={styles.addButton} disabled={loading}>
              <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
              <Text style={styles.addButtonText}>Add item</Text>
            </TouchableOpacity>
          </View>

          {items.map((item, index) => (
            <View key={item.id} style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemNumber}>Item {index + 1}</Text>
                {items.length > 1 && (
                  <TouchableOpacity onPress={() => removeItem(item.id)} disabled={loading}>
                    <Ionicons name="trash-outline" size={14} color={colors.expense} />
                  </TouchableOpacity>
                )}
              </View>
              <TextInput
                style={styles.input}
                value={item.item_name}
                onChangeText={(text) => updateItem(item.id, 'item_name', text)}
                placeholder="Item name *"
                placeholderTextColor={colors.textMuted}
                editable={!loading}
              />
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, styles.halfInput]}
                  value={item.quantity}
                  onChangeText={(text) => updateItem(item.id, 'quantity', text)}
                  placeholder="Qty"
                  keyboardType="numeric"
                  placeholderTextColor={colors.textMuted}
                  editable={!loading}
                />
                <TextInput
                  style={[styles.input, styles.halfInput]}
                  value={item.total_cost_rwf}
                  onChangeText={(text) => updateItem(item.id, 'total_cost_rwf', text)}
                  placeholder="Total cost *"
                  keyboardType="numeric"
                  placeholderTextColor={colors.textMuted}
                  editable={!loading}
                />
              </View>
            </View>
          ))}

          {Math.abs(totalAmount - tx.amount_rwf) > 0.01 && totalAmount > 0 && (
            <View style={styles.warningBox}>
              <Ionicons name="warning-outline" size={14} color={colors.warning} />
              <Text style={styles.warningText}>
                Totals don't match. Difference: {Math.abs(totalAmount - tx.amount_rwf).toLocaleString()} RWF
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.submitButton, loading && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.textPrimary} />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={16} color={colors.textPrimary} />
                <Text style={styles.submitButtonText}>Save Details</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
    minHeight: 64,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.warningLight,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  headerInfo: {
    flex: 1,
  },
  amount: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.textPrimary,
    marginBottom: 1,
  },
  merchant: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    marginBottom: 1,
  },
  date: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textMuted,
  },
  form: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.textPrimary,
    marginBottom: spacing.xxs,
  },
  required: {
    color: colors.expense,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    minHeight: 44,
  },
  itemsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  addButtonText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.primary,
  },
  itemCard: {
    backgroundColor: colors.surfaceLow,
    borderRadius: radius.xs,
    padding: spacing.xs,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xxs,
  },
  itemNumber: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.textMuted,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  halfInput: {
    flex: 1,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    backgroundColor: colors.warningLight,
    borderRadius: radius.xs,
    padding: spacing.xs,
    marginBottom: spacing.xs,
  },
  warningText: {
    fontFamily: fonts.bodyRegular,
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    backgroundColor: colors.primary,
    borderRadius: radius.xs,
    paddingVertical: 12,
    marginTop: spacing.xxs,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
});
