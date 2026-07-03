import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BarChart } from 'react-native-chart-kit';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { useAnalyticsSummary, useMonthlyTrends, useCategoryBreakdown, useUnmatchedExpenses } from '../hooks/useAnalytics';
import { ErrorBanner } from '../components/ErrorBanner';
import { getErrorMessage } from '../api/client';
import { colors, spacing, radius, typography } from '../theme';
import type { AppTabParamList, TransactionsStackParamList } from '../navigation/AppTabs';

const { width } = Dimensions.get('window');
const CHART_WIDTH = width - spacing.xl * 2;

function formatRWF(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K`;
  return `${Math.round(amount)}`;
}

type MonthRange = '1' | '3' | '6' | '12';
type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<AppTabParamList, 'AnalyticsTab'>,
  NativeStackNavigationProp<TransactionsStackParamList>
>;

export function AnalyticsScreen() {
  const navigation = useNavigation<Nav>();
  const [months, setMonths] = useState<MonthRange>('6');
  const monthsNum = parseInt(months, 10);

  const now = new Date();
  const fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const toDate = now.toISOString().slice(0, 10);

  const {
    data: summary,
    isLoading: summaryLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useAnalyticsSummary(fromDate, toDate);

  const { data: monthly, isLoading: monthlyLoading } = useMonthlyTrends(monthsNum);

  const { data: categories, isLoading: catLoading } = useCategoryBreakdown(fromDate, toDate);

  const { data: unmatchedExpenses } = useUnmatchedExpenses();

  // Monthly chart (chronological)
  const monthlyChartData = useMemo(() => {
    if (!monthly || monthly.length === 0) return null;
    const sorted = [...monthly].reverse();
    return {
      labels: sorted.map((m) => m.period.slice(5)),
      datasets: [{ data: sorted.map((m) => m.total_expense) }],
    };
  }, [monthly]);

  // Category chart (top 6)
  const topCategories = useMemo(() => (categories ?? []).slice(0, 6), [categories]);
  const catChartData = useMemo(() => {
    if (topCategories.length === 0) return null;
    return {
      labels: topCategories.map((c) => c.category.slice(0, 7)),
      datasets: [{ data: topCategories.map((c) => c.total_rwf) }],
    };
  }, [topCategories]);

  const allRefetch = () => {
    refetch();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={allRefetch} />}
      >
        <Text style={styles.screenTitle}>Analytics</Text>

        {isError && <ErrorBanner message={getErrorMessage(error)} onRetry={refetch} />}

        {/* This month summary */}
        <View style={styles.summaryCards}>
          <View style={[styles.summaryCard, { borderLeftColor: colors.income }]}>
            <Text style={styles.summaryLabel}>Income</Text>
            <Text style={[styles.summaryValue, { color: colors.income }]}>
              {summaryLoading ? '…' : `${formatRWF(summary?.total_income ?? 0)} RWF`}
            </Text>
            <Text style={styles.summaryCount}>{summary?.transaction_count ?? 0} transactions</Text>
          </View>
          <View style={[styles.summaryCard, { borderLeftColor: colors.expense }]}>
            <Text style={styles.summaryLabel}>Expenses</Text>
            <Text style={[styles.summaryValue, { color: colors.expense }]}>
              {summaryLoading ? '…' : `${formatRWF(summary?.total_expense ?? 0)} RWF`}
            </Text>
            <Text style={styles.summaryCount}>
              {summary?.overspend ? 'Overspending' : 'Within budget'}
            </Text>
          </View>
        </View>

        {/* Category breakdown */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Spending by category</Text>
          {catLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
          ) : catChartData ? (
            <>
              <BarChart
                data={catChartData}
                width={CHART_WIDTH}
                height={180}
                yAxisLabel=""
                yAxisSuffix="K"
                fromZero
                showValuesOnTopOfBars
                withInnerLines={false}
                chartConfig={{
                  backgroundGradientFrom: colors.surface,
                  backgroundGradientTo: colors.surface,
                  color: () => colors.primary,
                  labelColor: () => colors.textSecondary,
                  barPercentage: 0.55,
                  decimalPlaces: 0,
                  propsForLabels: { fontSize: 10 },
                }}
                style={{ borderRadius: radius.md }}
              />
              {topCategories.map((cat) => (
                <View key={cat.category} style={styles.catRow}>
                  <View style={styles.catInfo}>
                    <Text style={styles.catName}>{cat.category}</Text>
                    <Text style={styles.catMeta}>
                      {cat.item_count} item{cat.item_count !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  <View style={styles.catRight}>
                    <Text style={styles.catAmount}>{formatRWF(cat.total_rwf)} RWF</Text>
                    <Text style={styles.catPct}>{cat.percentage.toFixed(0)}%</Text>
                  </View>
                </View>
              ))}
            </>
          ) : (unmatchedExpenses && unmatchedExpenses.length > 0) ? (
            <View style={styles.unmatchedSection}>
              <View style={styles.unmatchedHeader}>
                <Ionicons name="help-circle-outline" size={20} color={colors.warning} />
                <Text style={styles.unmatchedTitle}>
                  Unmatched expenses ({unmatchedExpenses.length})
                </Text>
              </View>
              <Text style={styles.unmatchedSubtitle}>
                These expenses need to be identified. Tap an expense to specify what it was for.
              </Text>
              {unmatchedExpenses.slice(0, 5).map((expense) => (
                <TouchableOpacity
                  key={expense.sms_transaction_id}
                  style={styles.unmatchedItem}
                  onPress={() => {
                    navigation.navigate('TransactionsTab', {
                      screen: 'ItemDetails',
                      params: {
                        smsTransactionId: expense.sms_transaction_id,
                        amount: expense.amount_rwf,
                        merchant: expense.to_who || undefined,
                      },
                    });
                  }}
                >
                  <View style={styles.unmatchedLeft}>
                    <Text style={styles.unmatchedAmount}>
                      {formatRWF(expense.amount_rwf)} RWF
                    </Text>
                    <Text style={styles.unmatchedMerchant}>
                      {expense.to_who || 'Unknown merchant'}
                    </Text>
                    {expense.transaction_time && (
                      <Text style={styles.unmatchedTime}>
                        {new Date(expense.transaction_time).toLocaleDateString()}
                      </Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
              {unmatchedExpenses.length > 5 && (
                <TouchableOpacity
                  style={styles.viewAllBtn}
                  onPress={() => navigation.navigate('TransactionsTab', { screen: 'UnmatchedExpenses' })}
                >
                  <Text style={styles.viewAllText}>
                    View all {unmatchedExpenses.length} unmatched expenses
                  </Text>
                  <Ionicons name="arrow-forward" size={14} color={colors.primary} />
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <Text style={styles.empty}>No purchase data yet. Upload receipts or answer item prompts.</Text>
          )}
        </View>

        {/* Monthly expense trend */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Monthly expenses</Text>
            <View style={styles.pillRow}>
              {(['1', '3', '6', '12'] as MonthRange[]).map((m) => (
                <TouchableOpacity
                  key={m}
                  onPress={() => setMonths(m)}
                  style={[styles.pill, months === m && styles.pillActive]}
                >
                  <Text style={[styles.pillText, months === m && styles.pillTextActive]}>
                    {m}M
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          {monthlyLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
          ) : monthlyChartData ? (
            <BarChart
              data={monthlyChartData}
              width={CHART_WIDTH}
              height={180}
              yAxisLabel=""
              yAxisSuffix=""
              fromZero
              withInnerLines={false}
              chartConfig={{
                backgroundGradientFrom: colors.surface,
                backgroundGradientTo: colors.surface,
                color: () => colors.expense,
                labelColor: () => colors.textSecondary,
                barPercentage: 0.65,
                decimalPlaces: 0,
                propsForLabels: { fontSize: 10 },
              }}
              style={{ borderRadius: radius.md }}
            />
          ) : (
            <Text style={styles.empty}>No monthly data yet.</Text>
          )}
        </View>

        {/* Monthly comparison table */}
        {monthly && monthly.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Monthly comparison</Text>
            {[...monthly].reverse().map((m) => (
              <View key={m.period} style={styles.monthRow}>
                <Text style={styles.monthLabel}>{m.period}</Text>
                <Text style={[styles.monthVal, { color: colors.income }]}>
                  +{formatRWF(m.total_income)}
                </Text>
                <Text style={[styles.monthVal, { color: colors.expense }]}>
                  -{formatRWF(m.total_expense)}
                </Text>
                <Text
                  style={[
                    styles.monthNet,
                    { color: m.net >= 0 ? colors.income : colors.expense },
                  ]}
                >
                  {m.net >= 0 ? '+' : ''}
                  {formatRWF(m.net)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Export link */}
        <TouchableOpacity
          style={styles.exportBtn}
          onPress={() => navigation.navigate('ExportTab')}
        >
          <Ionicons name="download-outline" size={18} color={colors.primary} />
          <Text style={styles.exportText}>Export transactions (CSV)</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingBottom: 40 },
  screenTitle: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.lg },

  summaryCards: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderLeftWidth: 4,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  summaryLabel: { fontSize: 12, color: colors.textSecondary },
  summaryValue: { fontSize: 18, fontWeight: '700', marginTop: 2 },
  summaryCount: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  section: { marginBottom: spacing.lg },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  empty: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginTop: spacing.md },

  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  catInfo: { flex: 1 },
  catName: { fontSize: 14, fontWeight: '500', color: colors.textPrimary },
  catMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  catRight: { alignItems: 'flex-end' },
  catAmount: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  catPct: { fontSize: 12, color: colors.textSecondary },

  pillRow: { flexDirection: 'row', gap: spacing.xs },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
  },
  pillActive: { backgroundColor: colors.primary },
  pillText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  pillTextActive: { color: '#fff' },

  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  monthLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  monthVal: { fontSize: 12, fontWeight: '500', width: 80, textAlign: 'right' },
  monthNet: { fontSize: 13, fontWeight: '700', width: 70, textAlign: 'right' },

  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  exportText: { flex: 1, color: colors.primary, fontWeight: '600', fontSize: 14 },

  unmatchedSection: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
  },
  unmatchedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  unmatchedTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  unmatchedSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  unmatchedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  unmatchedLeft: {
    flex: 1,
  },
  unmatchedAmount: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  unmatchedMerchant: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  unmatchedTime: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  viewAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
});
