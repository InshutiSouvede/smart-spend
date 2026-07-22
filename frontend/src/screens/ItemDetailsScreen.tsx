import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';

import { transactionsApi } from '../api/transactions';
import { getErrorMessage } from '../api/client';
import { colors, spacing, radius, fonts } from '../theme';
import type { TransactionsStackParamList } from '../navigation/AppTabs';

type RouteProps = RouteProp<TransactionsStackParamList, 'ItemDetails'>;
type Nav = NativeStackNavigationProp<TransactionsStackParamList, 'ItemDetails'>;

interface ItemEntry {
  id: string;
  item_name: string;
  quantity: string;
  unit_cost_rwf: string;
  total_cost_rwf: string;
}

export function ItemDetailsScreen() {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const { smsTransactionId, amount, merchant } = route.params;

  const [merchantName, setMerchantName] = useState(merchant || '');
  const [items, setItems] = useState<ItemEntry[]>([
    { id: '1', item_name: '', quantity: '1', unit_cost_rwf: '', total_cost_rwf: amount.toString() },
  ]);
  const [loading, setLoading] = useState(false);

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
      await transactionsApi.submitItemDetails(smsTransactionId, {
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
        queryClient.invalidateQueries({ queryKey: ['analytics', 'unmatched-expenses'] }),
        queryClient.invalidateQueries({ queryKey: ['analytics', 'spending-status'] }),
        queryClient.invalidateQueries({ queryKey: ['analytics', 'summary'] }),
      ]);

      Alert.alert('Success', 'Purchase details saved successfully!', [
        { text: 'OK', onPress: () => navigation.popToTop() },
      ]);
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
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Header summary */}
        <View style={styles.headerCard}>
          <Text style={styles.headerLabel}>Transaction amount</Text>
          <Text style={styles.headerAmount}>{amount.toLocaleString()} RWF</Text>
          <Text style={styles.headerHint}>
            Tell us what this expense was for. You can add multiple items.
          </Text>
        </View>

        {/* Merchant */}
        <View style={styles.section}>
          <Text style={styles.fieldLabel}>
            Merchant / Store Name <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={merchantName}
            onChangeText={setMerchantName}
            placeholder="e.g., Bourbon Coffee, Simba Supermarket"
            placeholderTextColor={colors.textMuted}
          />
        </View>

        {/* Items */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Items Purchased</Text>
            <TouchableOpacity style={styles.addButton} onPress={addItem}>
              <Ionicons name="add" size={14} color={colors.textPrimary} />
              <Text style={styles.addButtonText}>Add Item</Text>
            </TouchableOpacity>
          </View>

          {items.map((item, index) => (
            <View key={item.id} style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemNumber}>Item {index + 1}</Text>
                {items.length > 1 && (
                  <TouchableOpacity onPress={() => removeItem(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                  </TouchableOpacity>
                )}
              </View>

              <Text style={styles.inputLabel}>Item Name <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.input}
                value={item.item_name}
                onChangeText={(text) => updateItem(item.id, 'item_name', text)}
                placeholder="e.g., Cappuccino, Bread, T-shirt"
                placeholderTextColor={colors.textMuted}
              />

              <View style={styles.row}>
                <View style={styles.halfInput}>
                  <Text style={styles.inputLabel}>Quantity</Text>
                  <TextInput
                    style={styles.input}
                    value={item.quantity}
                    onChangeText={(text) => updateItem(item.id, 'quantity', text)}
                    placeholder="1"
                    keyboardType="numeric"
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
                <View style={styles.halfInput}>
                  <Text style={styles.inputLabel}>Unit Cost (RWF)</Text>
                  <TextInput
                    style={styles.input}
                    value={item.unit_cost_rwf}
                    onChangeText={(text) => updateItem(item.id, 'unit_cost_rwf', text)}
                    placeholder="Optional"
                    keyboardType="numeric"
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
              </View>

              <Text style={styles.inputLabel}>Total Cost (RWF) <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.input}
                value={item.total_cost_rwf}
                onChangeText={(text) => updateItem(item.id, 'total_cost_rwf', text)}
                placeholder="0"
                keyboardType="numeric"
                placeholderTextColor={colors.textMuted}
              />
            </View>
          ))}
        </View>

        {/* Summary */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Items total</Text>
            <Text style={styles.summaryValue}>{totalAmount.toLocaleString()} RWF</Text>
          </View>
          <View style={[styles.summaryRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.summaryLabel}>Transaction amount</Text>
            <Text style={styles.summaryValue}>{amount.toLocaleString()} RWF</Text>
          </View>
          {Math.abs(totalAmount - amount) > 0.01 && (
            <View style={styles.warningRow}>
              <Ionicons name="warning-outline" size={14} color={colors.warning} />
              <Text style={styles.warningText}>
                Totals don't match — difference: {Math.abs(totalAmount - amount).toLocaleString()} RWF
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[styles.submitButton, loading && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color={colors.textPrimary} />
          ) : (
            <>
              <Ionicons name="checkmark-circle-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.submitButtonText}>Save Purchase Details</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 48 },

  headerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.xl,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xxs,
  },
  headerAmount: {
    fontFamily: fonts.headingBold,
    fontSize: 28,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  headerHint: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },

  section: { marginBottom: spacing.xl },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radius.xs,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    minHeight: 32,
  },
  addButtonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.textPrimary,
  },

  fieldLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  inputLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 4,
    marginTop: spacing.sm,
  },
  required: { color: colors.error },

  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    borderRadius: radius.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontFamily: fonts.bodyRegular,
    fontSize: 15,
    color: colors.textPrimary,
    minHeight: 46,
  },

  row: { flexDirection: 'row', gap: spacing.sm },
  halfInput: { flex: 1 },

  itemCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xxs,
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemNumber: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.xl,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryLabel: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    color: colors.textSecondary,
  },
  summaryValue: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.warningLight,
  },
  warningText: {
    fontFamily: fonts.bodyRegular,
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.xs,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 52,
  },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: {
    fontFamily: fonts.headingSemiBold,
    color: colors.textPrimary,
    fontSize: 16,
  },
});
