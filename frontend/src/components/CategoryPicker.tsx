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
import { colors, spacing, radius, fonts } from '../theme';
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
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>Select category</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.xl }} />
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
                  {selected && (
                    <Ionicons name="checkmark" size={16} color={colors.primary} />
                  )}
                  <Text style={[styles.rowText, selected && styles.rowTextSelected]}>
                    {item}
                  </Text>
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            contentContainerStyle={{ paddingBottom: spacing.xxxl }}
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
    backgroundColor: 'rgba(17,17,17,0.4)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '65%',
    paddingTop: spacing.xs,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.xs,
    minHeight: 44,
  },
  rowSelected: {
    backgroundColor: colors.primaryLight,
  },
  rowText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 15,
    color: colors.textPrimary,
    flex: 1,
  },
  rowTextSelected: {
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.xl,
  },
  submitting: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  submittingText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: colors.textSecondary,
  },
});
