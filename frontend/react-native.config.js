module.exports = {
  dependencies: {
    'react-native-get-sms-android': {
      platforms: {
        android: {
          sourceDir: '../node_modules/react-native-get-sms-android/android',
          packageImportPath: 'import com.github.briankabiro.getsms.RNGetSmsPackage;',
        },
        ios: null,
      },
    },
  },
};
