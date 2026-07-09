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
import { LineChart } from 'react-native-chart-kit';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import { useSpendingStatus, useMonthlyTrends, useDailyTrends } from '../hooks/useAnalytics';
import { useTransactions } from '../hooks/useTransactions';
import { useAuthStore } from '../store/authStore';
import { ErrorBanner } from '../components/ErrorBanner';
import { TransactionCard } from '../components/TransactionCard';
import { getErrorMessage } from '../api/client';
import { colors, spacing, radius, typography } from '../theme';
import type { AppTabParamList } from '../navigation/AppTabs';

const { width } = Dimensions.get('window');
const CHART_WIDTH = width - spacing.xl * 2;

function formatRWF(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M RWF`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K RWF`;
  return `${Math.round(amount).toLocaleString()} RWF`;
}

const RISK_CONFIG = {
  low:     { color: colors.income,   label: 'Low risk',    icon: 'shield-checkmark-outline' as const },
  medium:  { color: colors.warning,  label: 'Watch out',   icon: 'warning-outline' as const },
  high:    { color: colors.expense,  label: 'High risk',   icon: 'alert-circle-outline' as const },
  no_data: { color: colors.textMuted, label: 'No data yet', icon: 'help-circle-outline' as const },
};

type Nav = BottomTabNavigationProp<AppTabParamList>;

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

  const risk = status ? RISK_CONFIG[status.risk_level] ?? RISK_CONFIG.no_data : null;

  // Build trend chart data based on selected view
  const trendData = useMemo(() => {
    if (trendView === 'daily') {
      if (!daily || daily.length === 0) return null;
      const sorted = [...daily].reverse(); // backend returns DESC, reverse to ASC
      return {
        labels: sorted.map((d) => new Date(d.date).getDate().toString()), // Day of month
        datasets: [
          { data: sorted.map((d) => d.total_income), color: () => colors.income, strokeWidth: 2 },
          { data: sorted.map((d) => d.total_expense), color: () => colors.expense, strokeWidth: 2 },
        ],
        legend: ['Income', 'Expense'],
      };
    } else {
      // Monthly view
      if (!monthly || monthly.length === 0) return null;
      const sorted = [...monthly].reverse(); // backend returns DESC, reverse to ASC
      return {
        labels: sorted.map((m) => m.period.slice(5)), // MM
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
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetchStatus} />
        }
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>{greeting},</Text>
            <Text style={styles.name}>{user?.display_name ?? user?.email ?? 'there'} 👋</Text>
          </View>
          {risk && (
            <View style={[styles.riskBadge, { backgroundColor: risk.color + '22' }]}>
              <Ionicons name={risk.icon} size={14} color={risk.color} />
              <Text style={[styles.riskText, { color: risk.color }]}>{risk.label}</Text>
            </View>
          )}
        </View>

        {statusError && (
          <ErrorBanner message={getErrorMessage(statusErr)} onRetry={refetchStatus} />
        )}

        {/* Summary cards */}
        <View style={styles.cards}>
          <View style={[styles.card, styles.cardIncome]}>
            <Text style={styles.cardLabel}>Income</Text>
            <Text style={[styles.cardAmount, { color: colors.income }]}>
              {statusLoading ? '…' : formatRWF(status?.total_income ?? 0)}
            </Text>
          </View>
          <View style={[styles.card, styles.cardExpense]}>
            <Text style={styles.cardLabel}>Expenses</Text>
            <Text style={[styles.cardAmount, { color: colors.expense }]}>
              {statusLoading ? '…' : formatRWF(status?.total_expense ?? 0)}
            </Text>
          </View>
        </View>

        {/* Net balance */}
        <View style={styles.netCard}>
          <Text style={styles.netLabel}>Net · {status?.period ?? '—'}</Text>
          <Text
            style={[
              styles.netAmount,
              { color: (status?.net_balance ?? 0) >= 0 ? colors.income : colors.expense },
            ]}
          >
            {statusLoading
              ? '…'
              : `${(status?.net_balance ?? 0) >= 0 ? '+' : ''}${formatRWF(status?.net_balance ?? 0)}`}
          </Text>
          {status && status.risk_level !== 'no_data' && (
            <Text style={styles.netSub}>{status.status_message}</Text>
          )}
        </View>

        {/* Spending rate */}
        {status && status.risk_level !== 'no_data' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Spending rate</Text>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(status.expense_rate_pct, 100)}%`,
                    backgroundColor: risk?.color ?? colors.primary,
                  },
                ]}
              />
            </View>
            <Text style={styles.progressLabel}>
              {status.expense_rate_pct.toFixed(0)}% of income spent · {' '}
              {status.days_remaining} days remaining
            </Text>
          </View>
        )}

        {/* ML Predictions */}
        {(status?.predicted_month_end_expense != null || status?.predicted_month_end_income != null) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>ML Forecast (month-end totals)</Text>
            <View style={styles.cards}>
              {status?.predicted_month_end_income != null && (
                <View style={[styles.card, { backgroundColor: colors.successLight }]}>
                  <Text style={styles.cardLabel}>Forecasted total income</Text>
                  <Text style={[styles.cardAmount, { color: colors.income }]}>
                    {formatRWF(Math.abs(status.predicted_month_end_income))}
                  </Text>
                </View>
              )}
              {status?.predicted_month_end_expense != null && (
                <View style={[styles.card, { backgroundColor: colors.errorLight }]}>
                  <Text style={styles.cardLabel}>Forecasted total expense</Text>
                  <Text style={[styles.cardAmount, { color: colors.expense }]}>
                    {formatRWF(Math.abs(status.predicted_month_end_expense))}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.predHint}>
              ML-forecasted month-end balance:{' '}
              <Text
                style={{
                  color:
                    (status?.projected_net ?? 0) >= 0 ? colors.income : colors.expense,
                  fontWeight: '600',
                }}
              >
                {formatRWF(status?.projected_net ?? 0)}
              </Text>
            </Text>
            <Text style={[styles.predHint, { fontSize: 11, marginTop: 4, fontStyle: 'italic' }]}>
              Note: ML predictions are month-end totals based on your spending patterns.
            </Text>
          </View>
        )}

        {/* Top category */}
        {status?.top_category && (
          <View style={styles.topCatRow}>
            <Ionicons name="flame-outline" size={16} color={colors.warning} />
            <Text style={styles.topCatText}>
              Top spend: <Text style={{ fontWeight: '700' }}>{status.top_category}</Text>{' '}
              ({formatRWF(status.top_category_amount)}, {status.top_category_pct.toFixed(0)}%)
            </Text>
          </View>
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
                      {view.charAt(0).toUpperCase() + view.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <LineChart
              data={trendData}
              width={CHART_WIDTH}
              height={160}
              withDots={false}
              withInnerLines={false}
              withOuterLines={false}
              chartConfig={{
                backgroundGradientFrom: colors.surface,
                backgroundGradientTo: colors.surface,
                color: (opacity = 1, index) =>
                  index === 0
                    ? `rgba(34,197,94,${opacity})`
                    : `rgba(239,68,68,${opacity})`,
                labelColor: () => colors.textSecondary,
                decimalPlaces: 0,
                propsForLabels: { fontSize: 10 },
              }}
              style={{ borderRadius: radius.md }}
              bezier
            />
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

        {/* Unmatched alert */}
        {(status?.unmatched_expense_count ?? 0) > 0 && (
          <TouchableOpacity
            style={styles.alertCard}
            onPress={() => navigation.navigate('TransactionsTab')}
          >
            <Ionicons name="receipt-outline" size={18} color={colors.warning} />
            <Text style={styles.alertText}>
              {status!.unmatched_expense_count} expense{status!.unmatched_expense_count > 1 ? 's' : ''} need categorization
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.warning} />
          </TouchableOpacity>
        )}

        {/* Recent transactions */}
        {recentTx.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent activity</Text>
              <TouchableOpacity onPress={() => navigation.navigate('TransactionsTab')}>
                <Text style={styles.seeAll}>See all</Text>
              </TouchableOpacity>
            </View>
            {recentTx.map((tx) => (
              <TransactionCard key={tx.id} tx={tx} />
            ))}
          </View>
        )}

        {/* Quick actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick actions</Text>
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.action}
              onPress={() => navigation.navigate('TransactionsTab')}
            >
              <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
              <Text style={styles.actionText}>Import SMS</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.action, { backgroundColor: colors.textSecondary }]}
              onPress={() => navigation.navigate('ReceiptsTab')}
            >
              <Ionicons name="camera-outline" size={18} color="#fff" />
              <Text style={styles.actionText}>Upload Receipt</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.action, { backgroundColor: colors.surface, marginTop: spacing.sm }]}
            onPress={() => navigation.navigate('AnalyticsTab')}
          >
            <Ionicons name="bar-chart-outline" size={18} color={colors.primary} />
            <Text style={[styles.actionText, { color: colors.primary }]}>View Full Analytics</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 40 },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  greeting: { fontSize: 14, color: colors.textSecondary },
  name: { ...typography.h2, color: colors.textPrimary },

  riskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  riskText: { fontSize: 12, fontWeight: '600' },

  cards: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  card: {
    flex: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  cardIncome: { backgroundColor: colors.successLight },
  cardExpense: { backgroundColor: colors.errorLight },
  cardLabel: { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
  cardAmount: { fontSize: 18, fontWeight: '700' },

  netCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  netLabel: { fontSize: 13, color: colors.textSecondary },
  netAmount: { fontSize: 28, fontWeight: '700', marginTop: 4 },
  netSub: { fontSize: 12, color: colors.textMuted, marginTop: 4, textAlign: 'center' },

  section: { marginBottom: spacing.lg },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  seeAll: { fontSize: 13, color: colors.primary, fontWeight: '600' },

  progressBar: {
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  progressFill: { height: '100%', borderRadius: radius.full },
  progressLabel: { fontSize: 12, color: colors.textSecondary },

  predHint: { fontSize: 12, color: colors.textSecondary, marginTop: spacing.sm },

  topCatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#fef3c7',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  topCatText: { flex: 1, fontSize: 13, color: '#92400e' },

  legend: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, color: colors.textSecondary },

  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#fffbeb',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  alertText: { flex: 1, fontSize: 13, color: '#92400e' },

  actions: { flexDirection: 'row', gap: spacing.md },
  action: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  actionText: { color: '#fff', fontWeight: '600', fontSize: 14 },

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
});
