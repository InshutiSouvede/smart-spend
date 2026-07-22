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
import { LinearGradient } from 'expo-linear-gradient';
import { BarChart } from 'react-native-chart-kit';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { useAnalyticsSummary, useMonthlyTrends, useCategoryBreakdown } from '../hooks/useAnalytics';
import { ErrorBanner } from '../components/ErrorBanner';
import { getErrorMessage } from '../api/client';
import { colors, spacing, radius, fonts } from '../theme';
import type { AppTabParamList, TransactionsStackParamList } from '../navigation/AppTabs';

const { width } = Dimensions.get('window');
const CHART_WIDTH = width - spacing.lg * 2;

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
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const monthsNum = parseInt(months, 10);

  const fromDate = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0).getDate();
  const toDate = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

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

  const goToPreviousMonth = () => {
    const newDate = new Date(selectedMonth);
    newDate.setMonth(newDate.getMonth() - 1);
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    if (newDate >= twelveMonthsAgo) setSelectedMonth(newDate);
  };

  const goToNextMonth = () => {
    const newDate = new Date(selectedMonth);
    newDate.setMonth(newDate.getMonth() + 1);
    const now = new Date();
    if (newDate <= now) setSelectedMonth(newDate);
  };

  const isCurrentMonth =
    selectedMonth.getMonth() === new Date().getMonth() &&
    selectedMonth.getFullYear() === new Date().getFullYear();

  const isTwelveMonthsAgo = () => {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    return selectedMonth <= twelveMonthsAgo;
  };

  const monthLabel = selectedMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const monthlyChartData = useMemo(() => {
    if (!monthly || monthly.length === 0) return null;
    const sorted = [...monthly].reverse();
    return {
      labels: sorted.map((m) => m.period.slice(5)),
      datasets: [{ data: sorted.map((m) => m.total_expense) }],
    };
  }, [monthly]);

  const topCategories = useMemo(() => (categories ?? []).slice(0, 6), [categories]);
  const catChartData = useMemo(() => {
    if (topCategories.length === 0) return null;
    return {
      labels: topCategories.map((c: any) => c.category.slice(0, 7)),
      datasets: [{ data: topCategories.map((c: any) => c.total_rwf) }],
    };
  }, [topCategories]);

  const allRefetch = () => { refetch(); };

  const chartConfig = {
    backgroundGradientFrom: colors.surface,
    backgroundGradientTo: colors.surface,
    color: () => colors.expense,
    labelColor: () => colors.textMuted,
    barPercentage: 0.6,
    decimalPlaces: 0,
    propsForLabels: { fontFamily: fonts.bodyRegular, fontSize: 10 },
    propsForBackgroundLines: { stroke: colors.border },
  };

  const catChartConfig = {
    ...chartConfig,
    color: () => colors.primary,
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={allRefetch}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <Text style={styles.screenTitle}>Analytics</Text>

        {isError && <ErrorBanner message={getErrorMessage(error)} onRetry={refetch} />}

        {/* Month navigation */}
        <View style={styles.monthNav}>
          <TouchableOpacity
            onPress={goToPreviousMonth}
            disabled={isTwelveMonthsAgo()}
            style={[styles.monthNavBtn, isTwelveMonthsAgo() && styles.monthNavBtnDisabled]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={18} color={isTwelveMonthsAgo() ? colors.textMuted : colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.monthLabelContainer}>
            <Text style={styles.monthLabelText}>{monthLabel}</Text>
            {isCurrentMonth && <Text style={styles.monthBadge}>Current</Text>}
          </View>
          <TouchableOpacity
            onPress={goToNextMonth}
            disabled={isCurrentMonth}
            style={[styles.monthNavBtn, isCurrentMonth && styles.monthNavBtnDisabled]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-forward" size={18} color={isCurrentMonth ? colors.textMuted : colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* Month summary — champagne gradient */}
        <LinearGradient
          colors={[colors.gradientStart, colors.gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.summaryGradient}
        >
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <View style={styles.summaryDotRow}>
                <View style={[styles.dot, { backgroundColor: colors.income }]} />
                <Text style={styles.summaryLabel}>Income</Text>
              </View>
              <Text style={[styles.summaryValue, { color: colors.income }]}>
                {summaryLoading ? '—' : `${formatRWF(summary?.total_income ?? 0)} RWF`}
              </Text>
              <Text style={styles.summaryCount}>{summary?.income_count ?? 0} transactions</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <View style={styles.summaryDotRow}>
                <View style={[styles.dot, { backgroundColor: colors.expense }]} />
                <Text style={styles.summaryLabel}>Expenses</Text>
              </View>
              <Text style={[styles.summaryValue, { color: colors.expense }]}>
                {summaryLoading ? '—' : `${formatRWF(summary?.total_expense ?? 0)} RWF`}
              </Text>
              <Text style={styles.summaryCount}>
                {summary?.expense_count ?? 0} txns · {summary?.overspend ? 'Overspending' : 'Within budget'}
              </Text>
            </View>
          </View>
        </LinearGradient>

        {/* Spending by category */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Spending by category</Text>
          {catLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.xl }} />
          ) : catChartData ? (
            <>
              <View style={styles.chartContainer}>
                <BarChart
                  data={catChartData}
                  width={CHART_WIDTH - spacing.xl * 2}
                  height={180}
                  yAxisLabel=""
                  yAxisSuffix="K"
                  fromZero
                  showValuesOnTopOfBars
                  withInnerLines={false}
                  chartConfig={catChartConfig}
                  style={{ borderRadius: radius.xs }}
                />
              </View>
              {topCategories.map((cat: any) => {
                const isUncategorised = cat.category === 'Uncategorised';
                return isUncategorised ? (
                  <TouchableOpacity
                    key={cat.category}
                    style={styles.catRow}
                    onPress={() => navigation.navigate('TransactionsTab' as any, { screen: 'UnmatchedExpenses' })}
                    activeOpacity={0.7}
                  >
                    <View style={styles.catInfo}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Ionicons name="alert-circle" size={13} color={colors.warning} />
                        <Text style={[styles.catName, { color: colors.warning }]}>{cat.item_count} Uncategorized</Text>
                      </View>
                      <Text style={styles.catMeta}>Tap to categorize</Text>
                    </View>
                    <View style={styles.catRight}>
                      <Text style={styles.catAmount}>{formatRWF(cat.total_rwf)} RWF</Text>
                      <Ionicons name="chevron-forward" size={13} color={colors.textMuted} />
                    </View>
                  </TouchableOpacity>
                ) : (
                  <View key={cat.category} style={styles.catRow}>
                    <View style={styles.catInfo}>
                      <Text style={styles.catName}>{cat.category}</Text>
                      <Text style={styles.catMeta}>{cat.item_count} item{cat.item_count !== 1 ? 's' : ''}</Text>
                    </View>
                    <View style={styles.catRight}>
                      <Text style={styles.catAmount}>{formatRWF(cat.total_rwf)} RWF</Text>
                      <Text style={styles.catPct}>{cat.percentage.toFixed(0)}%</Text>
                    </View>
                  </View>
                );
              })}

              {categories && categories.length > 6 && (
                <>
                  {showAllCategories && categories.slice(6).map((cat: any) => {
                    const isUncategorised = cat.category === 'Uncategorised';
                    return isUncategorised ? (
                      <TouchableOpacity
                        key={cat.category}
                        style={styles.catRow}
                        onPress={() => navigation.navigate('TransactionsTab' as any, { screen: 'UnmatchedExpenses' })}
                        activeOpacity={0.7}
                      >
                        <View style={styles.catInfo}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <Ionicons name="alert-circle" size={13} color={colors.warning} />
                            <Text style={[styles.catName, { color: colors.warning }]}>{cat.item_count} Uncategorized</Text>
                          </View>
                          <Text style={styles.catMeta}>Tap to categorize</Text>
                        </View>
                        <View style={styles.catRight}>
                          <Text style={styles.catAmount}>{formatRWF(cat.total_rwf)} RWF</Text>
                          <Ionicons name="chevron-forward" size={13} color={colors.textMuted} />
                        </View>
                      </TouchableOpacity>
                    ) : (
                      <View key={cat.category} style={styles.catRow}>
                        <View style={styles.catInfo}>
                          <Text style={styles.catName}>{cat.category}</Text>
                          <Text style={styles.catMeta}>{cat.item_count} item{cat.item_count !== 1 ? 's' : ''}</Text>
                        </View>
                        <View style={styles.catRight}>
                          <Text style={styles.catAmount}>{formatRWF(cat.total_rwf)} RWF</Text>
                          <Text style={styles.catPct}>{cat.percentage.toFixed(0)}%</Text>
                        </View>
                      </View>
                    );
                  })}
                  <TouchableOpacity
                    style={styles.toggleBtn}
                    onPress={() => setShowAllCategories(!showAllCategories)}
                  >
                    <Text style={styles.toggleText}>
                      {showAllCategories
                        ? 'Show less'
                        : `Show ${categories.length - 6} more categor${categories.length - 6 === 1 ? 'y' : 'ies'}`}
                    </Text>
                    <Ionicons name={showAllCategories ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textSecondary} />
                  </TouchableOpacity>
                </>
              )}
            </>
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
                  <Text style={[styles.pillText, months === m && styles.pillTextActive]}>{m}M</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          {monthlyLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.xl }} />
          ) : monthlyChartData ? (
            <View style={styles.chartContainer}>
              <BarChart
                data={monthlyChartData}
                width={CHART_WIDTH - spacing.xl * 2}
                height={180}
                yAxisLabel=""
                yAxisSuffix=""
                fromZero
                withInnerLines={false}
                chartConfig={chartConfig}
                style={{ borderRadius: radius.xs }}
              />
            </View>
          ) : (
            <Text style={styles.empty}>No monthly data yet.</Text>
          )}
        </View>

        {/* Monthly comparison table */}
        {monthly && monthly.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Monthly comparison</Text>
            <View style={styles.tableContainer}>
              {[...monthly].reverse().map((m) => (
                <View key={m.period} style={styles.monthRow}>
                  <Text style={styles.monthLabel}>{m.period}</Text>
                  <Text style={[styles.monthVal, { color: colors.income }]}>
                    +{formatRWF(m.total_income)}
                  </Text>
                  <Text style={[styles.monthVal, { color: colors.expense }]}>
                    −{formatRWF(m.total_expense)}
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
          </View>
        )}

        {/* Export link */}
        <TouchableOpacity
          style={styles.exportBtn}
          onPress={() => navigation.navigate('ExportTab' as any)}
        >
          <Ionicons name="download-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.exportText}>Export transactions (CSV)</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 48, paddingTop: spacing.md },
  screenTitle: {
    fontFamily: fonts.headingBold,
    fontSize: 24,
    lineHeight: 32,
    color: colors.textPrimary,
    marginBottom: spacing.xl,
  },

  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 48,
  },
  monthNavBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  monthNavBtnDisabled: { opacity: 0.35 },
  monthLabelContainer: {
    flex: 1,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  monthLabelText: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  monthBadge: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    color: colors.primary,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
    overflow: 'hidden',
  },

  summaryGradient: {
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.xl,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  summaryItem: { flex: 1 },
  summaryDotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 3,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  summaryLabel: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  summaryValue: {
    fontFamily: fonts.headingBold,
    fontSize: 18,
    lineHeight: 24,
    marginTop: 1,
  },
  summaryCount: {
    fontFamily: fonts.bodyRegular,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  summaryDivider: {
    width: 1,
    backgroundColor: 'rgba(17,17,17,0.1)',
    marginHorizontal: spacing.md,
    alignSelf: 'stretch',
  },

  section: { marginBottom: spacing.xl },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  empty: {
    fontFamily: fonts.bodyRegular,
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.md,
  },

  chartContainer: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },

  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: 44,
  },
  catInfo: { flex: 1 },
  catName: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  catMeta: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  catRight: { alignItems: 'flex-end' },
  catAmount: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  catPct: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textMuted,
  },

  pillRow: { flexDirection: 'row', gap: spacing.xxs },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainer,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 28,
    justifyContent: 'center',
  },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.textMuted },
  pillTextActive: { color: colors.textPrimary },

  tableContainer: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: 44,
  },
  monthLabel: {
    fontFamily: fonts.bodyMedium,
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
  },
  monthVal: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    width: 76,
    textAlign: 'right',
  },
  monthNet: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 13,
    width: 68,
    textAlign: 'right',
  },

  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    paddingVertical: spacing.sm,
    marginTop: spacing.xxs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    minHeight: 44,
  },
  toggleText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textSecondary,
  },

  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.xxs,
    minHeight: 44,
  },
  exportText: {
    fontFamily: fonts.bodyMedium,
    flex: 1,
    color: colors.textSecondary,
    fontSize: 13,
  },
});

