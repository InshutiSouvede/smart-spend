import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BarChart } from 'react-native-chart-kit';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

import { useAnalyticsSummary } from '../hooks/useAnalytics';
import { useAuthStore } from '../store/authStore';
import { ErrorBanner } from '../components/ErrorBanner';
import { getErrorMessage } from '../api/client';
import { colors, spacing, radius, typography } from '../theme';
import type { AppTabParamList } from '../navigation/AppTabs';
import type { CategorySummary } from '../types/api';

const { width } = Dimensions.get('window');

function formatRWF(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M RWF`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K RWF`;
  return `${Math.round(amount).toLocaleString()} RWF`;
}

function monthRange(): { start: string; end: string } {
  const now = new Date();
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const end = now.toISOString().slice(0, 10);
  return { start, end };
}

type Nav = BottomTabNavigationProp<AppTabParamList>;

export function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  const navigation = useNavigation<Nav>();
  const { start, end } = useMemo(monthRange, []);

  const { data, isLoading, isError, error, refetch, isRefetching } = useAnalyticsSummary(start, end);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  const topCategories: CategorySummary[] = data?.categories.slice(0, 6) ?? [];
  const chartData = {
    labels: topCategories.map((c) => c.category.slice(0, 8)),
    datasets: [{ data: topCategories.map((c) => c.total_rwf) }],
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>{greeting},</Text>
            <Text style={styles.name}>{user?.display_name ?? user?.email ?? 'there'} 👋</Text>
          </View>
          <Text style={styles.monthLabel}>
            {new Date().toLocaleString(undefined, { month: 'long', year: 'numeric' })}
          </Text>
        </View>

        {isError && (
          <ErrorBanner
            message={getErrorMessage(error)}
            onRetry={refetch}
          />
        )}

        {/* Summary cards */}
        <View style={styles.cards}>
          <View style={[styles.card, styles.cardIncome]}>
            <Text style={styles.cardLabel}>Income</Text>
            <Text style={[styles.cardAmount, { color: colors.income }]}>
              {isLoading ? '…' : formatRWF(data?.total_income_rwf ?? 0)}
            </Text>
          </View>
          <View style={[styles.card, styles.cardExpense]}>
            <Text style={styles.cardLabel}>Expenses</Text>
            <Text style={[styles.cardAmount, { color: colors.expense }]}>
              {isLoading ? '…' : formatRWF(data?.total_expense_rwf ?? 0)}
            </Text>
          </View>
        </View>

        {/* Net balance */}
        <View style={styles.netCard}>
          <Text style={styles.netLabel}>Net this month</Text>
          <Text
            style={[
              styles.netAmount,
              { color: (data?.net_rwf ?? 0) >= 0 ? colors.income : colors.expense },
            ]}
          >
            {isLoading
              ? '…'
              : `${(data?.net_rwf ?? 0) >= 0 ? '+' : ''}${formatRWF(data?.net_rwf ?? 0)}`}
          </Text>
          <Text style={styles.netSub}>{data?.transaction_count ?? 0} transactions</Text>
        </View>

        {/* Category chart */}
        {topCategories.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Spending by category</Text>
            <BarChart
              data={chartData}
              width={width - spacing.xl * 2}
              height={180}
              yAxisLabel=""
              yAxisSuffix=""
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
              <Text style={styles.actionText}>Import SMS</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.action}
              onPress={() => navigation.navigate('ReceiptsTab')}
            >
              <Text style={styles.actionText}>Upload Receipt</Text>
            </TouchableOpacity>
          </View>
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
    alignItems: 'flex-end',
    marginBottom: spacing.lg,
  },
  greeting: { fontSize: 14, color: colors.textSecondary },
  name: { ...typography.h2, color: colors.textPrimary },
  monthLabel: { fontSize: 13, color: colors.textSecondary },
  cards: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
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
  netSub: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  section: { marginBottom: spacing.lg },
  sectionTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.md },
  action: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  actionText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
