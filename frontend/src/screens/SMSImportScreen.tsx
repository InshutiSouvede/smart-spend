/**
 * SMS Import screen.
 *
 * Flow:
 *  1. Check if native SMS module is available (requires dev build).
 *  2. Request READ_SMS permission.
 *  3. Load SMS from device inbox filtered by date.
 *  4. Display conversations grouped by sender.
 *  5. User selects individual messages or entire conversations.
 *  6. Preview selected messages and confirm consent.
 *  7. Upload to API — NEVER automatic.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import {
  isSMSNativeAvailable,
  requestSMSPermission,
  checkSMSPermission,
  readSMS,
  groupByConversation,
  formatSMSDate,
  showSMSDiagnostics,
  type DeviceSMS,
  type SMSConversation,
} from '../services/smsService';
import { useSyncSMS } from '../hooks/useTransactions';
import { useAuthStore } from '../store/authStore';
import { getErrorMessage } from '../api/client';
import { colors, spacing, radius, fonts } from '../theme';

/** Number of messages sent per API request to avoid timeouts. */
const BATCH_SIZE = 50;

function isoToMs(iso: string | null | undefined): number {
  if (!iso) return Date.now() - 30 * 24 * 60 * 60 * 1000;
  return new Date(iso).getTime();
}

export function SMSImportScreen() {
  const lastImportAt = useAuthStore((s) => s.lastSmsImportAt);
  const setLastSmsImportAt = useAuthStore((s) => s.setLastSmsImportAt);

  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [conversations, setConversations] = useState<SMSConversation[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterFromMs, setFilterFromMs] = useState<number | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  const { mutateAsync: syncSMS } = useSyncSMS();

  useEffect(() => {
    if (!isSMSNativeAvailable) return;
    checkSMSPermission().then(setPermissionGranted);
  }, []);

  const handleRequestPermission = async () => {
    const granted = await requestSMSPermission();
    setPermissionGranted(granted);
    if (granted) loadMessages();
  };

  const loadMessages = useCallback(async () => {
    if (!permissionGranted) return;
    setLoadingMessages(true);
    try {
      const filter: { minDate?: number; maxCount: number } = { maxCount: 500 };
      if (filterFromMs !== null) filter.minDate = filterFromMs;
      const msgs = await readSMS(filter);
      setConversations(groupByConversation(msgs));
    } catch (e) {
      Alert.alert('Error loading SMS', getErrorMessage(e));
    } finally {
      setLoadingMessages(false);
    }
  }, [permissionGranted, filterFromMs]);

  useEffect(() => {
    if (permissionGranted) loadMessages();
  }, [permissionGranted, loadMessages]);

  const allIdsInConv = (conv: SMSConversation) => conv.messages.map((m) => m._id);
  const isConvFullySelected = (conv: SMSConversation) =>
    allIdsInConv(conv).every((id) => selected.has(id));

  const toggleConversation = (conv: SMSConversation) => {
    const ids = allIdsInConv(conv);
    const allSelected = isConvFullySelected(conv);
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const toggleMessage = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedMessages = useMemo((): DeviceSMS[] => {
    const all = conversations.flatMap((c) => c.messages);
    return all.filter((m) => selected.has(m._id));
  }, [conversations, selected]);

  const handleUpload = async () => {
    if (!consentChecked) return;
    setUploadError(null);

    // Map all selected messages to the API shape up front.
    const allMessages = selectedMessages.map((m) => ({
      raw_sms_text: m.body,
      source_message_id: String(m._id),
      sender: m.address,
      sms_time: new Date(parseInt(m.date, 10)).toISOString(),
    }));

    // Split into BATCH_SIZE chunks so each request completes well within
    // the server timeout even on slow connections.
    const batches: (typeof allMessages)[] = [];
    for (let i = 0; i < allMessages.length; i += BATCH_SIZE) {
      batches.push(allMessages.slice(i, i + BATCH_SIZE));
    }

    setBatchProgress({ current: 0, total: batches.length });

    // Accumulate results across all batches.
    let totalImported = 0;
    let totalDuplicates = 0;
    let totalFailed = 0;
    let totalSensitive = 0;
    let lastImportAt: string | null | undefined = null;

    try {
      for (let i = 0; i < batches.length; i++) {
        setBatchProgress({ current: i + 1, total: batches.length });
        const res = await syncSMS({
          consent_confirmed: true,
          messages: batches[i],
        });
        totalImported   += res.imported.length;
        totalDuplicates += res.duplicates_skipped;
        totalFailed     += res.failed.length;
        totalSensitive  += res.sensitive_warnings.length;
        if (res.last_import_at) lastImportAt = res.last_import_at;
      }

      if (lastImportAt) {
        await setLastSmsImportAt(lastImportAt);
      }

      setBatchProgress(null);
      setPreviewVisible(false);
      setSelected(new Set());
      setConsentChecked(false);

      const summary = [
        `${totalImported} imported`,
        totalDuplicates > 0 ? `${totalDuplicates} duplicates skipped` : null,
        totalSensitive > 0 ? `${totalSensitive} sensitive messages not stored` : null,
        totalFailed > 0 ? `${totalFailed} could not be parsed` : null,
      ]
        .filter(Boolean)
        .join('\n');
      Alert.alert('Import complete', summary);
    } catch (e) {
      // Some batches may have succeeded before the error — report that to the
      // user instead of showing a misleading generic network error.
      const saved = totalImported > 0
        ? `\n\n${totalImported} message${totalImported !== 1 ? 's were' : ' was'} already saved before this error.`
        : '';
      setBatchProgress(null);
      setUploadError(`${getErrorMessage(e)}${saved}`);
    }
  };

  // Dev-build notice
  if (!isSMSNativeAvailable) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.notice}>
          <View style={styles.noticeIcon}>
            <Ionicons name="alert-circle-outline" size={32} color={colors.textSecondary} />
          </View>
          <Text style={styles.noticeTitle}>SMS Reader Unavailable</Text>
          <Text style={styles.noticeBody}>
            The native SMS reader is not available in this build.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={showSMSDiagnostics}>
            <Text style={styles.primaryButtonText}>Show Diagnostics</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Permission request
  if (permissionGranted === false) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.notice}>
          <View style={styles.noticeIcon}>
            <Ionicons name="lock-closed-outline" size={32} color={colors.textSecondary} />
          </View>
          <Text style={styles.noticeTitle}>SMS Permission Needed</Text>
          <Text style={styles.noticeBody}>
            SmartSpend needs permission to read your SMS inbox to find MoMo transaction messages.
            Your messages are <Text style={styles.bold}>never uploaded without your explicit confirmation.</Text>
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={handleRequestPermission}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.textPrimary} />
            <Text style={styles.primaryButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const FilterBar = () => (
    <View style={styles.filterBar}>
      <Text style={styles.filterLabel}>
        From: {filterFromMs !== null ? new Date(filterFromMs).toLocaleDateString() : 'All time'}
      </Text>
      <View style={styles.filterActions}>
        <TouchableOpacity
          onPress={() => setFilterFromMs(null)}
          style={[styles.chip, filterFromMs === null && styles.chipActive]}
        >
          <Text style={[styles.chipText, filterFromMs === null && styles.chipTextActive]}>All</Text>
        </TouchableOpacity>
        {[7, 30, 90].map((days) => {
          const ms = Date.now() - days * 86_400_000;
          const isActive = filterFromMs !== null && Math.abs(filterFromMs - ms) < 86_400_000;
          return (
            <TouchableOpacity
              key={days}
              onPress={() => setFilterFromMs(ms)}
              style={[styles.chip, isActive && styles.chipActive]}
            >
              <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{days}d</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FilterBar />

      {loadingMessages ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>Reading SMS inbox…</Text>
        </View>
      ) : conversations.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="chatbox-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>No SMS messages found in this date range.</Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(c) => c.address}
          contentContainerStyle={styles.list}
          renderItem={({ item: conv }) => {
            const isExpanded = expanded.has(conv.address);
            const fullySelected = isConvFullySelected(conv);
            const someSelected = conv.messages.some((m) => selected.has(m._id));

            return (
              <View style={styles.convBlock}>
                <TouchableOpacity
                  style={styles.convHeader}
                  onPress={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(conv.address)) next.delete(conv.address);
                      else next.add(conv.address);
                      return next;
                    })
                  }
                  activeOpacity={0.75}
                >
                  <TouchableOpacity
                    style={[styles.checkbox, (fullySelected || someSelected) && styles.checkboxActive]}
                    onPress={() => toggleConversation(conv)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    {fullySelected && <Ionicons name="checkmark" size={12} color={colors.textPrimary} />}
                    {!fullySelected && someSelected && <View style={styles.checkboxPartial} />}
                  </TouchableOpacity>
                  <View style={styles.convInfo}>
                    <Text style={styles.convAddress} numberOfLines={1}>{conv.displayName}</Text>
                    <Text style={styles.convMeta}>
                      {conv.messages.length} message{conv.messages.length !== 1 ? 's' : ''} · {formatSMSDate(conv.latestDate)}
                    </Text>
                  </View>
                  <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
                </TouchableOpacity>

                {isExpanded && conv.messages.map((msg) => (
                  <TouchableOpacity
                    key={msg._id}
                    style={[styles.msgRow, selected.has(msg._id) && styles.msgRowSelected]}
                    onPress={() => toggleMessage(msg._id)}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.checkbox, selected.has(msg._id) && styles.checkboxActive, { width: 18, height: 18 }]}>
                      {selected.has(msg._id) && <Ionicons name="checkmark" size={11} color={colors.textPrimary} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.msgBody} numberOfLines={2}>{msg.body}</Text>
                      <Text style={styles.msgDate}>{new Date(parseInt(msg.date, 10)).toLocaleString()}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            );
          }}
        />
      )}

      {selected.size > 0 && (
        <View style={styles.actionBar}>
          <Text style={styles.selectedCount}>{selected.size} selected</Text>
          <TouchableOpacity style={styles.previewButton} onPress={() => setPreviewVisible(true)} activeOpacity={0.85}>
            <Text style={styles.previewButtonText}>Preview & Upload</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal
        visible={previewVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Review before upload</Text>
            <TouchableOpacity onPress={() => setPreviewVisible(false)}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={{ padding: spacing.lg }}>
            <View style={styles.summaryBox}>
              <Text style={styles.summaryText}>
                You are about to upload{' '}
                <Text style={styles.bold}>{selectedMessages.length} messages</Text> from{' '}
                <Text style={styles.bold}>{new Set(selectedMessages.map((m) => m.address)).size} sender(s)</Text>{' '}
                to SmartSpend for analysis.
              </Text>
            </View>

            <Text style={styles.sectionLabel}>Selected messages</Text>
            {selectedMessages.slice(0, 20).map((msg) => (
              <View key={msg._id} style={styles.previewMsg}>
                <Text style={styles.previewSender}>{msg.address}</Text>
                <Text style={styles.previewBody}>{msg.body}</Text>
              </View>
            ))}
            {selectedMessages.length > 20 && (
              <Text style={styles.moreText}>… and {selectedMessages.length - 20} more.</Text>
            )}

            {uploadError && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{uploadError}</Text>
              </View>
            )}

            <View style={styles.consentRow}>
              <Switch
                value={consentChecked}
                onValueChange={setConsentChecked}
                trackColor={{ true: colors.primary, false: colors.border }}
                thumbColor={consentChecked ? colors.textPrimary : colors.surface}
                ios_backgroundColor={colors.border}
              />
              <Text style={styles.consentLabel}>
                I confirm I want to upload these messages to SmartSpend for transaction analysis.
              </Text>
            </View>
          </ScrollView>

          <View style={styles.modalFooter}>
            {batchProgress !== null && (
              <View style={styles.batchProgressContainer}>
                <Text style={styles.batchProgressText}>
                  Processing batch {batchProgress.current} of {batchProgress.total} — please be patient…
                </Text>
                <View style={styles.batchProgressBar}>
                  <View
                    style={[
                      styles.batchProgressFill,
                      {
                        width: `${Math.round(
                          (batchProgress.current / batchProgress.total) * 100,
                        )}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            )}
            <TouchableOpacity
              style={[styles.uploadButton, (!consentChecked || batchProgress !== null) && styles.uploadButtonDisabled]}
              onPress={handleUpload}
              disabled={!consentChecked || batchProgress !== null}
              activeOpacity={0.85}
            >
              {batchProgress !== null ? (
                <ActivityIndicator color={colors.textPrimary} />
              ) : (
                <Text style={styles.uploadButtonText}>Upload {selectedMessages.length} messages</Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  notice: {
    flex: 1,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  noticeIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainer,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  noticeTitle: {
    fontFamily: fonts.headingBold,
    fontSize: 20,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  noticeBody: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 300,
  },
  bold: { fontFamily: fonts.bodySemiBold },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.xs,
    paddingVertical: 13,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
    minHeight: 48,
  },
  primaryButtonText: {
    fontFamily: fonts.headingSemiBold,
    color: colors.textPrimary,
    fontSize: 15,
  },

  filterBar: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filterLabel: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textMuted,
    flexShrink: 1,
  },
  filterActions: { flexDirection: 'row', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderMuted,
  },
  chipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.textMuted },
  chipTextActive: { fontFamily: fonts.bodySemiBold, color: colors.textPrimary },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  loadingText: { fontFamily: fonts.bodyRegular, marginTop: spacing.xs, color: colors.textMuted, fontSize: 14 },
  emptyText: { fontFamily: fonts.bodyRegular, color: colors.textMuted, fontSize: 14, textAlign: 'center' },

  list: { padding: spacing.md, paddingBottom: 100 },
  convBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginBottom: spacing.xs,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  convHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.xs,
    borderWidth: 1.5,
    borderColor: colors.borderMuted,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    backgroundColor: colors.surface,
  },
  checkboxActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxPartial: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: colors.textPrimary,
  },
  convInfo: { flex: 1 },
  convAddress: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.textPrimary },
  convMeta: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.textMuted, marginTop: 1 },

  msgRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  msgRowSelected: { backgroundColor: colors.primaryLight },
  msgBody: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.textPrimary, lineHeight: 18 },
  msgDate: { fontFamily: fonts.bodyRegular, fontSize: 11, color: colors.textMuted, marginTop: 2 },

  actionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    elevation: 8,
  },
  selectedCount: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.textPrimary },
  previewButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.xs,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    minHeight: 40,
    justifyContent: 'center',
  },
  previewButtonText: { fontFamily: fonts.headingSemiBold, color: colors.textPrimary, fontSize: 14 },

  modal: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  modalTitle: { fontFamily: fonts.headingSemiBold, fontSize: 18, color: colors.textPrimary },
  modalScroll: { flex: 1 },

  summaryBox: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  summaryText: { fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.textSecondary, lineHeight: 22 },
  sectionLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  previewMsg: {
    backgroundColor: colors.surface,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  previewSender: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.textSecondary, marginBottom: 3 },
  previewBody: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.textPrimary, lineHeight: 18 },
  moreText: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.textMuted, textAlign: 'center', marginVertical: spacing.md },

  errorBox: {
    backgroundColor: colors.errorLight,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: '#F0CACA',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.error },

  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  consentLabel: { fontFamily: fonts.bodyRegular, flex: 1, fontSize: 13, color: colors.textPrimary, lineHeight: 20 },

  modalFooter: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  uploadButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.xs,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 50,
    justifyContent: 'center',
  },
  uploadButtonDisabled: { opacity: 0.45 },
  uploadButtonText: { fontFamily: fonts.headingSemiBold, color: colors.textPrimary, fontSize: 15 },

  batchProgressContainer: {
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  batchProgressText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  batchProgressBar: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  batchProgressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: radius.full,
  },
});
