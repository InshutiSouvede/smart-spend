import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { useReceipt, useLinkReceipt, useUnlinkReceipt, useDeleteReceipt } from '../hooks/useReceipts';
import { ErrorBanner } from '../components/ErrorBanner';
import { getErrorMessage } from '../api/client';
import { colors, spacing, radius, fonts } from '../theme';
import type { ReceiptsStackParamList } from '../navigation/AppTabs';
import type { PurchaseDetailOut } from '../types/api';

type RouteParams = RouteProp<ReceiptsStackParamList, 'ReceiptDetail'>;

function formatRWF(amount?: number | null): string {
  if (amount == null) return '—';
  return `${Math.round(amount).toLocaleString()} RWF`;
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return 'Not available';
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function getStatusColor(status: string): string {
  if (status === 'done' || status === 'matched' || status === 'auto_matched' || status === 'user_confirmed') return colors.success;
  if (status === 'pending' || status === 'unmatched') return colors.warning;
  return colors.error;
}

export function ReceiptDetailScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation();
  const { receiptId } = route.params;

  const { data: receipt, isLoading, isError, error, refetch } = useReceipt(receiptId);
  const { mutateAsync: linkReceipt, isPending: isLinking } = useLinkReceipt();
  const { mutateAsync: unlinkReceipt, isPending: isUnlinking } = useUnlinkReceipt();
  const { mutateAsync: deleteReceipt, isPending: isDeleting } = useDeleteReceipt();

  const handleUnlink = async () => {
    if (!receipt?.match) return;
    Alert.alert('Unlink Receipt', 'Are you sure you want to unlink this receipt from the transaction?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlink',
        style: 'destructive',
        onPress: async () => {
          try {
            await unlinkReceipt(receiptId);
            Alert.alert('Success', 'Receipt unlinked successfully');
          } catch (err) {
            Alert.alert('Error', getErrorMessage(err));
          }
        },
      },
    ]);
  };

  const handleDelete = async () => {
    Alert.alert('Delete Receipt', 'Are you sure you want to permanently delete this receipt? This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteReceipt(receiptId);
            Alert.alert('Success', 'Receipt deleted successfully');
            navigation.goBack();
          } catch (err) {
            Alert.alert('Error', getErrorMessage(err));
          }
        },
      },
    ]);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (isError || !receipt) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.errorContainer}>
          <ErrorBanner message={getErrorMessage(error)} onRetry={refetch} />
        </View>
      </SafeAreaView>
    );
  }

  const isMatched =
    receipt.match?.match_status === 'matched' ||
    receipt.match?.match_status === 'auto_matched' ||
    receipt.match?.match_status === 'user_confirmed';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Header summary */}
        <View style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={styles.headerIcon}>
              <Ionicons name="receipt-outline" size={28} color={colors.textSecondary} />
            </View>
            <View style={styles.headerInfo}>
              <Text style={styles.merchant}>{receipt.merchant_name || 'Unknown Merchant'}</Text>
              <Text style={styles.amount}>{formatRWF(receipt.total_amount_rwf)}</Text>
            </View>
          </View>
          {receipt.receipt_timestamp && (
            <View style={styles.infoRow}>
              <Ionicons name="time-outline" size={14} color={colors.textMuted} />
              <Text style={styles.infoLabel}>Purchase Date</Text>
              <Text style={styles.infoValue}>{formatDateTime(receipt.receipt_timestamp)}</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Ionicons name="cloud-upload-outline" size={14} color={colors.textMuted} />
            <Text style={styles.infoLabel}>Uploaded</Text>
            <Text style={styles.infoValue}>{formatDateTime(receipt.uploaded_at)}</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="scan-outline" size={14} color={colors.textMuted} />
            <Text style={styles.infoLabel}>OCR Status</Text>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(receipt.ocr_status) + '18' }]}>
              <Text style={[styles.statusText, { color: getStatusColor(receipt.ocr_status) }]}>
                {receipt.ocr_status.toUpperCase()}
              </Text>
            </View>
            {receipt.ocr_confidence != null && (
              <Text style={styles.confidenceText}>({Math.round(receipt.ocr_confidence * 100)}%)</Text>
            )}
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="document-text-outline" size={14} color={colors.textMuted} />
            <Text style={styles.infoLabel}>Extraction</Text>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(receipt.extraction_status) + '18' }]}>
              <Text style={[styles.statusText, { color: getStatusColor(receipt.extraction_status) }]}>
                {receipt.extraction_status.toUpperCase()}
              </Text>
            </View>
            {receipt.completeness_score != null && (
              <Text style={styles.confidenceText}>({Math.round(receipt.completeness_score * 100)}%)</Text>
            )}
          </View>
          {receipt.parser_source && (
            <View style={styles.infoRow}>
              <Ionicons name="code-outline" size={14} color={colors.textMuted} />
              <Text style={styles.infoLabel}>Parser</Text>
              <Text style={styles.infoValue}>{receipt.parser_source}</Text>
            </View>
          )}
        </View>

        {/* Warnings */}
        {receipt.validation_warnings && receipt.validation_warnings.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Data Quality Issues</Text>
            <View style={styles.warningCard}>
              <View style={styles.warningHeader}>
                <Ionicons name="warning-outline" size={16} color={colors.warning} />
                <Text style={styles.warningTitle}>
                  {receipt.validation_warnings.length} issue{receipt.validation_warnings.length > 1 ? 's' : ''} detected
                </Text>
              </View>
              {receipt.validation_warnings.map((warning: string, index: number) => (
                <View key={index} style={styles.warningItem}>
                  <Text style={styles.warningBullet}>·</Text>
                  <Text style={styles.warningText}>{warning}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Matching */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Transaction Matching</Text>
          <View style={[styles.matchCard, isMatched ? styles.matchedCard : styles.unmatchedCard]}>
            <View style={styles.matchHeader}>
              <Ionicons
                name={isMatched ? 'checkmark-circle' : 'alert-circle-outline'}
                size={20}
                color={isMatched ? colors.success : colors.warning}
              />
              <Text style={styles.matchTitle}>{isMatched ? 'Linked to Transaction' : 'Not Linked'}</Text>
            </View>
            {isMatched ? (
              <>
                <Text style={styles.matchInfo}>
                  Linked to SMS transaction #{receipt.match?.matched_sms_id}
                  {receipt.match?.match_confidence != null
                    ? ` · ${Math.round(receipt.match.match_confidence * 100)}% confidence`
                    : ''}
                </Text>
                <TouchableOpacity
                  style={[styles.unlinkButton, isUnlinking && styles.buttonDisabled]}
                  onPress={handleUnlink}
                  disabled={isUnlinking}
                >
                  {isUnlinking ? (
                    <ActivityIndicator size="small" color={colors.textPrimary} />
                  ) : (
                    <>
                      <Ionicons name="unlink-outline" size={14} color={colors.textPrimary} />
                      <Text style={styles.unlinkButtonText}>Unlink</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.matchInfo}>
                This receipt hasn't been matched to any SMS transaction. Matching happens automatically based on amount, time, and merchant name.
              </Text>
            )}
          </View>
        </View>

        {/* Items */}
        {receipt.purchase_details && receipt.purchase_details.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Items ({receipt.purchase_details.length})</Text>
            <View style={styles.itemsContainer}>
              {receipt.purchase_details.map((item: PurchaseDetailOut) => (
                <View key={item.id} style={styles.itemRow}>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemName}>{item.item_name || 'Unnamed Item'}</Text>
                    {(item.quantity || item.unit) && (
                      <Text style={styles.itemDetail}>Qty: {item.quantity || 1} {item.unit || ''}</Text>
                    )}
                    {item.final_category && (
                      <View style={styles.categoryBadge}>
                        <Text style={styles.categoryText}>{item.final_category}</Text>
                        {item.category_confidence != null && (
                          <Text style={styles.confidenceSmall}>{Math.round(item.category_confidence * 100)}%</Text>
                        )}
                      </View>
                    )}
                  </View>
                  <Text style={styles.itemAmount}>{formatRWF(item.total_cost_rwf)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Empty items state */}
        {(!receipt.purchase_details || receipt.purchase_details.length === 0) && (
          <View style={styles.section}>
            <View style={styles.emptyItems}>
              <Ionicons name="receipt-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>No items extracted</Text>
              <Text style={styles.emptyHint}>
                {receipt.ocr_status === 'pending'
                  ? 'OCR processing is still in progress…'
                  : receipt.ocr_status === 'failed'
                  ? 'OCR processing failed. Please try uploading again.'
                  : 'No items could be extracted from this receipt.'}
              </Text>
            </View>
          </View>
        )}

        {/* Delete */}
        <TouchableOpacity
          style={[styles.deleteButton, isDeleting && styles.buttonDisabled]}
          onPress={handleDelete}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color={colors.error} />
          ) : (
            <>
              <Ionicons name="trash-outline" size={16} color={colors.error} />
              <Text style={styles.deleteButtonText}>Delete Receipt</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 48, paddingTop: spacing.md },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorContainer: { padding: spacing.xl },

  headerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.xl,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.xs,
    backgroundColor: colors.surfaceContainer,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
    flexShrink: 0,
  },
  headerInfo: { flex: 1 },
  merchant: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 17,
    lineHeight: 24,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  amount: {
    fontFamily: fonts.headingBold,
    fontSize: 22,
    lineHeight: 28,
    color: colors.textPrimary,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textMuted,
    flex: 1,
    marginLeft: 2,
  },
  infoValue: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textPrimary,
    textAlign: 'right',
    flexShrink: 1,
  },
  statusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  statusText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
  },
  confidenceText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textMuted,
  },

  section: { marginBottom: spacing.xl },
  sectionTitle: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },

  warningCard: {
    backgroundColor: colors.warningLight,
    borderRadius: radius.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  warningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  warningTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  warningItem: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
  warningBullet: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },
  warningText: {
    fontFamily: fonts.bodyRegular,
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },

  matchCard: {
    borderRadius: radius.xs,
    padding: spacing.md,
    borderWidth: 1,
  },
  matchedCard: {
    backgroundColor: colors.incomeLight,
    borderColor: colors.income + '40',
  },
  unmatchedCard: {
    backgroundColor: colors.warningLight,
    borderColor: colors.border,
  },
  matchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  matchTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  matchInfo: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  unlinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    backgroundColor: colors.surface,
    borderRadius: radius.xs,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    minHeight: 36,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
  },
  unlinkButtonText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textSecondary,
  },
  buttonDisabled: { opacity: 0.5 },

  itemsContainer: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
    minHeight: 52,
  },
  itemInfo: { flex: 1 },
  itemName: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  itemDetail: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  categoryText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    color: colors.textSecondary,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  confidenceSmall: {
    fontFamily: fonts.bodyRegular,
    fontSize: 11,
    color: colors.textMuted,
  },
  itemAmount: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
    flexShrink: 0,
  },

  emptyItems: {
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.xs,
  },
  emptyText: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  emptyHint: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },

  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.xs,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.error + '40',
    minHeight: 48,
    marginBottom: spacing.md,
  },
  deleteButtonText: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 14,
    color: colors.error,
  },
});
