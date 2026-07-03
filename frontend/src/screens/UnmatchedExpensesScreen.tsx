import React, { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { useInfiniteQuery } from '@tanstack/react-query';
import { transactionsApi } from '../api/transactions';
import { UnmatchedExpenseCard } from '../components/UnmatchedExpenseCard';
import { ErrorBanner } from '../components/ErrorBanner';
import { getErrorMessage } from '../api/client';
import { colors, spacing, radius, typography } from '../theme';
import type { TransactionsStackParamList } from '../navigation/AppTabs';
import type { SMSTransactionOut } from '../types/api';

type Nav = NativeStackNavigationProp<TransactionsStackParamList, 'UnmatchedExpenses'>;

export function UnmatchedExpensesScreen() {
  const navigation = useNavigation<Nav>();

  const { data, isLoading, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isRefetching } =
    useInfiniteQuery({
      queryKey: ['transactions', 'unmatched'],
      queryFn: ({ pageParam = 1 }) => transactionsApi.listUnmatched({ page: pageParam, page_size: 20 }),
      getNextPageParam: (lastPage) => (lastPage.has_next ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
    });

  const allTx: SMSTransactionOut[] = data?.pages.flatMap((p) => p.items) ?? [];

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
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
          renderItem={({ item }) => <UnmatchedExpenseCard tx={item} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="checkmark-circle-outline" size={64} color={colors.income} />
              <Text style={styles.emptyTitle}>All caught up!</Text>
              <Text style={styles.emptyText}>
                All your expenses have been identified and categorized.
              </Text>
            </View>
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={styles.footer}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null
          }
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.xl, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  footer: { paddingVertical: spacing.lg },
  emptyTitle: { ...typography.h2, color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.sm },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', maxWidth: 280 },
});
