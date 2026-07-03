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
import { colors, spacing, radius, typography } from '../theme';
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
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusColor(status: string): string {
  if (status === 'done' || status === 'matched' || status === 'auto_matched' || status === 'user_confirmed') {
    return colors.success;
  }
  if (status === 'pending' || status === 'unmatched') {
    return colors.warning;
  }
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

    Alert.alert(
      'Unlink Receipt',
      'Are you sure you want to unlink this receipt from the transaction?',
      [
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
      ]
    );
  };

  const handleDelete = async () => {
    Alert.alert(
      'Delete Receipt',
      'Are you sure you want to permanently delete this receipt? This action cannot be undone.',
      [
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
      ]
    );
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

  const isMatched = receipt.match?.match_status === 'matched' || 
                    receipt.match?.match_status === 'auto_matched' || 
                    receipt.match?.match_status === 'user_confirmed';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Header Info */}
        <View style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={styles.headerIcon}>
              <Ionicons name="receipt-outline" size={32} color={colors.primary} />
            </View>
            <View style={styles.headerInfo}>
              <Text style={styles.merchant}>
                {receipt.merchant_name || 'Unknown Merchant'}
              </Text>
              <Text style={styles.amount}>{formatRWF(receipt.total_amount_rwf)}</Text>
            </View>
          </View>

          {/* Purchase Date */}
          {receipt.receipt_timestamp && (
            <View style={styles.infoRow}>
              <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.infoLabel}>Purchase Date:</Text>
              <Text style={styles.infoValue}>{formatDateTime(receipt.receipt_timestamp)}</Text>
            </View>
          )}

          {/* Upload Date */}
          <View style={styles.infoRow}>
            <Ionicons name="cloud-upload-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.infoLabel}>Uploaded:</Text>
            <Text style={styles.infoValue}>{formatDateTime(receipt.uploaded_at)}</Text>
          </View>

          {/* OCR Status */}
          <View style={styles.infoRow}>
            <Ionicons name="scan-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.infoLabel}>OCR Status:</Text>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(receipt.ocr_status) + '20' }]}>
              <Text style={[styles.statusText, { color: getStatusColor(receipt.ocr_status) }]}>
                {receipt.ocr_status.toUpperCase()}
              </Text>
            </View>
            {receipt.ocr_confidence != null && (
              <Text style={styles.confidenceText}>
                ({Math.round(receipt.ocr_confidence * 100)}%)
              </Text>
            )}
          </View>

          {/* Extraction Status */}
          <View style={styles.infoRow}>
            <Ionicons name="document-text-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.infoLabel}>Extraction:</Text>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(receipt.extraction_status) + '20' }]}>
              <Text style={[styles.statusText, { color: getStatusColor(receipt.extraction_status) }]}>
                {receipt.extraction_status.toUpperCase()}
              </Text>
            </View>
            {receipt.completeness_score != null && (
              <Text style={styles.confidenceText}>
                ({Math.round(receipt.completeness_score * 100)}% complete)
              </Text>
            )}
          </View>

          {/* Parser Source */}
          {receipt.parser_source && (
            <View style={styles.infoRow}>
              <Ionicons name="code-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.infoLabel}>Parser:</Text>
              <Text style={styles.infoValue}>{receipt.parser_source}</Text>
            </View>
          )}
        </View>

        {/* OCR Quality Warnings */}
        {receipt.validation_warnings && receipt.validation_warnings.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Data Quality Issues</Text>
            <View style={styles.warningCard}>
              <View style={styles.warningHeader}>
                <Ionicons name="warning-outline" size={20} color={colors.warning} />
                <Text style={styles.warningTitle}>
                  {receipt.validation_warnings.length} issue{receipt.validation_warnings.length > 1 ? 's' : ''} detected
                </Text>
              </View>
              {receipt.validation_warnings.map((warning, index) => (
                <View key={index} style={styles.warningItem}>
                  <Text style={styles.warningBullet}>•</Text>
                  <Text style={styles.warningText}>{warning}</Text>
                </View>
              ))}
              <View style={styles.warningFooter}>
                <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
                <Text style={styles.warningFooterText}>
                  These issues don't prevent processing but may affect accuracy
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Matching Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Transaction Matching</Text>
          <View style={[styles.matchCard, isMatched ? styles.matchedCard : styles.unmatchedCard]}>
            <View style={styles.matchHeader}>
              <Ionicons 
                name={isMatched ? 'checkmark-circle' : 'alert-circle-outline'} 
                size={24} 
                color={isMatched ? colors.success : colors.warning} 
              />
              <Text style={styles.matchTitle}>
                {isMatched ? 'Linked to Transaction' : 'Not Linked'}
              </Text>
            </View>

            {isMatched ? (
              <>
                <Text style={styles.matchInfo}>
                  This receipt is linked to SMS transaction #{receipt.match?.matched_sms_id}
                </Text>
                {receipt.match?.match_confidence != null && (
                  <Text style={styles.matchConfidence}>
                    Confidence: {Math.round(receipt.match.match_confidence * 100)}%
                  </Text>
                )}
                <TouchableOpacity 
                  style={[styles.unlinkButton, isUnlinking && styles.buttonDisabled]}
                  onPress={handleUnlink}
                  disabled={isUnlinking}
                >
                  {isUnlinking ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="unlink-outline" size={16} color="#fff" />
                      <Text style={styles.unlinkButtonText}>Unlink Transaction</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.matchInfo}>
                  This receipt hasn't been matched to any SMS transaction yet. 
                  The system automatically matches receipts to transactions based on amount, 
                  time, and merchant name.
                </Text>
                <View style={styles.helpBox}>
                  <Ionicons name="information-circle-outline" size={16} color={colors.info} />
                  <Text style={styles.helpText}>
                    Tip: Matching happens automatically when uploading. Manual linking coming soon!
                  </Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* Items List */}
        {receipt.purchase_details && receipt.purchase_details.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Items ({receipt.purchase_details.length})
            </Text>
            {receipt.purchase_details.map((item: PurchaseDetailOut) => (
              <View key={item.id} style={styles.itemCard}>
                <View style={styles.itemHeader}>
                  <Text style={styles.itemName}>
                    {item.item_name || 'Unnamed Item'}
                  </Text>
                  <Text style={styles.itemAmount}>
                    {formatRWF(item.total_cost_rwf)}
                  </Text>
                </View>

                {(item.quantity || item.unit) && (
                  <Text style={styles.itemDetail}>
                    Quantity: {item.quantity || 1} {item.unit || ''}
                  </Text>
                )}

                {item.unit_cost_rwf != null && (
                  <Text style={styles.itemDetail}>
                    Unit Price: {formatRWF(item.unit_cost_rwf)}
                  </Text>
                )}

                {item.final_category && (
                  <View style={styles.categoryRow}>
                    <View style={styles.categoryBadge}>
                      <Text style={styles.categoryText}>{item.final_category}</Text>
                    </View>
                    {item.category_confidence != null && (
                      <Text style={styles.confidenceText}>
                        {Math.round(item.category_confidence * 100)}%
                      </Text>
                    )}
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Empty state for items */}
        {(!receipt.purchase_details || receipt.purchase_details.length === 0) && (
          <View style={styles.section}>
            <View style={styles.emptyItems}>
              <Ionicons name="receipt-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>No items extracted</Text>
              <Text style={styles.emptyHint}>
                {receipt.ocr_status === 'pending' 
                  ? 'OCR processing is still in progress...' 
                  : receipt.ocr_status === 'failed'
                  ? 'OCR processing failed. Please try uploading again.'
                  : 'No items could be extracted from this receipt.'}
              </Text>
            </View>
          </View>
        )}

        {/* Delete Button */}
        <View style={styles.section}>
          <TouchableOpacity 
            style={[styles.deleteButton, isDeleting && styles.buttonDisabled]}
            onPress={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="trash-outline" size={20} color="#fff" />
                <Text style={styles.deleteButtonText}>Delete Receipt</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    padding: spacing.xl,
  },

  // Header Card
  headerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  headerIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  headerInfo: {
    flex: 1,
  },
  merchant: {
    ...typography.h3,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  amount: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.primary,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  infoLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
  },
  infoValue: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
    textAlign: 'right',
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },

  // Section
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },

  // Match Card
  matchCard: {
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 2,
  },
  matchedCard: {
    backgroundColor: colors.successLight,
    borderColor: colors.success,
  },
  unmatchedCard: {
    backgroundColor: colors.warningLight,
    borderColor: colors.warning,
  },
  matchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  matchTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  matchInfo: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  matchConfidence: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  unlinkButton: {
    backgroundColor: colors.error,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  unlinkButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  helpBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.infoLight,
    padding: spacing.sm,
    borderRadius: radius.sm,
    gap: spacing.xs,
  },
  helpText: {
    flex: 1,
    fontSize: 12,
    color: colors.info,
    lineHeight: 18,
  },

  // Item Card
  itemCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  itemName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    marginRight: spacing.sm,
  },
  itemAmount: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
  itemDetail: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  categoryBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
  },
  confidenceText: {
    fontSize: 11,
    color: colors.textMuted,
  },

  // Empty State
  emptyItems: {
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptyText: {
    ...typography.h3,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Warning Card (for OCR quality issues)
  warningCard: {
    backgroundColor: colors.warningLight,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.warning + '40',
  },
  warningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  warningTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.warning,
  },
  warningItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
    paddingLeft: spacing.xs,
  },
  warningBullet: {
    fontSize: 14,
    color: colors.warning,
    marginRight: spacing.xs,
    fontWeight: 'bold',
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 18,
  },
  warningFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.warning + '20',
  },
  warningFooterText: {
    flex: 1,
    fontSize: 11,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },

  // Delete Button
  deleteButton: {
    backgroundColor: colors.error,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    gap: spacing.xs,
    elevation: 2,
    shadowColor: colors.error,
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
