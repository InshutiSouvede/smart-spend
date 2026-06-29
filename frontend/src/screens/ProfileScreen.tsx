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
import { colors, spacing, radius, typography } from '../theme';

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

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Avatar placeholder */}
        <View style={styles.avatarRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarLetter}>
              {displayedName !== '—' ? displayedName[0].toUpperCase() : '?'}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
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
          {!editing ? (
            <TouchableOpacity onPress={handleStartEdit} style={styles.editBtn}>
              <Ionicons name="pencil-outline" size={18} color={colors.primary} />
            </TouchableOpacity>
          ) : null}
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
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Info rows */}
        <View style={styles.section}>
          <View style={styles.infoRow}>
            <Ionicons name="mail-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.infoLabel}>Email</Text>
            <Text style={styles.infoValue}>{displayedEmail}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.infoLabel}>Auth mode</Text>
            <Text style={styles.infoValue}>{profile?.auth_mode ?? '—'}</Text>
          </View>
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={styles.logoutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: 40 },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  avatarLetter: { fontSize: 22, fontWeight: '700', color: colors.primary },
  name: { ...typography.h3, color: colors.textPrimary },
  nameInput: {
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    paddingBottom: 4,
  },
  email: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  editBtn: { padding: spacing.sm },
  editActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  cancelBtn: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  cancelBtnText: { color: colors.textSecondary, fontWeight: '600' },
  saveBtn: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontWeight: '700' },
  errorBox: {
    backgroundColor: colors.errorLight,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorText: { fontSize: 13, color: colors.error },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  infoLabel: { flex: 1, fontSize: 14, color: colors.textSecondary },
  infoValue: { fontSize: 14, fontWeight: '500', color: colors.textPrimary },
  divider: { height: 1, backgroundColor: colors.divider, marginLeft: spacing.lg + 18 + spacing.sm },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.errorLight,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  logoutText: { fontSize: 15, fontWeight: '700', color: colors.error },
});
