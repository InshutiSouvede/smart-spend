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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { transactionsApi } from '../api/transactions';
import { getErrorMessage } from '../api/client';
import { colors, spacing, radius, fonts } from '../theme';

type TypeFilter = 'all' | 'income' | 'expense';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function validateDate(dateStr: string): boolean {
  if (!dateStr) return true;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date.getTime());
}

export function ExportScreen() {
  const [fromDate, setFromDate] = useState(firstOfMonthStr());
  const [toDate, setToDate] = useState(todayStr());
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ fromDate?: string; toDate?: string; range?: string }>({});

  const validateDates = (): boolean => {
    const newErrors: typeof errors = {};
    if (fromDate && !validateDate(fromDate)) {
      newErrors.fromDate = 'Invalid date format. Use YYYY-MM-DD';
    }
    if (toDate && !validateDate(toDate)) {
      newErrors.toDate = 'Invalid date format. Use YYYY-MM-DD';
    }
    if (fromDate && toDate && validateDate(fromDate) && validateDate(toDate)) {
      if (new Date(fromDate) > new Date(toDate)) {
        newErrors.range = 'From date cannot be after To date';
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleExport = async () => {
    if (!validateDates()) return;
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

      const filename = `SmartSpend_${fromDate || 'all'}_${toDate || 'all'}.csv`;
      const fileUri = (FileSystem.cacheDirectory ?? '') + filename;

      await FileSystem.writeAsStringAsync(fileUri, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Sharing unavailable', `CSV saved to cache: ${filename}`);
        return;
      }

      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/csv',
        dialogTitle: 'Share CSV export',
        UTI: 'public.comma-separated-values-text',
      });
    } catch (e) {
      Alert.alert('Export failed', getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Export Transactions</Text>
        <Text style={styles.subtitle}>
          Download your transactions as a CSV file and share or save it.
        </Text>

        {/* Date range */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Date range</Text>

          <Text style={styles.label}>From date</Text>
          <TextInput
            style={[styles.input, errors.fromDate && styles.inputError]}
            value={fromDate}
            onChangeText={(text) => {
              setFromDate(text);
              setErrors((prev) => ({ ...prev, fromDate: undefined, range: undefined }));
            }}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textMuted}
            keyboardType="default"
            autoCapitalize="none"
          />
          {errors.fromDate && <Text style={styles.errorText}>{errors.fromDate}</Text>}

          <Text style={[styles.label, { marginTop: spacing.md }]}>To date</Text>
          <TextInput
            style={[styles.input, errors.toDate && styles.inputError]}
            value={toDate}
            onChangeText={(text) => {
              setToDate(text);
              setErrors((prev) => ({ ...prev, toDate: undefined, range: undefined }));
            }}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textMuted}
            keyboardType="default"
            autoCapitalize="none"
          />
          {errors.toDate && <Text style={styles.errorText}>{errors.toDate}</Text>}
          {errors.range && <Text style={styles.errorText}>{errors.range}</Text>}
        </View>

        {/* Type filter */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Transaction type</Text>
          <View style={styles.pillRow}>
            {(['all', 'income', 'expense'] as TypeFilter[]).map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => setTypeFilter(t)}
                style={[styles.pill, typeFilter === t && styles.pillActive]}
              >
                <Text style={[styles.pillText, typeFilter === t && styles.pillTextActive]}>
                  {t === 'all' ? 'All' : t === 'income' ? 'Income' : 'Expenses'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* CSV columns info */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
            <Text style={styles.infoTitle}>CSV columns included</Text>
          </View>
          <Text style={styles.infoText}>
            date · type · amount_rwf · fee_rwf · to_who · from_who · reference · provider · balance_after_rwf · currency · parse_confidence
          </Text>
        </View>

        {/* Export button */}
        <TouchableOpacity
          style={[styles.exportBtn, loading && styles.exportBtnDisabled]}
          onPress={handleExport}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.textPrimary} size="small" />
          ) : (
            <Ionicons name="download-outline" size={18} color={colors.textPrimary} />
          )}
          <Text style={styles.exportBtnText}>
            {loading ? 'Generating…' : 'Export to CSV'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.hint}>
          The CSV file will open in your device's share sheet. You can save it to Files,
          send by email, or open directly in a spreadsheet app.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 48,
    paddingTop: spacing.md,
  },
  title: {
    fontFamily: fonts.headingBold,
    fontSize: 24,
    lineHeight: 32,
    color: colors.textPrimary,
    marginBottom: spacing.xxs,
  },
  subtitle: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.xl,
    lineHeight: 20,
  },

  section: { marginBottom: spacing.xl },
  sectionTitle: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  label: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.textPrimary,
    marginBottom: spacing.xxs,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: fonts.bodyRegular,
    fontSize: 15,
    color: colors.textPrimary,
    minHeight: 48,
  },
  inputError: { borderColor: colors.error },
  errorText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.error,
    marginTop: spacing.xxs,
  },

  pillRow: { flexDirection: 'row', gap: spacing.xxs },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainer,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 36,
    justifyContent: 'center',
  },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textMuted,
  },
  pillTextActive: {
    color: colors.textPrimary,
    fontFamily: fonts.bodySemiBold,
  },

  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xl,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    marginBottom: spacing.xxs,
  },
  infoTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.textMuted,
  },
  infoText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },

  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.xs,
    paddingVertical: 14,
    marginBottom: spacing.md,
    minHeight: 50,
  },
  exportBtnDisabled: { opacity: 0.6 },
  exportBtnText: {
    fontFamily: fonts.headingSemiBold,
    color: colors.textPrimary,
    fontSize: 15,
  },
  hint: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
