import React from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '../theme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const SECTIONS: { heading?: string; body: string }[] = [
  {
    body: 'SmartSpend is a personal financial management application that helps you understand and manage your finances by securely organising Mobile Money transactions, receipt information, and spending insights.\n\nYour privacy is central to the design of SmartSpend. We collect only the information necessary to provide the application\'s features and are committed to protecting your personal information through responsible data handling practices.',
  },
  {
    heading: '1. Information We Collect',
    body: 'SmartSpend follows the principle of data minimization — we collect only information required to provide the application\'s functionality.',
  },
  {
    heading: 'Account Information',
    body: '• Name (optional)\n• Email address\n• Authentication information managed securely through Supabase\n\nSmartSpend does not store your password.',
  },
  {
    heading: 'Mobile Money SMS Transactions',
    body: 'With your explicit permission, SmartSpend can read Mobile Money SMS notifications stored on your Android device (e.g. MTN Mobile Money, Airtel Money). Only messages relevant to financial transactions are processed. Extracted fields may include:\n\n• Transaction amount, type, date/time\n• Account balance and fees\n• Merchant or sender information\n• Transaction reference number',
  },
  {
    heading: 'Receipt Images',
    body: 'If you choose to upload receipts, SmartSpend may collect the receipt image and the purchase information it contains (merchant, items, prices, totals). Receipt images are processed solely to extract purchase information for expense tracking.',
  },
  {
    heading: '2. Information We Do Not Collect',
    body: 'SmartSpend does not intentionally collect:\n\n• Contact lists or call history\n• GPS location\n• Photos other than receipt images you choose to upload\n• Mobile Money PINs, banking passwords, or OTPs\n• Personal SMS messages unrelated to financial transactions',
  },
  {
    heading: '3. How We Use Your Information',
    body: 'Your information is used only for:\n\n• Creating and managing your account\n• Importing and organising Mobile Money transactions\n• Reading receipt information\n• Categorising transactions\n• Generating financial dashboards and analytics\n• Predicting future income and expenses\n• Personalising machine learning models\n• Improving application performance\n• Conducting approved academic research under informed consent\n\nSmartSpend does not use your information for advertising or marketing.',
  },
  {
    heading: '4. Machine Learning',
    body: 'SmartSpend uses machine learning to categorise transactions, predict future expenses and income, and generate personalised financial insights.\n\n• Your corrections improve predictions only for your own account.\n• Your financial data is not combined with other users\' data to train shared models.\n• Machine learning predictions are not financial advice.',
  },
  {
    heading: '5. Third-Party Services',
    body: 'SmartSpend uses the following trusted third-party services:\n\n• Supabase — authentication, database, and file storage (supabase.com/privacy)\n• PostgreSQL — secure data storage\n• Tesseract OCR — open-source OCR library used to extract text from receipt images you upload; processing runs on our own servers and your image data is not sent to any external OCR provider',
  },
  {
    heading: '6. How We Protect Your Information',
    body: '• Secure authentication through Supabase\n• HTTPS-encrypted communication\n• User-level access controls\n• Secure cloud infrastructure\n\nWhile we implement reasonable safeguards, no electronic storage or internet transmission can be guaranteed to be completely secure.',
  },
  {
    heading: '7. Your Rights',
    body: 'Depending on applicable laws, you may have the right to:\n\n• Access your personal information\n• Correct inaccurate information\n• Delete your account and associated data\n• Withdraw previously granted permissions\n• Request a copy of your personal information\n\nContact us using the information below to exercise any of these rights.',
  },
  {
    heading: '8. Research Participation',
    body: 'SmartSpend is part of an academic research project. Research participation is voluntary, requires informed consent, and you may withdraw at any time without penalty. Research findings will be presented in aggregated or anonymised form.',
  },
  {
    heading: '9. Data Retention & Sharing',
    body: 'We retain your information only as long as necessary to provide SmartSpend services or meet legal obligations. SmartSpend does not sell your personal information. Your data is not shared with advertisers, marketing companies, or data brokers.',
  },
  {
    heading: '10. Contact',
    body: 'Project Developer: Souvede Joyeuse Inshuti\nAfrican Leadership University\nEmail: i.souvede@alustudent.com\n\nProject Supervisor: Mr. Pelin Mutanguha',
  },
];

export function PrivacyPolicyModal({ visible, onClose }: Props) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.title}>Privacy Policy</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={true}
        >
          <Text style={styles.effectiveDate}>Effective Date: July 2026 · Last Updated: July 2026</Text>

          {SECTIONS.map((section, i) => (
            <View key={i} style={styles.section}>
              {section.heading ? (
                <Text style={styles.heading}>{section.heading}</Text>
              ) : null}
              <Text style={styles.body}>{section.body}</Text>
            </View>
          ))}

          <View style={styles.closeBtnWrap}>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.85}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: {
    fontFamily: fonts.headingSemiBold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  scroll: { flex: 1 },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  effectiveDate: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  section: {
    marginBottom: spacing.lg,
  },
  heading: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  body: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  closeBtnWrap: {
    marginTop: spacing.xl,
  },
  closeBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.xs,
    paddingVertical: 13,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  closeBtnText: {
    fontFamily: fonts.headingSemiBold,
    color: colors.textPrimary,
    fontSize: 15,
  },
});
