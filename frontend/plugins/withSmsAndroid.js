/**
 * Expo config plugin to manually link `react-native-get-sms-android`.
 *
 * Expo's autolinking does not pick up this package because it is not
 * an Expo module. This plugin adds the necessary Gradle project include,
 * build dependency, and MainApplication package registration.
 */
const {
  withSettingsGradle,
  withAppBuildGradle,
  withMainApplication,
} = require('expo/config-plugins');

function withSmsAndroid(config) {
  // 1. Include the library project in settings.gradle
  config = withSettingsGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('react-native-get-sms-android')) {
      cfg.modResults.contents +=
        "\ninclude ':react-native-get-sms-android'\n" +
        "project(':react-native-get-sms-android').projectDir = " +
        "new File(rootProject.projectDir, '../node_modules/react-native-get-sms-android/android')\n";
    }
    return cfg;
  });

  // 2. Add implementation dependency in app/build.gradle
  config = withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('react-native-get-sms-android')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        "dependencies {\n    implementation project(':react-native-get-sms-android')",
      );
    }
    return cfg;
  });

  // 3. Register SmsPackage in MainApplication
  config = withMainApplication(config, (cfg) => {
    if (!cfg.modResults.contents.includes('SmsPackage')) {
      // Add import
      cfg.modResults.contents = cfg.modResults.contents.replace(
        'import expo.modules.ApplicationLifecycleDispatcher',
        'import com.react.SmsPackage\nimport expo.modules.ApplicationLifecycleDispatcher',
      );
      // Make the package list mutable and add SmsPackage
      cfg.modResults.contents = cfg.modResults.contents.replace(
        'val packages = PackageList(this).packages',
        'val packages = PackageList(this).packages.toMutableList().apply { add(SmsPackage()) }',
      );
    }
    return cfg;
  });

  return config;
}

module.exports = withSmsAndroid;
