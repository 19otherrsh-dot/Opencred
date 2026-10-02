import type { Catalogue } from './en';

/**
 * Arabic.
 *
 * REVIEW STATUS: not yet reviewed by a native speaker.
 *
 * Arabic is here for a reason beyond coverage: it is the locale that proves the
 * right-to-left path actually works end to end (FR-DES-07). A layout that has
 * never rendered RTL text is a layout that will break the first time it does.
 * `direction()` returns `rtl` for this locale, the verification page sets
 * `dir="rtl"` on the document, and the stylesheet uses logical properties
 * (`margin-inline`, `padding-inline`) so the mirroring is automatic rather than
 * a second stylesheet.
 */
export const ar: Catalogue = {
  'verify.valid.title': 'هذه الشهادة صالحة',
  'verify.valid.subtitle': 'صادرة عن {issuer} وتم التحقق منها تشفيريًا للتو.',
  'verify.revoked.title': 'تم إلغاء هذه الشهادة',
  'verify.revoked.subtitle': 'ألغت {issuer} هذه الشهادة بتاريخ {date}.',
  'verify.revoked.subtitleNoDate': 'ألغت {issuer} هذه الشهادة.',
  'verify.expired.title': 'انتهت صلاحية هذه الشهادة',
  'verify.expired.subtitle': 'كانت صالحة حتى {date}.',
  'verify.invalid.title': 'تعذّر التحقق من هذه الشهادة',
  'verify.invalid.subtitle': 'التوقيع لا يطابق محتوى الشهادة.',

  'verify.section.credential': 'الشهادة',
  'verify.field.awardedTo': 'مُنحت إلى',
  'verify.field.issuedBy': 'صادرة عن',
  'verify.field.issueDate': 'تاريخ الإصدار',
  'verify.field.validUntil': 'صالحة حتى',
  'verify.field.expired': 'منتهية',
  'verify.field.revoked': 'ملغاة',
  'verify.field.credentialId': 'معرّف الشهادة',

  'verify.checks.title': 'ما الذي تم فحصه',
  'verify.checks.subtitle':
    'تم التحقق في {timestamp}. تُجرى هذه الفحوصات عند كل زيارة، وليس مرة واحدة عند الإصدار.',
  'verify.checks.signature': 'التوقيع الرقمي',
  'verify.checks.signatureDetail': 'لم تُعدَّل الشهادة منذ إصدارها',
  'verify.checks.issuer': 'هوية الجهة المُصدِرة',
  'verify.checks.issuerDetail': 'مفتاح التوقيع يعود إلى الجهة المذكورة',
  'verify.checks.issuerDetailDid': 'موقّعة بواسطة {did}',
  'verify.checks.revocation': 'حالة الإلغاء',
  'verify.checks.revocationDetail': 'تم فحصها في قائمة الإلغاء المنشورة من الجهة المُصدِرة',
  'verify.checks.validity': 'مدة الصلاحية',
  'verify.checks.validityDetail': 'تنتهي في {date}',
  'verify.checks.validityDetailNever': 'هذه الشهادة لا تنتهي صلاحيتها',
  'verify.checks.anchor': 'ختم زمني خارجي',
  'verify.checks.anchorDetail': 'اختياري؛ لم تُفعّله هذه الجهة',
  'verify.checks.passed': 'ناجح',
  'verify.checks.failed': 'فاشل',
  'verify.checks.notChecked': 'لم يُفحص',

  'verify.errors.title': 'سبب الفشل',

  'verify.action.download': 'تنزيل',
  'verify.action.share': 'مشاركة',
  'verify.action.shareCopied': 'تم نسخ الرابط',
  'verify.action.addToLinkedIn': 'إضافة إلى ملف LinkedIn',
  // Apple and Google specify this wording themselves and treat it as a
  // trademark matter, so the platform name is not translated.
  'verify.action.addToAppleWallet': 'إضافة إلى Apple Wallet',
  'verify.action.addToGoogleWallet': 'إضافة إلى Google Wallet',
  'verify.action.viewJson': 'عرض JSON الموقّع',
  'verify.action.verifyAnother': 'التحقق من شهادة أخرى',

  'verify.developers.title': 'للمطوّرين وأصحاب العمل',
  'verify.developers.body':
    'هذه الشهادة هي Open Badges 3.0 / W3C Verifiable Credential. يمكنك التحقق منها بنفسك، بأي أداة تحقق متوافقة، دون المرور بهذه الصفحة.',
  'verify.developers.jsonLink': 'ملف JSON الموقّع للشهادة',
  'verify.developers.issuerDid': 'معرّف DID للجهة المُصدِرة',

  'verify.contact': 'لديك سؤال حول هذه الشهادة؟ راسل {email}.',
  'verify.poweredBy':
    'صادرة عبر OpenCred، منصة الشهادات مفتوحة المصدر. يستطيع أي شخص تشغيلها وأي شخص تدقيقها.',

  'notFound.title': 'لا توجد شهادة بهذا المعرّف',
  'notFound.subtitle': 'لم تُصدر هذه الجهة أي شيء بهذا المعرّف.',
  'notFound.reasons': 'هناك سببان شائعان:',
  'notFound.typo.label': 'خطأ في الكتابة.',
  'notFound.typo.body':
    'لا تحتوي المعرّفات أبدًا على الرقمين 0 أو 1، ولا على الأحرف o أو i أو l — استُبعدت تحديدًا لأنها تُقرأ خطأً. راجع المعرّف على الشهادة وحاول مرة أخرى.',
  'notFound.forged.label': 'الشهادة ليست أصلية.',
  'notFound.forged.body':
    'إذا نُسخ المعرّف حرفيًا من مستند ولم يظهر رغم ذلك، فإن ذلك المستند لم يصدر عبر هذه المنصة.',
  'notFound.tryAnother': 'جرّب معرّفًا آخر',

  'wallet.title': 'شهاداتك',
  'wallet.intro': 'كل الشهادات والأوسمة الصادرة إلى بريدك الإلكتروني، من جميع الجهات، في مكان واحد.',
  'wallet.emailLabel': 'بريدك الإلكتروني',
  'wallet.emailHint': 'العنوان الذي أُرسلت إليه شهاداتك. لا حاجة إلى كلمة مرور.',
  'wallet.requestLink': 'أرسل لي رابط دخول',
  'wallet.checkInbox': 'تحقق من بريدك',
  'wallet.checkInboxBody':
    'إذا كان {email} قد استلم أي شهادات، فرابط الدخول في طريقه إليك. صالح لمدة 30 دقيقة.',
  'wallet.privacyNote':
    'نحن لا نُفصح عمدًا عمّا إذا كان عنوان ما يملك شهادات — إذ سيتيح ذلك لأي شخص معرفة من يملك ماذا.',
  'wallet.empty': 'لم يصدر شيء بعد إلى هذا العنوان على هذه المنصة.',
  'wallet.count': '{count} صادرة إلى {email}',
  'wallet.issuedOn': 'صدرت في {date}',
  'wallet.expiresOn': 'تنتهي في {date}',
  'wallet.action.verificationPage': 'صفحة التحقق',
  'wallet.theseAreYours': 'هذه ملكك',
  'wallet.theseAreYoursBody':
    'كل شهادة مستند موقّع وقابل للنقل. يمكنك تنزيل ملف JSON والاحتفاظ به، أو تسليمه لأي أداة تحقق متوافقة — وسيظل قابلاً للتحقق حتى لو توقفت الجهة المُصدِرة عن استخدام هذه المنصة.',
  'wallet.signOut': 'تسجيل الخروج',

  'email.download': 'نزّل شهادتك',
  'email.viewVerification': 'عرض صفحة التحقق العامة',
  'email.addToLinkedIn': 'أضفها إلى ملفك على LinkedIn',
  'email.viewAll': 'عرض جميع شهاداتك',
  'email.assurance':
    'هذه الشهادة موقّعة تشفيريًا. يستطيع أي شخص التأكد من أصالتها عبر رابط التحقق أعلاه — دون الحاجة إلى حساب.',
  'email.issuedWith': 'صادرة عبر OpenCred، منصة الشهادات مفتوحة المصدر.',

  'status.valid': 'صالحة',
  'status.expired': 'منتهية',
  'status.revoked': 'ملغاة',
  'status.processing': 'قيد المعالجة',
};
