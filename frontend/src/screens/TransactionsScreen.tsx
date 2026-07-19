import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { useTransactions, useCategoryCorrection } from '../hooks/useTransactions';
import { TransactionCard } from '../components/TransactionCard';
import { UnmatchedExpenseCard } from '../components/UnmatchedExpenseCard';
import { CategoryPicker } from '../components/CategoryPicker';
import { ErrorBanner } from '../components/ErrorBanner';
import { getErrorMessage } from '../api/client';
import { colors, spacing, radius, typography } from '../theme';
import type { TransactionsStackParamList } from '../navigation/AppTabs';
import type { SMSTransactionOut } from '../types/api';
import { useInfiniteQuery } from '@tanstack/react-query';
import { transactionsApi } from '../api/transactions';

type Filter = 'all' | 'income' | 'expense';
type Nav = NativeStackNavigationProp<TransactionsStackParamList, 'TransactionsList'>;

export function TransactionsScreen() {
  const navigation = useNavigation<Nav>();
  const [filter, setFilter] = useState<Filter>('all');
  const [correcting, setCorrecting] = useState<{ pdId: number; current: string } | null>(null);
  const [showUnmatched, setShowUnmatched] = useState(true);
  const [recentlyChanged, setRecentlyChanged] = useState<Set<number>>(new Set());
  const changeTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // ─── Month filter state ────────────────────────────────────────────────────
  const [selectedMonth, setSelectedMonth] = useState(new Date());

  const fromDate = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0).getDate();
  const toDate = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const goToPreviousMonth = () => {
    const newDate = new Date(selectedMonth);
    newDate.setMonth(newDate.getMonth() - 1);
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    if (newDate >= twelveMonthsAgo) {
      setSelectedMonth(newDate);
    }
  };

  const goToNextMonth = () => {
    const newDate = new Date(selectedMonth);
    newDate.setMonth(newDate.getMonth() + 1);
    const now = new Date();
    if (newDate <= now) {
      setSelectedMonth(newDate);
    }
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

  const txParams = {
    ...(filter !== 'all' ? { transaction_type: filter as 'income' | 'expense' } : {}),
    from_date: fromDate,
    to_date: toDate,
  };

  const { data, isLoading, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useTransactions(txParams);

  const { data: unmatchedData, isLoading: unmatchedLoading } = useInfiniteQuery({
    queryKey: ['transactions', 'unmatched'],
    queryFn: ({ pageParam = 1 }) => transactionsApi.listUnmatched({ page: pageParam, page_size: 10 }),
    getNextPageParam: (lastPage) => (lastPage.has_next ? lastPage.page + 1 : undefined),
    initialPageParam: 1,
    enabled: showUnmatched && filter === 'all',
  });

  const { mutateAsync: correctCategory, isPending: correctionPending } = useCategoryCorrection();

  const allTx: SMSTransactionOut[] = data?.pages.flatMap((p) => p.items) ?? [];
  const unmatchedTx: SMSTransactionOut[] = unmatchedData?.pages.flatMap((p) => p.items) ?? [];
  const unmatchedCount = unmatchedTx.length;

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleCategorySelect = async (category: string) => {
    if (!correcting) return;
    const changedPdId = correcting.pdId;
    try {
      await correctCategory({
        purchase_detail_id: changedPdId,
        corrected_category: category,
      });
      setCorrecting(null);

      // Highlight the changed transaction briefly
      setRecentlyChanged((prev) => new Set(prev).add(changedPdId));
      // Clear any existing timer for this item
      const existing = changeTimers.current.get(changedPdId);
      if (existing) clearTimeout(existing);
      changeTimers.current.set(
        changedPdId,
        setTimeout(() => {
          setRecentlyChanged((prev) => {
            const next = new Set(prev);
            next.delete(changedPdId);
            return next;
          });
          changeTimers.current.delete(changedPdId);
        }, 1500),
      );
    } catch (e) {
      Alert.alert('Error', getErrorMessage(e));
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Filter tabs */}
      <View style={styles.tabs}>
        {(['all', 'income', 'expense'] as Filter[]).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.tab, filter === f && styles.tabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Month navigation */}
      <View style={styles.monthNav}>
        <TouchableOpacity
          onPress={goToPreviousMonth}
          disabled={isTwelveMonthsAgo()}
          style={[styles.monthNavBtn, isTwelveMonthsAgo() && styles.monthNavBtnDisabled]}
        >
          <Ionicons
            name="chevron-back"
            size={20}
            color={isTwelveMonthsAgo() ? colors.textMuted : colors.primary}
          />
        </TouchableOpacity>
        <View style={styles.monthLabelContainer}>
          <Text style={styles.monthLabelText}>{monthLabel}</Text>
          {isCurrentMonth && <Text style={styles.monthBadge}>Current</Text>}
        </View>
        <TouchableOpacity
          onPress={goToNextMonth}
          disabled={isCurrentMonth}
          style={[styles.monthNavBtn, isCurrentMonth && styles.monthNavBtnDisabled]}
        >
          <Ionicons
            name="chevron-forward"
            size={20}
            color={isCurrentMonth ? colors.textMuted : colors.primary}
          />
        </TouchableOpacity>
      </View>

      {isError && (
        <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.md }}>
          <ErrorBanner message={getErrorMessage(error)} onRetry={refetch} />
        </View>
      )}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={allTx}
          keyExtractor={(tx) => String(tx.id)}
          renderItem={({ item }) => {
            const pdId = item.purchase_details?.[0]?.id;
            return (
              <TransactionCard
                tx={item}
                onPress={(tx) => {
                  navigation.navigate('ItemDetails', {
                    smsTransactionId: tx.id,
                    amount: tx.amount_rwf,
                    merchant: tx.to_who || undefined,
                  });
                }}
                onCategoryFix={(pdId, current) => setCorrecting({ pdId, current })}
                highlight={pdId != null && recentlyChanged.has(pdId)}
              />
            );
          }}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <>
              {/* Unmatched Expenses Section */}
              {filter === 'all' && !unmatchedLoading && unmatchedCount > 0 && (
                <View style={styles.unmatchedSection}>
                  <TouchableOpacity
                    style={styles.unmatchedHeader}
                    onPress={() => setShowUnmatched(!showUnmatched)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.unmatchedHeaderLeft}>
                      <Ionicons name="alert-circle" size={20} color={colors.warning} />
                      <Text style={styles.unmatchedTitle}>
                        Unmatched Expenses
                      </Text>
                      <View style={styles.unmatchedBadge}>
                        <Text style={styles.unmatchedBadgeText}>{unmatchedCount}</Text>
                      </View>
                    </View>
                    <Ionicons
                      name={showUnmatched ? 'chevron-up' : 'chevron-down'}
                      size={20}
                      color={colors.textMuted}
                    />
                  </TouchableOpacity>
                  {showUnmatched && (
                    <View style={styles.unmatchedList}>
                      {unmatchedTx.slice(0, 5).map((tx) => (
                        <UnmatchedExpenseCard key={tx.id} tx={tx} />
                      ))}
                      {unmatchedCount > 5 && (
                        <TouchableOpacity
                          style={styles.viewAllButton}
                          onPress={() => navigation.navigate('UnmatchedExpenses')}
                        >
                          <Text style={styles.viewAllButtonText}>
                            View All {unmatchedCount} Unmatched Expenses
                          </Text>
                          <Ionicons name="arrow-forward" size={16} color={colors.primary} />
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              )}
              {/* Section Divider */}
              {filter === 'all' && unmatchedCount > 0 && (
                <View style={styles.sectionDivider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>All Transactions</Text>
                  <View style={styles.dividerLine} />
                </View>
              )}
            </>
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No transactions yet.</Text>
              <Text style={styles.emptyHint}>Import your MoMo SMS to get started.</Text>
            </View>
          }
          onEndReached={onEndReached}
          onEndReachedThreshold={0.2}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} />}
          ListFooterComponent={
            isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} /> : null
          }
        />
      )}

      {/* Import SMS FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('SMSImport')}
        activeOpacity={0.85}
      >
        <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
        <Text style={styles.fabText}>Import SMS</Text>
      </TouchableOpacity>

      {/* Category correction picker */}
      <CategoryPicker
        visible={correcting !== null}
        current={correcting?.current}
        isSubmitting={correctionPending}
        onClose={() => !correctionPending && setCorrecting(null)}
        onSelect={handleCategorySelect}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: colors.primaryLight },
  tabText: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
  tabTextActive: { color: colors.primary, fontWeight: '700' },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  monthNavBtn: {
    padding: spacing.xs,
    borderRadius: radius.full,
  },
  monthNavBtnDisabled: {
    opacity: 0.4,
  },
  monthLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  monthLabelText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  monthBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  list: {
    padding: spacing.lg,
    paddingBottom: 100,
  },
  unmatchedSection: {
    marginBottom: spacing.lg,
  },
  unmatchedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unmatchedHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  unmatchedTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  unmatchedBadge: {
    backgroundColor: colors.warning,
    borderRadius: radius.full,
    minWidth: 22,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unmatchedBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  unmatchedList: {
    gap: spacing.sm,
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
    marginTop: spacing.xs,
  },
  viewAllButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  sectionDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
    marginTop: spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginHorizontal: spacing.md,
    textTransform: 'uppercase',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    minHeight: 200,
  },
  emptyText: { ...typography.h3, color: colors.textSecondary, textAlign: 'center' },
  emptyHint: { fontSize: 13, color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    gap: spacing.sm,
    elevation: 4,
    shadowColor: colors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
