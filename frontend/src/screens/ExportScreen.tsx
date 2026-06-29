import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { transactionsApi } from '../api/transactions';
import { getErrorMessage } from '../api/client';
import { colors, spacing, radius, typography } from '../theme';

type TypeFilter = 'all' | 'income' | 'expense';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export function ExportScreen() {
  const [fromDate, setFromDate] = useState(firstOfMonthStr());
  const [toDate, setToDate] = useState(todayStr());
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const csv = await transactionsApi.exportCsv({
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        transaction_type: typeFilter === 'all' ? undefined : typeFilter,
      });

      if (!csv || csv.trim().split('\n').length <= 1) {
        Alert.alert('No data', 'No transactions found for the selected filters.');
        return;
      }

      await Share.share(
        {
          message: csv,
          title: `SmartSpend_${fromDate}_${toDate}.csv`,
        },
        { dialogTitle: 'Share CSV export' },
      );
    } catch (e) {
      Alert.alert('Export failed', getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const rowCount = 0; // We don't know until we download

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Export Transactions</Text>
        <Text style={styles.subtitle}>
          Download your transactions as a CSV file and share or save it.
        </Text>

        {/* Date range */}
        <View style={styles.section}>
          <Text style={styles.label}>From date</Text>
          <TextInput
            style={styles.input}
            value={fromDate}
            onChangeText={setFromDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textMuted}
            keyboardType="default"
            autoCapitalize="none"
          />

          <Text style={[styles.label, { marginTop: spacing.md }]}>To date</Text>
          <TextInput
            style={styles.input}
            value={toDate}
            onChangeText={setToDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textMuted}
            keyboardType="default"
            autoCapitalize="none"
          />
        </View>

        {/* Type filter */}
        <View style={styles.section}>
          <Text style={styles.label}>Transaction type</Text>
          <View style={styles.pillRow}>
            {(['all', 'income', 'expense'] as TypeFilter[]).map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => setTypeFilter(t)}
                style={[styles.pill, typeFilter === t && styles.pillActive]}
              >
                <Text style={[styles.pillText, typeFilter === t && styles.pillTextActive]}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* CSV columns info */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
            <Text style={styles.infoTitle}>CSV columns</Text>
          </View>
          <Text style={styles.infoText}>
            date, type, amount_rwf, fee_rwf, to_who, from_who, reference, provider,
            balance_after_rwf, currency, parse_confidence
          </Text>
        </View>

        {/* Export button */}
        <TouchableOpacity
          style={[styles.exportBtn, loading && styles.exportBtnDisabled]}
          onPress={handleExport}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons name="download-outline" size={20} color="#fff" />
          )}
          <Text style={styles.exportBtnText}>
            {loading ? 'Generating…' : 'Export to CSV'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.hint}>
          The CSV will be shared via your device's share sheet. You can save it to Files,
          send by email, or open in a spreadsheet app.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingBottom: 40 },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: spacing.lg },

  section: { marginBottom: spacing.lg },
  label: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm },

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

  pillRow: { flexDirection: 'row', gap: spacing.sm },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  pillTextActive: { color: '#fff' },

  infoCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  infoTitle: { fontSize: 13, fontWeight: '600', color: colors.primary },
  infoText: { fontSize: 12, color: colors.textSecondary, lineHeight: 18 },

  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    marginBottom: spacing.md,
  },
  exportBtnDisabled: { opacity: 0.6 },
  exportBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  hint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
