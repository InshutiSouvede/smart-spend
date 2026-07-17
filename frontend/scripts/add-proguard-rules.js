#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const PROGUARD_FILE_PATH = path.join(__dirname, '..', 'android', 'app', 'proguard-rules.pro');

const SMS_KEEP_RULES = `
# ============================================================
# SmartSpend - SMS Module ProGuard Rules
# Auto-generated - do not remove this section
# ============================================================

# Keep react-native-get-sms-android classes
-keep class com.rhaker.reactnativesmsandroid.** { *; }
-keepclassmembers class com.rhaker.reactnativesmsandroid.** { *; }

# Keep React Native native modules
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }

# Keep Android SMS ContentProvider classes
-keep class android.provider.Telephony$** { *; }

# ============================================================
# End SmartSpend SMS Module Rules
# ============================================================
`;

const MARKER = '# SmartSpend - SMS Module ProGuard Rules';

function addProGuardRules() {
  console.log('🔧 Adding ProGuard rules for native SMS module...\n');

  // Check if android/ folder exists
  const androidDir = path.join(__dirname, '..', 'android');
  if (!fs.existsSync(androidDir)) {
    console.error('❌ Error: android/ folder not found.');
    console.error('   Please run "npx expo prebuild --platform android" first.\n');
    process.exit(1);
  }

  // Check if app/ folder exists
  const appDir = path.join(androidDir, 'app');
  if (!fs.existsSync(appDir)) {
    console.error('❌ Error: android/app/ folder not found.');
    console.error('   The android folder structure may be incomplete.\n');
    process.exit(1);
  }

  let existingContent = '';
  let fileExists = false;

  // Read existing file if it exists
  if (fs.existsSync(PROGUARD_FILE_PATH)) {
    existingContent = fs.readFileSync(PROGUARD_FILE_PATH, 'utf8');
    fileExists = true;

    // Check if rules already exist
    if (existingContent.includes(MARKER)) {
      console.log('✅ ProGuard rules already present in proguard-rules.pro');
      console.log('   No changes needed.\n');
      return;
    }
  }

  // Prepare the new content
  let newContent = '';
  
  if (fileExists && existingContent.trim()) {
    // Append to existing content
    newContent = existingContent.trimEnd() + '\n\n' + SMS_KEEP_RULES;
    console.log('📝 Appending SMS keep rules to existing proguard-rules.pro...');
  } else {
    // Create new file with header comment
    newContent = `# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt

${SMS_KEEP_RULES}`;
    console.log('📝 Creating proguard-rules.pro with SMS keep rules...');
  }

  // Write the file
  try {
    fs.writeFileSync(PROGUARD_FILE_PATH, newContent, 'utf8');
    console.log('✅ ProGuard rules added successfully!\n');
    console.log('📍 Location: android/app/proguard-rules.pro\n');
    console.log('Next steps:');
    console.log('  1. cd android');
    console.log('  2. .\\gradlew assembleRelease');
    console.log('  3. Install APK from: android/app/build/outputs/apk/release/app-release.apk\n');
  } catch (error) {
    console.error('❌ Error writing ProGuard rules:', error.message);
    process.exit(1);
  }
}

// Run the script
addProGuardRules();
