import type { Catalogue } from './en';

/**
 * Hindi.
 *
 * REVIEW STATUS: not yet reviewed by a native speaker.
 *
 * Worth flagging specifically for this locale: Devanagari needs a font with
 * proper conjunct and matra support. The render worker's font stack includes
 * Noto Sans Devanagari and the shipped Docker image installs it, so a Hindi
 * recipient name renders as glyphs rather than tofu boxes. If you build your
 * own image, keep `fonts-noto-core`.
 */
export const hi: Catalogue = {
  'verify.valid.title': 'यह प्रमाणपत्र वैध है',
  'verify.valid.subtitle': '{issuer} द्वारा जारी और अभी क्रिप्टोग्राफ़िक रूप से सत्यापित।',
  'verify.revoked.title': 'यह प्रमाणपत्र निरस्त कर दिया गया है',
  'verify.revoked.subtitle': '{issuer} ने {date} को इसे निरस्त किया।',
  'verify.revoked.subtitleNoDate': '{issuer} ने यह प्रमाणपत्र निरस्त कर दिया।',
  'verify.expired.title': 'यह प्रमाणपत्र समाप्त हो चुका है',
  'verify.expired.subtitle': 'यह {date} तक वैध था।',
  'verify.invalid.title': 'इस प्रमाणपत्र का सत्यापन नहीं हो सका',
  'verify.invalid.subtitle': 'हस्ताक्षर प्रमाणपत्र की सामग्री से मेल नहीं खाता।',

  'verify.section.credential': 'प्रमाणपत्र',
  'verify.field.awardedTo': 'प्राप्तकर्ता',
  'verify.field.issuedBy': 'जारीकर्ता',
  'verify.field.issueDate': 'जारी होने की तिथि',
  'verify.field.validUntil': 'वैधता तिथि',
  'verify.field.expired': 'समाप्त',
  'verify.field.revoked': 'निरस्त',
  'verify.field.credentialId': 'प्रमाणपत्र पहचान संख्या',

  'verify.checks.title': 'क्या जाँचा गया',
  'verify.checks.subtitle':
    '{timestamp} पर सत्यापित। ये जाँचें हर बार पृष्ठ खोलने पर होती हैं, केवल जारी करते समय नहीं।',
  'verify.checks.signature': 'डिजिटल हस्ताक्षर',
  'verify.checks.signatureDetail': 'जारी होने के बाद प्रमाणपत्र में कोई बदलाव नहीं हुआ है',
  'verify.checks.issuer': 'जारीकर्ता की पहचान',
  'verify.checks.issuerDetail': 'हस्ताक्षर कुंजी उसी जारीकर्ता की है जिसका नाम दिया गया है',
  'verify.checks.issuerDetailDid': '{did} द्वारा हस्ताक्षरित',
  'verify.checks.revocation': 'निरस्तीकरण स्थिति',
  'verify.checks.revocationDetail': 'जारीकर्ता की प्रकाशित निरस्तीकरण सूची से जाँचा गया',
  'verify.checks.validity': 'वैधता अवधि',
  'verify.checks.validityDetail': '{date} को समाप्त होगा',
  'verify.checks.validityDetailNever': 'यह प्रमाणपत्र कभी समाप्त नहीं होता',
  'verify.checks.anchor': 'बाहरी समय-मुद्रांकन',
  'verify.checks.anchorDetail': 'वैकल्पिक; इस जारीकर्ता ने इसे सक्रिय नहीं किया है',
  'verify.checks.passed': 'सफल',
  'verify.checks.failed': 'विफल',
  'verify.checks.notChecked': 'जाँचा नहीं गया',

  'verify.errors.title': 'यह क्यों विफल हुआ',

  'verify.action.download': 'डाउनलोड करें',
  'verify.action.share': 'साझा करें',
  'verify.action.shareCopied': 'लिंक कॉपी हो गया',
  'verify.action.addToLinkedIn': 'LinkedIn प्रोफ़ाइल में जोड़ें',
  // Apple and Google specify this wording themselves and treat it as a
  // trademark matter, so the platform name is not translated.
  'verify.action.addToAppleWallet': 'Apple Wallet में जोड़ें',
  'verify.action.addToGoogleWallet': 'Google Wallet में जोड़ें',
  'verify.action.viewJson': 'हस्ताक्षरित JSON देखें',
  'verify.action.verifyAnother': 'दूसरा प्रमाणपत्र सत्यापित करें',

  'verify.developers.title': 'डेवलपर्स और नियोक्ताओं के लिए',
  'verify.developers.body':
    'यह प्रमाणपत्र एक Open Badges 3.0 / W3C Verifiable Credential है। आप इसे स्वयं, किसी भी मानक-अनुरूप सत्यापक से, इस पृष्ठ के बिना सत्यापित कर सकते हैं।',
  'verify.developers.jsonLink': 'हस्ताक्षरित प्रमाणपत्र JSON',
  'verify.developers.issuerDid': 'जारीकर्ता DID',

  'verify.contact': 'इस प्रमाणपत्र के बारे में प्रश्न? {email} पर संपर्क करें।',
  'verify.poweredBy':
    'OpenCred से जारी — एक ओपन-सोर्स क्रेडेंशियल प्लेटफ़ॉर्म। कोई भी इसे चला सकता है और कोई भी इसका ऑडिट कर सकता है।',

  'notFound.title': 'इस पहचान संख्या का कोई प्रमाणपत्र नहीं है',
  'notFound.subtitle': 'इस जारीकर्ता ने इस पहचान संख्या से कभी कुछ जारी नहीं किया।',
  'notFound.reasons': 'इसके दो सामान्य कारण हैं:',
  'notFound.typo.label': 'टाइपिंग की गलती।',
  'notFound.typo.body':
    'पहचान संख्या में कभी भी 0 या 1 अंक, या o, i, l अक्षर नहीं होते — इन्हें इसलिए हटाया गया है क्योंकि इन्हें ग़लत पढ़ा जाता है। प्रमाणपत्र पर दी गई संख्या दोबारा जाँचें।',
  'notFound.forged.label': 'प्रमाणपत्र असली नहीं है।',
  'notFound.forged.body':
    'यदि संख्या दस्तावेज़ से हूबहू कॉपी की गई है और फिर भी नहीं मिलती, तो वह दस्तावेज़ इस प्लेटफ़ॉर्म से जारी नहीं हुआ था।',
  'notFound.tryAnother': 'दूसरी संख्या आज़माएँ',

  'wallet.title': 'आपके प्रमाणपत्र',
  'wallet.intro':
    'आपके ईमेल पते पर जारी सभी प्रमाणपत्र और बैज, हर संस्था से, एक ही जगह।',
  'wallet.emailLabel': 'आपका ईमेल पता',
  'wallet.emailHint': 'वही पता जहाँ आपके प्रमाणपत्र भेजे गए थे। पासवर्ड की आवश्यकता नहीं।',
  'wallet.requestLink': 'मुझे साइन-इन लिंक भेजें',
  'wallet.checkInbox': 'अपना इनबॉक्स देखें',
  'wallet.checkInboxBody':
    'यदि {email} पर कोई प्रमाणपत्र भेजा गया है, तो साइन-इन लिंक भेज दिया गया है। यह 30 मिनट तक वैध है।',
  'wallet.privacyNote':
    'हम जानबूझकर नहीं बताते कि किसी पते पर प्रमाणपत्र हैं या नहीं — अन्यथा कोई भी पता लगा सकता था कि किसके पास क्या है।',
  'wallet.empty': 'इस संस्थापन में अभी तक इस पते पर कुछ जारी नहीं हुआ है।',
  'wallet.count': '{email} को जारी {count}',
  'wallet.issuedOn': '{date} को जारी',
  'wallet.expiresOn': '{date} को समाप्त',
  'wallet.action.verificationPage': 'सत्यापन पृष्ठ',
  'wallet.theseAreYours': 'ये आपके हैं',
  'wallet.theseAreYoursBody':
    'हर प्रमाणपत्र एक हस्ताक्षरित, पोर्टेबल दस्तावेज़ है। आप JSON डाउनलोड करके रख सकते हैं, या किसी भी मानक-अनुरूप सत्यापक को दे सकते हैं — जारीकर्ता संस्था के यह प्लेटफ़ॉर्म छोड़ देने पर भी यह सत्यापन-योग्य रहेगा।',
  'wallet.signOut': 'साइन आउट',

  'email.download': 'अपना प्रमाणपत्र डाउनलोड करें',
  'email.viewVerification': 'सार्वजनिक सत्यापन पृष्ठ देखें',
  'email.addToLinkedIn': 'अपनी LinkedIn प्रोफ़ाइल में जोड़ें',
  'email.viewAll': 'अपने सभी प्रमाणपत्र देखें',
  'email.assurance':
    'यह प्रमाणपत्र क्रिप्टोग्राफ़िक रूप से हस्ताक्षरित है। ऊपर दिए सत्यापन लिंक पर कोई भी इसकी प्रामाणिकता जाँच सकता है — खाता बनाने की आवश्यकता नहीं।',
  'email.issuedWith': 'OpenCred से जारी — एक ओपन-सोर्स क्रेडेंशियल प्लेटफ़ॉर्म।',

  'status.valid': 'वैध',
  'status.expired': 'समाप्त',
  'status.revoked': 'निरस्त',
  'status.processing': 'प्रक्रियाधीन',
};
