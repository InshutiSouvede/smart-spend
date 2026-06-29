import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { useUploadReceipt } from '../hooks/useReceipts';
import { getErrorMessage } from '../api/client';
import { colors, spacing, radius, typography } from '../theme';

const MAX_DIMENSION = 2048;

type Stage = 'pick' | 'camera' | 'preview' | 'done';

async function resizeImage(uri: string): Promise<{ uri: string; mimeType: string }> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: MAX_DIMENSION } }],
    { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG },
  );
  return { uri: result.uri, mimeType: 'image/jpeg' };
}

export function ReceiptUploadScreen() {
  const navigation = useNavigation();
  const [stage, setStage] = useState<Stage>('pick');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>('image/jpeg');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraRef, setCameraRef] = useState<CameraView | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { mutateAsync: uploadReceipt, isPending: uploading } = useUploadReceipt();

  // ─── Gallery picker ───────────────────────────────────────────────────────

  const pickFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow SmartSpend to access your photos in Settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      allowsEditing: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const resized = await resizeImage(asset.uri);
    setImageUri(resized.uri);
    setMimeType(resized.mimeType);
    setStage('preview');
  };

  // ─── Camera capture ───────────────────────────────────────────────────────

  const openCamera = async () => {
    if (!cameraPermission?.granted) {
      const res = await requestCameraPermission();
      if (!res.granted) {
        Alert.alert('Permission needed', 'Allow SmartSpend to use the camera in Settings.');
        return;
      }
    }
    setStage('camera');
  };

  const capturePhoto = async () => {
    if (!cameraRef) return;
    const photo = await cameraRef.takePictureAsync({ quality: 0.85 });
    if (!photo) return;
    const resized = await resizeImage(photo.uri);
    setImageUri(resized.uri);
    setMimeType(resized.mimeType);
    setStage('preview');
  };

  // ─── Upload ───────────────────────────────────────────────────────────────

  const handleUpload = async () => {
    if (!imageUri) return;
    setUploadError(null);
    try {
      await uploadReceipt({ uri: imageUri, mimeType });
      setStage('done');
    } catch (e) {
      setUploadError(getErrorMessage(e));
    }
  };

  // ─── Done state ───────────────────────────────────────────────────────────

  if (stage === 'done') {
    return (
      <SafeAreaView style={[styles.safe, styles.center]} edges={['bottom']}>
        <Ionicons name="checkmark-circle" size={64} color={colors.success} />
        <Text style={styles.doneTitle}>Receipt uploaded!</Text>
        <Text style={styles.doneHint}>
          Our OCR engine is processing your receipt. It will appear in your receipts list shortly.
        </Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => {
            setStage('pick');
            setImageUri(null);
            navigation.goBack();
          }}
        >
          <Text style={styles.buttonText}>Done</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ─── Camera view ─────────────────────────────────────────────────────────

  if (stage === 'camera') {
    return (
      <View style={styles.cameraContainer}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          ref={setCameraRef}
        />
        <SafeAreaView style={styles.cameraControls} edges={['bottom']}>
          <TouchableOpacity
            style={styles.cameraCancel}
            onPress={() => setStage('pick')}
          >
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.captureButton} onPress={capturePhoto}>
            <View style={styles.captureInner} />
          </TouchableOpacity>
          <View style={{ width: 52 }} />
        </SafeAreaView>
      </View>
    );
  }

  // ─── Preview ──────────────────────────────────────────────────────────────

  if (stage === 'preview' && imageUri) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.previewContent}>
          <Text style={styles.previewLabel}>Preview</Text>
          <Image source={{ uri: imageUri }} style={styles.previewImage} resizeMode="contain" />

          {uploadError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{uploadError}</Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => setStage('pick')}
            disabled={uploading}
          >
            <Ionicons name="refresh-outline" size={18} color={colors.primary} />
            <Text style={styles.secondaryButtonText}>Choose different photo</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, uploading && styles.buttonDisabled]}
            onPress={handleUpload}
            disabled={uploading}
            activeOpacity={0.85}
          >
            {uploading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                <Text style={styles.buttonText}>Upload Receipt</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── Pick stage (default) ─────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.safe, styles.center]} edges={['bottom']}>
      <Ionicons name="receipt-outline" size={56} color={colors.primary} style={{ marginBottom: spacing.lg }} />
      <Text style={styles.pickTitle}>Add a receipt</Text>
      <Text style={styles.pickHint}>Take a photo or choose from your gallery.</Text>

      <View style={styles.pickActions}>
        <TouchableOpacity style={styles.pickButton} onPress={openCamera}>
          <Ionicons name="camera-outline" size={28} color={colors.primary} />
          <Text style={styles.pickButtonLabel}>Take Photo</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.pickButton} onPress={pickFromGallery}>
          <Ionicons name="images-outline" size={28} color={colors.primary} />
          <Text style={styles.pickButtonLabel}>Choose from Gallery</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  pickTitle: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
  pickHint: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  pickActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  pickButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    elevation: 1,
  },
  pickButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  cameraControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  cameraCancel: {
    width: 52,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderWidth: 3,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
  },
  previewContent: {
    padding: spacing.xl,
    paddingBottom: 40,
    gap: spacing.md,
  },
  previewLabel: { ...typography.h3, color: colors.textPrimary },
  previewImage: {
    width: '100%',
    height: 340,
    borderRadius: radius.lg,
    backgroundColor: colors.border,
  },
  errorBox: {
    backgroundColor: colors.errorLight,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorText: { fontSize: 13, color: colors.error },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  secondaryButtonText: { color: colors.primary, fontWeight: '600', fontSize: 14 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  doneTitle: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
  doneHint: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
  },
});
