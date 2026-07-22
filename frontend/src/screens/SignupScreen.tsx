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
import { Ionicons } from '@expo/vector-icons';
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
  const [showPassword, setShowPassword] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

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
      const regRes = await authApi.register(data);
      if (regRes.access_token) {
        // Email confirmation is disabled in Supabase — use the token directly.
        await setAuth(regRes.access_token, {
          user_id: regRes.user_id,
          email: regRes.email,
          display_name: regRes.display_name ?? data.display_name,
        });
      } else {
        // Email confirmation is enabled — attempting login now would
        // immediately fail with "Email not confirmed". Show a prompt instead.
        setEmailSent(true);
      }
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

  if (emailSent) {
    return (
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Text style={styles.logoMark}>SS</Text>
            <Text style={styles.logoText}>SmartSpend</Text>
          </View>
          <View style={[styles.form, { alignItems: 'center' }]}>
            <Ionicons
              name="mail-outline"
              size={48}
              color={colors.primary}
              style={{ marginBottom: spacing.md }}
            />
            <Text style={[styles.formTitle, { textAlign: 'center' }]}>Check your email</Text>
            <Text
              style={[
                styles.label,
                { textAlign: 'center', fontFamily: fonts.bodyRegular, lineHeight: 22, marginBottom: spacing.lg },
              ]}
            >
              We sent a confirmation link to your inbox.{' '}Click the link to activate your
              account, then come back to sign in.
            </Text>
            <TouchableOpacity
              style={styles.button}
              onPress={() => navigation.navigate('Login')}
              activeOpacity={0.85}
            >
              <Text style={styles.buttonText}>Go to Sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

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
                  name === 'password' ? (
                    <View style={styles.inputRow}>
                      <TextInput
                        style={[styles.input, styles.inputFlex, errors[name] && styles.inputError]}
                        value={value}
                        onChangeText={onChange}
                        onBlur={onBlur}
                        placeholder={placeholder}
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry={!showPassword}
                        keyboardType={keyboard}
                        autoCapitalize="none"
                        autoComplete="password-new"
                      />
                      <TouchableOpacity
                        style={styles.eyeBtn}
                        onPress={() => setShowPassword((p) => !p)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons
                          name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                          size={20}
                          color={colors.textMuted}
                        />
                      </TouchableOpacity>
                    </View>
                  ) : (
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
                      autoComplete={name === 'email' ? 'email' : 'name'}
                    />
                  )
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
  inputRow: {
    position: 'relative',
  },
  inputFlex: {
    paddingRight: 48,
  },
  eyeBtn: {
    position: 'absolute',
    right: spacing.md,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
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
