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
import { colors, spacing, radius, typography } from '../theme';
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
    // Validation
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

      // Invalidate all relevant caches to refresh the data
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
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerCard}>
          <Text style={styles.headerTitle}>What did you buy?</Text>
          <Text style={styles.headerAmount}>{amount.toLocaleString()} RWF</Text>
          <Text style={styles.headerSubtitle}>
            Tell us what this expense was for. You can add multiple items.
          </Text>
        </View>

        {/* Merchant Name */}
        <View style={styles.section}>
          <Text style={styles.label}>
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
            <TouchableOpacity onPress={addItem} style={styles.addButton}>
              <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
              <Text style={styles.addButtonText}>Add Item</Text>
            </TouchableOpacity>
          </View>

          {items.map((item, index) => (
            <View key={item.id} style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemNumber}>Item {index + 1}</Text>
                {items.length > 1 && (
                  <TouchableOpacity onPress={() => removeItem(item.id)}>
                    <Ionicons name="trash-outline" size={18} color={colors.expense} />
                  </TouchableOpacity>
                )}
              </View>

              <Text style={styles.inputLabel}>
                Item Name <Text style={styles.required}>*</Text>
              </Text>
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

              <Text style={styles.inputLabel}>
                Total Cost (RWF) <Text style={styles.required}>*</Text>
              </Text>
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

        {/* Total Summary */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Items Total:</Text>
            <Text style={styles.summaryValue}>{totalAmount.toLocaleString()} RWF</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Transaction Amount:</Text>
            <Text style={styles.summaryValue}>{amount.toLocaleString()} RWF</Text>
          </View>
          {Math.abs(totalAmount - amount) > 0.01 && (
            <View style={[styles.summaryRow, styles.warningRow]}>
              <Ionicons name="warning-outline" size={16} color={colors.warning} />
              <Text style={styles.warningText}>
                Totals don't match. Difference: {Math.abs(totalAmount - amount).toLocaleString()} RWF
              </Text>
            </View>
          )}
        </View>

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
              <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
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
  content: { padding: spacing.xl, paddingBottom: 40 },

  headerCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  headerTitle: { fontSize: 16, fontWeight: '600', color: colors.primary, marginBottom: 4 },
  headerAmount: { fontSize: 28, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  headerSubtitle: { fontSize: 13, color: colors.textSecondary },

  section: { marginBottom: spacing.lg },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionTitle: { ...typography.h3, color: colors.textPrimary },

  label: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm },
  inputLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: 4, marginTop: spacing.sm },
  required: { color: colors.expense },

  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
  },

  row: { flexDirection: 'row', gap: spacing.md },
  halfInput: { flex: 1 },

  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  addButtonText: { color: colors.primary, fontWeight: '600', fontSize: 13 },

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
    marginBottom: spacing.sm,
  },
  itemNumber: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },

  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  summaryLabel: { fontSize: 14, color: colors.textSecondary },
  summaryValue: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },

  warningRow: {
    backgroundColor: '#fffbeb',
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  warningText: { flex: 1, fontSize: 12, color: '#92400e' },

  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
