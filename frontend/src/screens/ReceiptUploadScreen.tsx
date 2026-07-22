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
import { colors, spacing, radius, fonts } from '../theme';

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

  // Done state
  if (stage === 'done') {
    return (
      <SafeAreaView style={[styles.safe, styles.center]} edges={['bottom']}>
        <View style={styles.successCircle}>
          <Ionicons name="checkmark" size={36} color={colors.income} />
        </View>
        <Text style={styles.doneTitle}>Receipt uploaded!</Text>
        <Text style={styles.doneHint}>
          Our OCR engine is processing your receipt. It will appear in your receipts list shortly.
        </Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => {
            setStage('pick');
            setImageUri(null);
            navigation.goBack();
          }}
        >
          <Text style={styles.primaryButtonText}>Done</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // Camera view
  if (stage === 'camera') {
    return (
      <View style={styles.cameraContainer}>
        <CameraView style={StyleSheet.absoluteFill} facing="back" ref={setCameraRef} />
        <SafeAreaView style={styles.cameraControls} edges={['bottom']}>
          <TouchableOpacity style={styles.cameraCancel} onPress={() => setStage('pick')}>
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

  // Preview state
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
            <Ionicons name="refresh-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.secondaryButtonText}>Choose different photo</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.primaryButton, uploading && styles.buttonDisabled]}
            onPress={handleUpload}
            disabled={uploading}
            activeOpacity={0.85}
          >
            {uploading ? (
              <ActivityIndicator color={colors.textPrimary} />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={16} color={colors.textPrimary} />
                <Text style={styles.primaryButtonText}>Upload Receipt</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Pick stage (default)
  return (
    <SafeAreaView style={[styles.safe, styles.center]} edges={['bottom']}>
      <View style={styles.iconWrap}>
        <Ionicons name="receipt-outline" size={40} color={colors.textSecondary} />
      </View>
      <Text style={styles.pickTitle}>Add a receipt</Text>
      <Text style={styles.pickHint}>Take a photo or choose from your gallery.</Text>

      <View style={styles.pickActions}>
        <TouchableOpacity style={styles.pickCard} onPress={openCamera}>
          <Ionicons name="camera-outline" size={28} color={colors.primary} />
          <Text style={styles.pickCardLabel}>Take Photo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.pickCard} onPress={pickFromGallery}>
          <Ionicons name="images-outline" size={28} color={colors.primary} />
          <Text style={styles.pickCardLabel}>Choose from Gallery</Text>
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

  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceContainer,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickTitle: {
    fontFamily: fonts.headingBold,
    fontSize: 22,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  pickHint: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  pickActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
    width: '100%',
  },
  pickCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 100,
    justifyContent: 'center',
  },
  pickCardLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
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
  previewLabel: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  previewImage: {
    width: '100%',
    height: 340,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainer,
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
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 11,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    backgroundColor: colors.surface,
    minHeight: 44,
  },
  secondaryButtonText: {
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
    fontSize: 14,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.xs,
    paddingVertical: 14,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 50,
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: {
    fontFamily: fonts.headingSemiBold,
    color: colors.textPrimary,
    fontSize: 15,
  },

  successCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.successLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  doneTitle: {
    fontFamily: fonts.headingBold,
    fontSize: 22,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  doneHint: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 300,
  },
});
