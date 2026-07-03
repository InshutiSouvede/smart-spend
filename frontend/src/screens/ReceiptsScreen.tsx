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
import { colors, spacing, typography } from '../theme';
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
              <Ionicons name="receipt-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>No receipts yet.</Text>
              <Text style={styles.emptyHint}>
                Tap the button below to photograph or choose a receipt.
              </Text>
            </View>
          }
          onEndReached={onEndReached}
          onEndReachedThreshold={0.2}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} />}
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
        <Ionicons name="camera-outline" size={20} color="#fff" />
        <Text style={styles.fabText}>Upload Receipt</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  errorBanner: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  list: { padding: spacing.lg, paddingBottom: 100 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    minHeight: 300,
    gap: spacing.sm,
  },
  emptyText: { ...typography.h3, color: colors.textSecondary, textAlign: 'center' },
  emptyHint: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    backgroundColor: colors.primary,
    borderRadius: 999,
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
