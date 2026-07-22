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
import { colors, spacing, radius, fonts } from '../theme';
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

  const [selectedMonth, setSelectedMonth] = useState(new Date());

  const fromDate = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0).getDate();
  const toDate = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

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
      await correctCategory({ purchase_detail_id: changedPdId, corrected_category: category });
      setCorrecting(null);
      setRecentlyChanged((prev) => new Set(prev).add(changedPdId));
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
              {f === 'all' ? 'All' : f === 'income' ? 'Income' : 'Expenses'}
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
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name="chevron-back"
            size={18}
            color={isTwelveMonthsAgo() ? colors.textMuted : colors.textPrimary}
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
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name="chevron-forward"
            size={18}
            color={isCurrentMonth ? colors.textMuted : colors.textPrimary}
          />
        </TouchableOpacity>
      </View>

      {isError && (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
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
                onPress={(tx) =>
                  navigation.navigate('ItemDetails', {
                    smsTransactionId: tx.id,
                    amount: tx.amount_rwf,
                    merchant: tx.to_who || undefined,
                  })
                }
                onCategoryFix={(pdId, current) => setCorrecting({ pdId, current })}
                highlight={pdId != null && recentlyChanged.has(pdId)}
              />
            );
          }}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <>
              {filter === 'all' && !unmatchedLoading && unmatchedCount > 0 && (
                <View style={styles.unmatchedSection}>
                  <TouchableOpacity
                    style={styles.unmatchedHeader}
                    onPress={() => setShowUnmatched(!showUnmatched)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.unmatchedHeaderLeft}>
                      <Ionicons name="alert-circle" size={18} color={colors.warning} />
                      <Text style={styles.unmatchedTitle}>Unmatched Expenses</Text>
                      <View style={styles.unmatchedBadge}>
                        <Text style={styles.unmatchedBadgeText}>{unmatchedCount}</Text>
                      </View>
                    </View>
                    <Ionicons
                      name={showUnmatched ? 'chevron-up' : 'chevron-down'}
                      size={18}
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
                            View all {unmatchedCount} unmatched expenses
                          </Text>
                          <Ionicons name="arrow-forward" size={14} color={colors.textSecondary} />
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              )}
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
              <Ionicons name="list-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>No transactions</Text>
              <Text style={styles.emptyHint}>Import your MoMo SMS to get started.</Text>
            </View>
          }
          onEndReached={onEndReached}
          onEndReachedThreshold={0.2}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={refetch}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
            ) : null
          }
        />
      )}

      {/* Import SMS FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('SMSImport')}
        activeOpacity={0.85}
      >
        <Ionicons name="cloud-upload-outline" size={18} color={colors.textPrimary} />
        <Text style={styles.fabText}>Import SMS</Text>
      </TouchableOpacity>

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
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    gap: spacing.xxs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    alignItems: 'center',
    minHeight: 36,
    justifyContent: 'center',
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textMuted,
  },
  tabTextActive: {
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },

  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: 44,
  },
  monthNavBtn: {
    padding: spacing.xxs,
    borderRadius: radius.full,
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthNavBtnDisabled: { opacity: 0.35 },
  monthLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
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

  list: {
    paddingTop: spacing.sm,
    paddingHorizontal: 0,
    paddingBottom: 100,
  },

  unmatchedSection: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  unmatchedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 52,
  },
  unmatchedHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  unmatchedTitle: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  unmatchedBadge: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  unmatchedBadgeText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    color: colors.textPrimary,
  },
  unmatchedList: {
    gap: spacing.xxs,
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.xs,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.xxs,
    minHeight: 44,
  },
  viewAllButtonText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textSecondary,
  },

  sectionDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    marginTop: spacing.xxs,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    color: colors.textMuted,
    marginHorizontal: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    minHeight: 200,
    gap: spacing.xs,
  },
  emptyText: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  emptyHint: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },

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
    gap: spacing.xs,
    elevation: 4,
    shadowColor: '#111111',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    minHeight: 44,
  },
  fabText: {
    fontFamily: fonts.headingSemiBold,
    color: colors.textPrimary,
    fontSize: 14,
  },
});
