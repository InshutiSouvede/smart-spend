import React, { useMemo } from 'react';
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
import { LineChart } from 'react-native-chart-kit';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { useSpendingStatus, useMonthlyTrends, useDailyTrends } from '../hooks/useAnalytics';
import { useTransactions } from '../hooks/useTransactions';
import { useAuthStore } from '../store/authStore';
import { ErrorBanner } from '../components/ErrorBanner';
import { TransactionCard } from '../components/TransactionCard';
import { getErrorMessage } from '../api/client';
import { colors, spacing, radius, fonts } from '../theme';
import type { AppTabParamList, TransactionsStackParamList } from '../navigation/AppTabs';

const { width } = Dimensions.get('window');
const CHART_WIDTH = width - spacing.lg * 2;

function formatRWF(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M RWF`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}K RWF`;
  return `${Math.round(amount).toLocaleString()} RWF`;
}

const RISK_CONFIG = {
  low:     { color: colors.income,   label: 'Low risk',    icon: 'shield-checkmark-outline' as const },
  medium:  { color: colors.warning,  label: 'Watch out',   icon: 'warning-outline' as const },
  high:    { color: colors.expense,  label: 'High risk',   icon: 'alert-circle-outline' as const },
  no_data: { color: colors.textMuted, label: 'No data yet', icon: 'help-circle-outline' as const },
};

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<AppTabParamList>,
  NativeStackNavigationProp<TransactionsStackParamList>
>;

type TrendView = 'daily' | 'monthly';

export function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  const navigation = useNavigation<Nav>();
  const [trendView, setTrendView] = React.useState<TrendView>('daily');

  const {
    data: status,
    isLoading: statusLoading,
    isError: statusError,
    error: statusErr,
    refetch: refetchStatus,
    isRefetching,
  } = useSpendingStatus();

  const { data: monthly, isLoading: monthlyLoading } = useMonthlyTrends(6);
  const { data: daily, isLoading: dailyLoading } = useDailyTrends(30);

  const { data: txPages } = useTransactions({});
  const recentTx = useMemo(
    () => txPages?.pages.flatMap((p) => p.items).slice(0, 5) ?? [],
    [txPages],
  );

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  const risk = status ? RISK_CONFIG[status.risk_level as keyof typeof RISK_CONFIG] ?? RISK_CONFIG.no_data : null;

  const trendData = useMemo(() => {
    if (trendView === 'daily') {
      if (!daily || daily.length === 0) return null;
      const sorted = [...daily].reverse();
      return {
        labels: sorted.map((d) => new Date(d.date).getDate().toString()),
        datasets: [
          { data: sorted.map((d) => d.total_income), color: () => colors.income, strokeWidth: 2 },
          { data: sorted.map((d) => d.total_expense), color: () => colors.expense, strokeWidth: 2 },
        ],
        legend: ['Income', 'Expense'],
      };
    } else {
      if (!monthly || monthly.length === 0) return null;
      const sorted = [...monthly].reverse();
      return {
        labels: sorted.map((m) => m.period.slice(5)),
        datasets: [
          { data: sorted.map((m) => m.total_income), color: () => colors.income, strokeWidth: 2 },
          { data: sorted.map((m) => m.total_expense), color: () => colors.expense, strokeWidth: 2 },
        ],
        legend: ['Income', 'Expense'],
      };
    }
  }, [trendView, daily, monthly]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetchStatus}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Header row */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>{greeting}</Text>
            <Text style={styles.name}>{user?.display_name ?? user?.email ?? 'there'}</Text>
          </View>
          {risk && (
            <View style={[styles.riskBadge, { backgroundColor: risk.color + '18' }]}>
              <Ionicons name={risk.icon} size={13} color={risk.color} />
              <Text style={[styles.riskText, { color: risk.color }]}>{risk.label}</Text>
            </View>
          )}
        </View>

        {statusError && (
          <ErrorBanner message={getErrorMessage(statusErr)} onRetry={refetchStatus} />
        )}

        {/* Main summary card — champagne gradient */}
        <LinearGradient
          colors={[colors.gradientStart, colors.gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.summaryCard}
        >
          <Text style={styles.summaryPeriod}>Net Balance · {status?.period ?? '—'}</Text>
          <Text style={styles.summaryAmount}>
            {statusLoading
              ? '—'
              : `${(status?.net_balance ?? 0) >= 0 ? '+' : ''}${formatRWF(status?.net_balance ?? 0)}`}
          </Text>
          {status && status.risk_level !== 'no_data' && (
            <Text style={styles.summaryStatus}>{status.status_message}</Text>
          )}
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <View style={styles.summaryDotRow}>
                <View style={[styles.dot, { backgroundColor: colors.income }]} />
                <Text style={styles.summaryItemLabel}>Income</Text>
              </View>
              <Text style={[styles.summaryItemAmount, { color: colors.income }]}>
                {statusLoading ? '—' : formatRWF(status?.total_income ?? 0)}
              </Text>
            </View>
            <View style={styles.summaryDividerV} />
            <View style={styles.summaryItem}>
              <View style={styles.summaryDotRow}>
                <View style={[styles.dot, { backgroundColor: colors.expense }]} />
                <Text style={styles.summaryItemLabel}>Expenses</Text>
              </View>
              <Text style={[styles.summaryItemAmount, { color: colors.expense }]}>
                {statusLoading ? '—' : formatRWF(status?.total_expense ?? 0)}
              </Text>
            </View>
          </View>
        </LinearGradient>

        {/* Spending rate */}
        {status && status.risk_level !== 'no_data' && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Spending rate</Text>
              <Text style={styles.sectionMeta}>{status.days_remaining} days remaining</Text>
            </View>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(status.expense_rate_pct, 100)}%` as any,
                    backgroundColor: risk?.color ?? colors.primary,
                  },
                ]}
              />
            </View>
            <Text style={styles.progressLabel}>
              {status.expense_rate_pct.toFixed(0)}% of income spent
            </Text>
          </View>
        )}

        {/* ML Predictions */}
        {(status?.predicted_month_end_expense != null || status?.predicted_month_end_income != null) && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { marginBottom: spacing.sm }]}>ML Forecast — month-end</Text>
            <View style={styles.forecastRow}>
              {status?.predicted_month_end_income != null && (
                <View style={styles.forecastCard}>
                  <Text style={styles.forecastLabel}>Income</Text>
                  <Text style={[styles.forecastAmount, { color: colors.income }]}>
                    {formatRWF(status.predicted_month_end_income)}
                  </Text>
                </View>
              )}
              {status?.predicted_month_end_expense != null && (
                <View style={styles.forecastCard}>
                  <Text style={styles.forecastLabel}>Expenses</Text>
                  <Text style={[styles.forecastAmount, { color: colors.expense }]}>
                    {formatRWF(status.predicted_month_end_expense)}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.forecastNet}>
              Projected net balance:{' '}
              <Text style={{ color: (status?.projected_net ?? 0) >= 0 ? colors.income : colors.expense, fontFamily: fonts.bodySemiBold }}>
                {(status?.projected_net ?? 0) >= 0 ? '+' : ''}{formatRWF(status?.projected_net ?? 0)}
              </Text>
            </Text>
            <Text style={styles.forecastHint}>ML predictions are estimated month-end totals based on your spending patterns.</Text>
          </View>
        )}

        {/* Top category */}
        {status?.top_category && (
          <View style={styles.topCatCard}>
            <Ionicons name="flame-outline" size={14} color={colors.primary} />
            <Text style={styles.topCatText}>
              Top spend:{' '}
              <Text style={{ fontFamily: fonts.bodySemiBold }}>{status.top_category}</Text>
              {' '}— {formatRWF(status.top_category_amount)} ({status.top_category_pct.toFixed(0)}%)
            </Text>
          </View>
        )}

        {/* Unmatched alert */}
        {(status?.unmatched_expense_count ?? 0) > 0 && (
          <TouchableOpacity
            style={styles.alertCard}
            onPress={() => navigation.navigate('TransactionsTab', { screen: 'UnmatchedExpenses' })}
          >
            <Ionicons name="receipt-outline" size={16} color={colors.primary} />
            <Text style={styles.alertText}>
              {status!.unmatched_expense_count} expense{status!.unmatched_expense_count > 1 ? 's' : ''} need categorization
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.primary} />
          </TouchableOpacity>
        )}

        {/* Spending trend chart */}
        {!monthlyLoading && !dailyLoading && trendData && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Spending trend</Text>
              <View style={styles.pillRow}>
                {(['daily', 'monthly'] as TrendView[]).map((view) => (
                  <TouchableOpacity
                    key={view}
                    onPress={() => setTrendView(view)}
                    style={[styles.pill, trendView === view && styles.pillActive]}
                  >
                    <Text style={[styles.pillText, trendView === view && styles.pillTextActive]}>
                      {view === 'daily' ? 'Daily' : 'Monthly'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.chartContainer}>
              <LineChart
                data={trendData}
                width={CHART_WIDTH - spacing.xl * 2}
                height={160}
                withDots={false}
                withInnerLines={false}
                withOuterLines={false}
                chartConfig={{
                  backgroundGradientFrom: colors.surface,
                  backgroundGradientTo: colors.surface,
                  color: (opacity = 1, index) =>
                    index === 0
                      ? `rgba(45,90,39,${opacity})`
                      : `rgba(163,69,55,${opacity})`,
                  labelColor: () => colors.textMuted,
                  decimalPlaces: 0,
                  propsForLabels: { fontFamily: fonts.bodyRegular, fontSize: 10 },
                  propsForBackgroundLines: { stroke: colors.border },
                }}
                style={{ borderRadius: radius.md }}
                bezier
              />
            </View>
            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.income }]} />
                <Text style={styles.legendText}>Income</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.expense }]} />
                <Text style={styles.legendText}>Expense</Text>
              </View>
            </View>
          </View>
        )}

        {/* Recent transactions */}
        {recentTx.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent activity</Text>
              <TouchableOpacity onPress={() => navigation.navigate('TransactionsTab' as any)}>
                <Text style={styles.seeAll}>See all</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.txList}>
              {recentTx.map((tx) => (
                <TransactionCard
                  key={tx.id}
                  tx={tx}
                  onPress={(t) => {
                    navigation.navigate('TransactionsTab' as any, {
                      screen: 'ItemDetails',
                      params: {
                        smsTransactionId: t.id,
                        amount: t.amount_rwf,
                        merchant: t.to_who || undefined,
                      },
                    });
                  }}
                />
              ))}
            </View>
          </View>
        )}

        {/* Quick actions */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { marginBottom: spacing.sm }]}>Quick actions</Text>
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.actionPrimary}
              onPress={() => navigation.navigate('TransactionsTab' as any)}
            >
              <Ionicons name="phone-portrait-outline" size={16} color={colors.textPrimary} />
              <Text style={styles.actionPrimaryText}>Import SMS</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionSecondary}
              onPress={() => navigation.navigate('ReceiptsTab' as any)}
            >
              <Ionicons name="camera-outline" size={16} color={colors.textPrimary} />
              <Text style={styles.actionSecondaryText}>Upload Receipt</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.actionTertiary}
            onPress={() => navigation.navigate('AnalyticsTab' as any)}
          >
            <Ionicons name="bar-chart-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.actionTertiaryText}>View Analytics</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 48, paddingTop: spacing.md },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  greeting: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 2,
  },
  name: {
    fontFamily: fonts.headingBold,
    fontSize: 22,
    lineHeight: 28,
    color: colors.textPrimary,
  },
  riskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  riskText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
  },

  // Summary gradient card
  summaryCard: {
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.xl,
  },
  summaryPeriod: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.xxs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryAmount: {
    fontFamily: fonts.headingBold,
    fontSize: 36,
    lineHeight: 44,
    letterSpacing: -0.5,
    color: colors.textPrimary,
    marginBottom: spacing.xxs,
  },
  summaryStatus: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,17,17,0.08)',
  },
  summaryItem: {
    flex: 1,
  },
  summaryDotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 3,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  summaryItemLabel: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  summaryItemAmount: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 15,
    lineHeight: 20,
  },
  summaryDividerV: {
    width: 1,
    height: 36,
    backgroundColor: 'rgba(17,17,17,0.1)',
    marginHorizontal: spacing.md,
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
    lineHeight: 22,
    color: colors.textPrimary,
  },
  sectionMeta: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textMuted,
  },
  seeAll: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textSecondary,
  },

  progressBar: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainer,
    overflow: 'hidden',
    marginBottom: spacing.xxs,
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.full,
  },
  progressLabel: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textMuted,
  },

  forecastRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  forecastCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  forecastLabel: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 2,
  },
  forecastAmount: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 15,
  },
  forecastNet: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  forecastHint: {
    fontFamily: fonts.bodyRegular,
    fontSize: 11,
    color: colors.textMuted,
    fontStyle: 'italic',
  },

  topCatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.xs,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  topCatText: {
    flex: 1,
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: colors.textSecondary,
  },

  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.warningLight,
    borderRadius: radius.xs,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  alertText: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textSecondary,
  },

  chartContainer: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    overflow: 'hidden',
  },
  legend: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textMuted,
  },

  txList: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },

  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  actionPrimary: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.xs,
    paddingVertical: 12,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xxs,
    minHeight: 44,
  },
  actionPrimaryText: {
    fontFamily: fonts.headingSemiBold,
    color: colors.textPrimary,
    fontSize: 13,
  },
  actionSecondary: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.xs,
    paddingVertical: 12,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xxs,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.borderMuted,
  },
  actionSecondaryText: {
    fontFamily: fonts.headingSemiBold,
    color: colors.textPrimary,
    fontSize: 13,
  },
  actionTertiary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 44,
  },
  actionTertiaryText: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textSecondary,
  },

  pillRow: { flexDirection: 'row', gap: spacing.xxs },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainer,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pillText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.textMuted,
  },
  pillTextActive: {
    color: colors.textPrimary,
  },
});
