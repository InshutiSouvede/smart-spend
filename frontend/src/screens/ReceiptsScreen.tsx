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

import { useReceipts } from '../hooks/useReceipts';
import { ReceiptCard } from '../components/ReceiptCard';
import { ErrorBanner } from '../components/ErrorBanner';
import { getErrorMessage } from '../api/client';
import { colors, spacing, radius, fonts } from '../theme';
import type { ReceiptsStackParamList } from '../navigation/AppTabs';
import type { ReceiptSummary } from '../types/api';

type Nav = NativeStackNavigationProp<ReceiptsStackParamList, 'ReceiptsList'>;

export function ReceiptsScreen() {
  const navigation = useNavigation<Nav>();

  const { data, isLoading, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useReceipts();

  const allReceipts: ReceiptSummary[] = data?.pages.flatMap((p) => p.items) ?? [];

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {isError && (
        <View style={styles.errorBanner}>
          <ErrorBanner message={getErrorMessage(error)} onRetry={refetch} />
        </View>
      )}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={allReceipts}
          keyExtractor={(r) => `receipt-${r.receipt_id}`}
          extraData={allReceipts.length}
          renderItem={({ item }) => (
            <ReceiptCard
              receipt={item}
              onPress={() => navigation.navigate('ReceiptDetail', { receiptId: item.receipt_id })}
            />
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="receipt-outline" size={44} color={colors.textMuted} />
              <Text style={styles.emptyText}>No receipts yet</Text>
              <Text style={styles.emptyHint}>
                Tap the button below to photograph or upload a receipt.
              </Text>
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

      {/* Upload FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('ReceiptUpload')}
        activeOpacity={0.85}
      >
        <Ionicons name="camera-outline" size={18} color={colors.textPrimary} />
        <Text style={styles.fabText}>Upload Receipt</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  errorBanner: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  list: {
    paddingTop: spacing.xs,
    paddingBottom: 100,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    minHeight: 300,
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
    lineHeight: 18,
    maxWidth: 260,
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
