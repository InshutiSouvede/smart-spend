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
  type DeviceSMS,
  type SMSConversation,
} from '../services/smsService';
import { useSyncSMS } from '../hooks/useTransactions';
import { useAuthStore } from '../store/authStore';
import { getErrorMessage } from '../api/client';
import { colors, spacing, radius, typography } from '../theme';

// ─── Date filter helpers ──────────────────────────────────────────────────────

function isoToMs(iso: string | null | undefined): number {
  if (!iso) return Date.now() - 30 * 24 * 60 * 60 * 1000; // default 30 days
  return new Date(iso).getTime();
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SMSImportScreen() {
  const lastImportAt = useAuthStore((s) => s.lastSmsImportAt);
  const setLastSmsImportAt = useAuthStore((s) => s.setLastSmsImportAt);

  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [conversations, setConversations] = useState<SMSConversation[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set()); // set of message _id
  const [filterFromMs, setFilterFromMs] = useState<number>(() => isoToMs(lastImportAt));
  const [previewVisible, setPreviewVisible] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { mutateAsync: syncSMS, isPending: uploading } = useSyncSMS();

  // Check permission on mount
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
      const msgs = await readSMS({ minDate: filterFromMs, maxCount: 500 });
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

  // ─── Selection helpers ────────────────────────────────────────────────────

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

  // ─── Upload ───────────────────────────────────────────────────────────────

  const handleUpload = async () => {
    if (!consentChecked) return;
    setUploadError(null);
    try {
      const payload = {
        consent_confirmed: true,
        messages: selectedMessages.map((m) => ({
          raw_sms_text: m.body,
          source_message_id: String(m._id),
          sender: m.address,
          sms_time: new Date(parseInt(m.date, 10)).toISOString(),
        })),
      };
      console.log('=== SMS Upload Debug ===');
      console.log('Total messages:', payload.messages.length);
      console.log('First message:', JSON.stringify(payload.messages[0], null, 2));
      console.log('Sample raw_sms_text type:', typeof payload.messages[0]?.raw_sms_text);
      console.log('Full payload:', JSON.stringify(payload, null, 2));
      const res = await syncSMS(payload);
      if (res.last_import_at) {
        await setLastSmsImportAt(res.last_import_at);
      }
      setPreviewVisible(false);
      setSelected(new Set());
      setConsentChecked(false);

      const summary = [
        `${res.imported.length} imported`,
        res.duplicates_skipped > 0 ? `${res.duplicates_skipped} duplicates skipped` : null,
        res.sensitive_warnings.length > 0
          ? `${res.sensitive_warnings.length} sensitive messages not stored`
          : null,
        res.failed.length > 0 ? `${res.failed.length} could not be parsed` : null,
      ]
        .filter(Boolean)
        .join('\n');
      Alert.alert('Import complete', summary);
    } catch (e) {
      setUploadError(getErrorMessage(e));
    }
  };

  // ─── Dev-build notice ─────────────────────────────────────────────────────

  if (!isSMSNativeAvailable) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.notice}>
          <Ionicons name="phone-portrait-outline" size={48} color={colors.primary} />
          <Text style={styles.noticeTitle}>Development Build Required</Text>
          <Text style={styles.noticeBody}>
            Reading SMS messages requires the{' '}
            <Text style={styles.bold}>react-native-get-sms-android</Text> native module, which is
            not available in the standard Expo Go app.
          </Text>
          <Text style={styles.noticeBody}>To enable SMS import:</Text>
          <View style={styles.steps}>
            {[
              'npm install -g eas-cli',
              'npx eas build:configure',
              'npx eas build --profile development --platform android',
              'Install the APK on your Android device',
            ].map((step, i) => (
              <Text key={i} style={styles.step}>
                {i + 1}. <Text style={styles.code}>{step}</Text>
              </Text>
            ))}
          </View>
          {Platform.OS !== 'android' && (
            <Text style={[styles.noticeBody, { color: colors.warning, marginTop: spacing.md }]}>
              ⚠ SMS reading is Android-only.
            </Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // ─── Permission request ───────────────────────────────────────────────────

  if (permissionGranted === false) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.notice}>
          <Ionicons name="lock-closed-outline" size={48} color={colors.primary} />
          <Text style={styles.noticeTitle}>SMS Permission Needed</Text>
          <Text style={styles.noticeBody}>
            SmartSpend needs permission to read your SMS inbox to find MoMo transaction messages.
            Your messages are{' '}
            <Text style={styles.bold}>never uploaded without your explicit confirmation.</Text>
          </Text>
          <TouchableOpacity style={styles.button} onPress={handleRequestPermission}>
            <Text style={styles.buttonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Date filter bar ──────────────────────────────────────────────────────

  const FilterBar = () => (
    <View style={styles.filterBar}>
      <Text style={styles.filterLabel}>
        Showing from: {new Date(filterFromMs).toLocaleDateString()}
      </Text>
      <View style={styles.filterActions}>
        {[7, 30, 90].map((days) => {
          const ms = Date.now() - days * 86_400_000;
          return (
            <TouchableOpacity
              key={days}
              onPress={() => setFilterFromMs(ms)}
              style={[styles.chip, filterFromMs === ms && styles.chipActive]}
            >
              <Text style={[styles.chipText, filterFromMs === ms && styles.chipTextActive]}>
                {days}d
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  // ─── Main list ────────────────────────────────────────────────────────────

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
                {/* Conversation header */}
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
                    style={[
                      styles.checkbox,
                      (fullySelected || someSelected) && styles.checkboxActive,
                    ]}
                    onPress={() => toggleConversation(conv)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    {fullySelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                    {!fullySelected && someSelected && (
                      <View style={styles.checkboxPartial} />
                    )}
                  </TouchableOpacity>

                  <View style={styles.convInfo}>
                    <Text style={styles.convAddress} numberOfLines={1}>
                      {conv.displayName}
                    </Text>
                    <Text style={styles.convMeta}>
                      {conv.messages.length} message{conv.messages.length !== 1 ? 's' : ''} ·{' '}
                      {formatSMSDate(conv.latestDate)}
                    </Text>
                  </View>

                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>

                {/* Expanded messages */}
                {isExpanded &&
                  conv.messages.map((msg) => (
                    <TouchableOpacity
                      key={msg._id}
                      style={[styles.msgRow, selected.has(msg._id) && styles.msgRowSelected]}
                      onPress={() => toggleMessage(msg._id)}
                      activeOpacity={0.75}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          selected.has(msg._id) && styles.checkboxActive,
                          { width: 18, height: 18 },
                        ]}
                      >
                        {selected.has(msg._id) && (
                          <Ionicons name="checkmark" size={12} color="#fff" />
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.msgBody} numberOfLines={2}>
                          {msg.body}
                        </Text>
                        <Text style={styles.msgDate}>
                          {new Date(parseInt(msg.date, 10)).toLocaleString()}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
              </View>
            );
          }}
        />
      )}

      {/* Bottom action bar */}
      {selected.size > 0 && (
        <View style={styles.actionBar}>
          <Text style={styles.selectedCount}>{selected.size} selected</Text>
          <TouchableOpacity
            style={styles.previewButton}
            onPress={() => setPreviewVisible(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.previewButtonText}>Preview & Upload</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Preview / Consent Modal */}
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
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={{ padding: spacing.lg }}>
            <View style={styles.summaryBox}>
              <Text style={styles.summaryText}>
                You are about to upload{' '}
                <Text style={styles.bold}>{selectedMessages.length} messages</Text> from{' '}
                <Text style={styles.bold}>
                  {new Set(selectedMessages.map((m) => m.address)).size} sender(s)
                </Text>{' '}
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

            {/* Consent checkbox */}
            <View style={styles.consentRow}>
              <Switch
                value={consentChecked}
                onValueChange={setConsentChecked}
                trackColor={{ true: colors.primary }}
                ios_backgroundColor={colors.border}
              />
              <Text style={styles.consentLabel}>
                I confirm I want to upload these messages to SmartSpend for transaction analysis.
              </Text>
            </View>
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[
                styles.uploadButton,
                (!consentChecked || uploading) && styles.uploadButtonDisabled,
              ]}
              onPress={handleUpload}
              disabled={!consentChecked || uploading}
              activeOpacity={0.85}
            >
              {uploading ? (
                <ActivityIndicator color="#fff" />
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  notice: {
    flex: 1,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  noticeTitle: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
  noticeBody: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  bold: { fontWeight: '700' },
  steps: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm },
  step: { fontSize: 13, color: colors.textSecondary, lineHeight: 20 },
  code: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: colors.primary },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
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
  filterLabel: { fontSize: 12, color: colors.textSecondary },
  filterActions: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.textSecondary },
  chipTextActive: { color: colors.primary, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  loadingText: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: 14 },
  emptyText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
  list: { padding: spacing.md, paddingBottom: 100 },
  convBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
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
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  checkboxActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxPartial: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  convInfo: { flex: 1 },
  convAddress: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  convMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  msgRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  msgRowSelected: { backgroundColor: colors.primaryLight },
  msgBody: { fontSize: 13, color: colors.textPrimary, lineHeight: 18 },
  msgDate: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
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
  selectedCount: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  previewButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
  },
  previewButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
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
  modalTitle: { ...typography.h3, color: colors.textPrimary },
  modalScroll: { flex: 1 },
  summaryBox: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  summaryText: { fontSize: 14, color: colors.primary, lineHeight: 22 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  previewMsg: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  previewSender: { fontSize: 12, fontWeight: '600', color: colors.primary, marginBottom: 4 },
  previewBody: { fontSize: 13, color: colors.textPrimary, lineHeight: 18 },
  moreText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginVertical: spacing.md },
  errorBox: {
    backgroundColor: colors.errorLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { fontSize: 13, color: colors.error },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  consentLabel: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  modalFooter: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  uploadButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  uploadButtonDisabled: { opacity: 0.45 },
  uploadButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
