import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { authApi } from '../api/auth';
import { useAuthStore } from '../store/authStore';
import { getErrorMessage } from '../api/client';
import { colors, spacing, radius, fonts } from '../theme';
import type { AuthStackParamList } from '../navigation/AuthStack';

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type FormData = z.infer<typeof schema>;
type Nav = NativeStackNavigationProp<AuthStackParamList, 'Login'>;

export function LoginScreen() {
  const navigation = useNavigation<Nav>();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (data: FormData) => {
    setApiError(null);
    try {
      console.log('[LOGIN] Attempting login with email:', data.email);
      const res = await authApi.login(data);
      console.log('[LOGIN] Auth mode:', res.auth_mode);
      if (!res.access_token) {
        throw new Error(`Authentication failed: No access token received (auth_mode: ${res.auth_mode}). Check backend MOCK_AUTH_ENABLED setting.`);
      }
      await setAuth(res.access_token, {
        user_id: res.user_id,
        email: res.email,
        display_name: res.display_name,
      });
    } catch (e) {
      console.error('[LOGIN] Failed:', e);
      setApiError(getErrorMessage(e));
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* Brand mark */}
        <View style={styles.brand}>
          <Text style={styles.logoMark}>SS</Text>
          <Text style={styles.logoText}>SmartSpend</Text>
          <Text style={styles.tagline}>Track your MoMo transactions</Text>
        </View>

        {apiError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{apiError}</Text>
          </View>
        ) : null}

        <View style={styles.form}>
          <Text style={styles.formTitle}>Sign in</Text>

          <Text style={styles.label}>Email</Text>
          <Controller
            control={control}
            name="email"
            render={({ field: { onChange, value, onBlur } }) => (
              <TextInput
                style={[styles.input, errors.email && styles.inputError]}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder="you@example.com"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
            )}
          />
          {errors.email ? <Text style={styles.fieldError}>{errors.email.message}</Text> : null}

          <Text style={[styles.label, { marginTop: spacing.md }]}>Password</Text>
          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, value, onBlur } }) => (
              <TextInput
                style={[styles.input, errors.password && styles.inputError]}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder="••••••••"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                autoComplete="password"
              />
            )}
          />
          {errors.password ? <Text style={styles.fieldError}>{errors.password.message}</Text> : null}

          <TouchableOpacity
            style={[styles.button, isSubmitting && styles.buttonDisabled]}
            onPress={handleSubmit(onSubmit)}
            disabled={isSubmitting}
            activeOpacity={0.85}
          >
            {isSubmitting ? (
              <ActivityIndicator color={colors.textPrimary} />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => navigation.navigate('Signup')} style={styles.switchRow}>
          <Text style={styles.switchText}>
            Don't have an account?{'  '}
            <Text style={styles.switchLink}>Create account</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxxl,
  },
  brand: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  logoMark: {
    fontFamily: fonts.headingBold,
    fontSize: 32,
    color: colors.primary,
    width: 56,
    height: 56,
    textAlign: 'center',
    textAlignVertical: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    lineHeight: 56,
    marginBottom: spacing.sm,
  },
  logoText: {
    fontFamily: fonts.headingBold,
    fontSize: 24,
    lineHeight: 32,
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  tagline: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 4,
  },
  errorBox: {
    backgroundColor: colors.errorLight,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: '#F0CACA',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: {
    fontFamily: fonts.bodyRegular,
    color: colors.error,
    fontSize: 13,
    lineHeight: 18,
  },
  form: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formTitle: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 20,
    lineHeight: 28,
    color: colors.textPrimary,
    marginBottom: spacing.xl,
  },
  label: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary,
    marginBottom: spacing.xxs,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: fonts.bodyRegular,
    fontSize: 15,
    color: colors.textPrimary,
    minHeight: 48,
  },
  inputError: {
    borderColor: colors.error,
  },
  fieldError: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.error,
    marginTop: spacing.xxs,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.xs,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.xl,
    minHeight: 50,
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  switchRow: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  switchText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    color: colors.textSecondary,
  },
  switchLink: {
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
});
