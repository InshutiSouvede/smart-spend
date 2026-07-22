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
  display_name: z.string().min(1, 'Name is required').max(80),
});

type FormData = z.infer<typeof schema>;
type Nav = NativeStackNavigationProp<AuthStackParamList, 'Signup'>;

export function SignupScreen() {
  const navigation = useNavigation<Nav>();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', display_name: '' },
  });

  const onSubmit = async (data: FormData) => {
    setApiError(null);
    try {
      await authApi.register(data);
      const loginRes = await authApi.login({ email: data.email, password: data.password });
      console.log('Post-registration login:', {
        auth_mode: loginRes.auth_mode,
        has_token: !!loginRes.access_token,
        token_preview: loginRes.access_token?.substring(0, 20),
      });
      if (!loginRes.access_token) {
        throw new Error(`Authentication failed: No access token received (auth_mode: ${loginRes.auth_mode})`);
      }
      await setAuth(loginRes.access_token, {
        user_id: loginRes.user_id,
        email: loginRes.email,
        display_name: loginRes.display_name ?? data.display_name,
      });
    } catch (e) {
      console.error('Signup error:', e);
      setApiError(getErrorMessage(e));
    }
  };

  const fields = [
    { name: 'display_name' as const, label: 'Full name', placeholder: 'Your name', secure: false, keyboard: 'default' as const },
    { name: 'email' as const, label: 'Email', placeholder: 'you@example.com', secure: false, keyboard: 'email-address' as const },
    { name: 'password' as const, label: 'Password', placeholder: '••••••••', secure: true, keyboard: 'default' as const },
  ];

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <Text style={styles.logoMark}>SS</Text>
          <Text style={styles.logoText}>SmartSpend</Text>
          <Text style={styles.tagline}>Create your account</Text>
        </View>

        {apiError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{apiError}</Text>
          </View>
        ) : null}

        <View style={styles.form}>
          <Text style={styles.formTitle}>Get started</Text>

          {fields.map(({ name, label, placeholder, secure, keyboard }, i) => (
            <View key={name} style={i > 0 ? { marginTop: spacing.md } : undefined}>
              <Text style={styles.label}>{label}</Text>
              <Controller
                control={control}
                name={name}
                render={({ field: { onChange, value, onBlur } }) => (
                  <TextInput
                    style={[styles.input, errors[name] && styles.inputError]}
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    placeholder={placeholder}
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry={secure}
                    keyboardType={keyboard}
                    autoCapitalize={name === 'email' ? 'none' : 'words'}
                    autoComplete={name === 'email' ? 'email' : name === 'password' ? 'password-new' : 'name'}
                  />
                )}
              />
              {errors[name] ? (
                <Text style={styles.fieldError}>{errors[name]?.message}</Text>
              ) : null}
            </View>
          ))}

          <TouchableOpacity
            style={[styles.button, isSubmitting && styles.buttonDisabled]}
            onPress={handleSubmit(onSubmit)}
            disabled={isSubmitting}
            activeOpacity={0.85}
          >
            {isSubmitting ? (
              <ActivityIndicator color={colors.textPrimary} />
            ) : (
              <Text style={styles.buttonText}>Create Account</Text>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.switchRow}>
          <Text style={styles.switchText}>
            Already have an account?{'  '}
            <Text style={styles.switchLink}>Sign in</Text>
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
