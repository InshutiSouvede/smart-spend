import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../theme';
import { useCategories } from '../hooks/useModels';

interface Props {
  visible: boolean;
  current?: string | null;
  onClose: () => void;
  onSelect: (category: string) => void;
  isSubmitting?: boolean;
}

export function CategoryPicker({ visible, current, onClose, onSelect, isSubmitting }: Props) {
  const { data: categories, isLoading } = useCategories();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>Correct category</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
        ) : (
          <FlatList
            data={categories ?? []}
            keyExtractor={(item) => item}
            renderItem={({ item }) => {
              const selected = item === current;
              return (
                <TouchableOpacity
                  style={[styles.row, selected && styles.rowSelected]}
                  onPress={() => !isSubmitting && onSelect(item)}
                  disabled={isSubmitting}
                >
                  <Text style={[styles.rowText, selected && styles.rowTextSelected]}>
                    {item}
                  </Text>
                  {selected && (
                    <Ionicons name="checkmark" size={18} color={colors.primary} />
                  )}
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            contentContainerStyle={{ paddingBottom: spacing.xl }}
          />
        )}

        {isSubmitting && (
          <View style={styles.submitting}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={styles.submittingText}>Saving…</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '65%',
    paddingTop: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { ...typography.h3, color: colors.textPrimary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  rowSelected: { backgroundColor: colors.primaryLight },
  rowText: { fontSize: 15, color: colors.textPrimary },
  rowTextSelected: { color: colors.primary, fontWeight: '600' },
  separator: { height: 1, backgroundColor: colors.divider },
  submitting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  submittingText: { color: colors.textSecondary, fontSize: 14 },
});
