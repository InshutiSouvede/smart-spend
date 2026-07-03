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
import { colors, spacing, radius } from '../theme';
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
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
      <TouchableOpacity style={styles.header} onPress={toggleExpand} activeOpacity={0.7}>
        <View style={styles.iconCircle}>
          <Ionicons name="help-circle-outline" size={24} color={colors.warning} />
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.amount}>{Math.round(tx.amount_rwf).toLocaleString()} RWF</Text>
          <Text style={styles.merchant}>{tx.to_who || 'Unknown merchant'}</Text>
          <Text style={styles.date}>{formatDate(tx.transaction_time)}</Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.textMuted}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.expandedContent}>
          <View style={styles.divider} />

          {/* Merchant Name */}
          <Text style={styles.label}>
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

          {/* Items */}
          <View style={styles.itemsHeader}>
            <Text style={styles.sectionTitle}>Items Purchased</Text>
            <TouchableOpacity onPress={addItem} style={styles.addButton} disabled={loading}>
              <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
              <Text style={styles.addButtonText}>Add</Text>
            </TouchableOpacity>
          </View>

          {items.map((item, index) => (
            <View key={item.id} style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemNumber}>Item {index + 1}</Text>
                {items.length > 1 && (
                  <TouchableOpacity onPress={() => removeItem(item.id)} disabled={loading}>
                    <Ionicons name="trash-outline" size={16} color={colors.expense} />
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

          {/* Summary */}
          {Math.abs(totalAmount - tx.amount_rwf) > 0.01 && totalAmount > 0 && (
            <View style={styles.warningBox}>
              <Ionicons name="warning-outline" size={16} color={colors.warning} />
              <Text style={styles.warningText}>
                Totals don't match. Difference: {Math.abs(totalAmount - tx.amount_rwf).toLocaleString()} RWF
              </Text>
            </View>
          )}

          {/* Submit Button */}
          <TouchableOpacity
            style={[styles.submitButton, loading && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
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
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fffbeb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerInfo: {
    flex: 1,
  },
  amount: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  merchant: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  date: {
    fontSize: 12,
    color: colors.textMuted,
  },
  expandedContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  required: {
    color: colors.expense,
  },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  itemsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addButtonText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  itemCard: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  itemNumber: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  halfInput: {
    flex: 1,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#fffbeb',
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    color: colors.warning,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    marginTop: spacing.xs,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
});
