import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useProfile, useUpdateProfile } from '../hooks/useProfile';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../api/auth';
import { getErrorMessage } from '../api/client';
import { colors, spacing, radius, fonts } from '../theme';

export function ProfileScreen() {
  const { clearAuth, user } = useAuthStore();
  const { data: profile, isLoading } = useProfile();
  const { mutateAsync: updateProfile, isPending: saving } = useUpdateProfile();

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const displayedName = profile?.display_name ?? user?.display_name ?? '—';
  const displayedEmail = profile?.email ?? user?.email ?? '—';

  const handleStartEdit = () => {
    setDisplayName(displayedName === '—' ? '' : displayedName);
    setSaveError(null);
    setEditing(true);
  };

  const handleSave = async () => {
    if (!displayName.trim()) return;
    setSaveError(null);
    try {
      await updateProfile(displayName.trim());
      setEditing(false);
    } catch (e) {
      setSaveError(getErrorMessage(e));
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          try {
            await authApi.logout();
          } catch {
            // ignore network error on logout
          }
          await clearAuth();
        },
      },
    ]);
  };

  const initials = displayedName !== '—' ? displayedName[0].toUpperCase() : '?';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.screenTitle}>Profile</Text>

        {/* Avatar + Name card */}
        <View style={styles.profileCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarLetter}>{initials}</Text>
          </View>
          <View style={styles.nameBlock}>
            {editing ? (
              <TextInput
                style={styles.nameInput}
                value={displayName}
                onChangeText={setDisplayName}
                autoFocus
                placeholder="Your name"
                placeholderTextColor={colors.textMuted}
                maxLength={80}
              />
            ) : (
              <Text style={styles.name}>{isLoading ? '…' : displayedName}</Text>
            )}
            <Text style={styles.email}>{displayedEmail}</Text>
          </View>
          {!editing && (
            <TouchableOpacity onPress={handleStartEdit} style={styles.editBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="pencil-outline" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {editing && (
          <>
            {saveError && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{saveError}</Text>
              </View>
            )}
            <View style={styles.editActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setEditing(false)}
                disabled={saving}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={colors.textPrimary} size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Info section */}
        <View style={styles.section}>
          <View style={styles.infoRow}>
            <Ionicons name="mail-outline" size={16} color={colors.textMuted} />
            <Text style={styles.infoLabel}>Email</Text>
            <Text style={styles.infoValue} numberOfLines={1}>{displayedEmail}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.textMuted} />
            <Text style={styles.infoLabel}>Auth mode</Text>
            <Text style={styles.infoValue}>{profile?.auth_mode ?? '—'}</Text>
          </View>
        </View>

        {/* Sign out */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={16} color={colors.error} />
          <Text style={styles.logoutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 48,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  screenTitle: {
    fontFamily: fonts.headingBold,
    fontSize: 24,
    lineHeight: 32,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },

  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    borderWidth: 2,
    borderColor: colors.border,
  },
  avatarLetter: {
    fontFamily: fonts.headingBold,
    fontSize: 20,
    color: colors.primary,
  },
  nameBlock: { flex: 1 },
  name: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 18,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  nameInput: {
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    fontFamily: fonts.headingSemiBold,
    fontSize: 17,
    color: colors.textPrimary,
    paddingBottom: 4,
  },
  email: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  editBtn: {
    padding: spacing.xs,
  },

  editActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cancelBtn: {
    flex: 1,
    borderRadius: radius.xs,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderMuted,
    minHeight: 44,
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
    fontSize: 14,
  },
  saveBtn: {
    flex: 1,
    borderRadius: radius.xs,
    paddingVertical: 11,
    alignItems: 'center',
    backgroundColor: colors.primary,
    minHeight: 44,
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: {
    fontFamily: fonts.headingSemiBold,
    color: colors.textPrimary,
    fontSize: 14,
  },

  errorBox: {
    backgroundColor: colors.errorLight,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: '#F0CACA',
    padding: spacing.md,
  },
  errorText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: colors.error,
  },

  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    minHeight: 52,
  },
  infoLabel: {
    fontFamily: fonts.bodyMedium,
    flex: 1,
    fontSize: 14,
    color: colors.textMuted,
  },
  infoValue: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
    maxWidth: '55%',
    textAlign: 'right',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.md + 16 + spacing.sm,
  },

  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.xs,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.error + '40',
    minHeight: 50,
  },
  logoutText: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 14,
    color: colors.error,
  },
});
