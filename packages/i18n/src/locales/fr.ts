import type { Catalogue } from './en';

/**
 * French.
 *
 * REVIEW STATUS: not yet reviewed by a native speaker. See es.ts for why this
 * is recorded rather than glossed over.
 */
export const fr: Catalogue = {
  'verify.valid.title': 'Cette attestation est valide',
  'verify.valid.subtitle': 'Délivrée par {issuer} et vérifiée cryptographiquement à l’instant.',
  'verify.revoked.title': 'Cette attestation a été révoquée',
  'verify.revoked.subtitle': '{issuer} a révoqué cette attestation le {date}.',
  'verify.revoked.subtitleNoDate': '{issuer} a révoqué cette attestation.',
  'verify.expired.title': 'Cette attestation a expiré',
  'verify.expired.subtitle': 'Elle était valable jusqu’au {date}.',
  'verify.invalid.title': 'Cette attestation n’a pas pu être vérifiée',
  'verify.invalid.subtitle': 'La signature ne correspond pas au contenu de l’attestation.',

  'verify.section.credential': 'Attestation',
  'verify.field.awardedTo': 'Délivrée à',
  'verify.field.issuedBy': 'Délivrée par',
  'verify.field.issueDate': 'Date de délivrance',
  'verify.field.validUntil': 'Valable jusqu’au',
  'verify.field.expired': 'Expirée',
  'verify.field.revoked': 'Révoquée',
  'verify.field.credentialId': 'Identifiant de l’attestation',

  'verify.checks.title': 'Ce qui a été vérifié',
  'verify.checks.subtitle':
    'Vérifiée le {timestamp}. Ces contrôles sont effectués à chaque consultation, et non une seule fois à la délivrance.',
  'verify.checks.signature': 'Signature numérique',
  'verify.checks.signatureDetail': 'l’attestation n’a pas été modifiée depuis sa délivrance',
  'verify.checks.issuer': 'Identité de l’émetteur',
  'verify.checks.issuerDetail': 'la clé de signature appartient bien à l’émetteur indiqué',
  'verify.checks.issuerDetailDid': 'signée par {did}',
  'verify.checks.revocation': 'Statut de révocation',
  'verify.checks.revocationDetail': 'vérifié auprès de la liste de révocation publiée par l’émetteur',
  'verify.checks.validity': 'Période de validité',
  'verify.checks.validityDetail': 'expire le {date}',
  'verify.checks.validityDetailNever': 'cette attestation n’expire pas',
  'verify.checks.anchor': 'Horodatage externe',
  'verify.checks.anchorDetail': 'facultatif ; cet émetteur ne l’a pas activé',
  'verify.checks.passed': 'réussi',
  'verify.checks.failed': 'échoué',
  'verify.checks.notChecked': 'non vérifié',

  'verify.errors.title': 'Pourquoi cela a échoué',

  'verify.action.download': 'Télécharger',
  'verify.action.share': 'Partager',
  'verify.action.shareCopied': 'Lien copié',
  'verify.action.addToLinkedIn': 'Ajouter au profil LinkedIn',
  // Apple and Google specify this wording themselves and treat it as a
  // trademark matter, so the platform name is not translated.
  'verify.action.addToAppleWallet': 'Ajouter à Apple Wallet',
  'verify.action.addToGoogleWallet': 'Ajouter à Google Wallet',
  'verify.action.viewJson': 'Voir le JSON signé',
  'verify.action.verifyAnother': 'Vérifier une autre attestation',

  'verify.developers.title': 'Pour les développeurs et les employeurs',
  'verify.developers.body':
    'Cette attestation est un Open Badge 3.0 / une Attestation Vérifiable W3C. Vous pouvez la vérifier vous-même, avec n’importe quel vérificateur conforme, sans passer par cette page.',
  'verify.developers.jsonLink': 'JSON signé de l’attestation',
  'verify.developers.issuerDid': 'DID de l’émetteur',

  'verify.contact': 'Une question sur cette attestation ? Écrivez à {email}.',
  'verify.poweredBy':
    'Délivrée avec OpenCred, la plateforme de certification open source. N’importe qui peut l’héberger, et n’importe qui peut l’auditer.',

  'notFound.title': 'Aucune attestation ne correspond à cet identifiant',
  'notFound.subtitle': 'Cet émetteur n’a jamais rien délivré sous cet identifiant.',
  'notFound.reasons': 'Deux raisons sont fréquentes :',
  'notFound.typo.label': 'Une faute de frappe.',
  'notFound.typo.body':
    'Les identifiants ne contiennent jamais les chiffres 0 ou 1, ni les lettres o, i ou l — ils sont exclus précisément parce qu’on les confond. Vérifiez l’identifiant sur le certificat et réessayez.',
  'notFound.forged.label': 'L’attestation n’est pas authentique.',
  'notFound.forged.body':
    'Si l’identifiant a été copié exactement depuis un document et reste introuvable, ce document n’a pas été délivré par cette plateforme.',
  'notFound.tryAnother': 'Essayer un autre identifiant',

  'wallet.title': 'Vos attestations',
  'wallet.intro':
    'Tous les certificats et badges délivrés à votre adresse e-mail, par toutes les organisations, au même endroit.',
  'wallet.emailLabel': 'Votre adresse e-mail',
  'wallet.emailHint': 'L’adresse à laquelle vos attestations ont été envoyées. Aucun mot de passe requis.',
  'wallet.requestLink': 'M’envoyer un lien de connexion',
  'wallet.checkInbox': 'Consultez votre boîte de réception',
  'wallet.checkInboxBody':
    'Si {email} a reçu des attestations, un lien de connexion est en route. Il est valable 30 minutes.',
  'wallet.privacyNote':
    'Nous n’indiquons délibérément pas si une adresse possède des attestations : cela permettrait à n’importe qui de savoir qui détient quoi.',
  'wallet.empty': 'Rien n’a encore été délivré à cette adresse sur cette installation.',
  'wallet.count': '{count} délivrées à {email}',
  'wallet.issuedOn': 'Délivrée le {date}',
  'wallet.expiresOn': 'expire le {date}',
  'wallet.action.verificationPage': 'Page de vérification',
  'wallet.theseAreYours': 'Elles vous appartiennent',
  'wallet.theseAreYoursBody':
    'Chaque attestation est un document signé et portable. Vous pouvez télécharger le JSON et le conserver, ou le remettre à n’importe quel vérificateur conforme : il restera vérifiable même si l’organisation émettrice cesse d’utiliser cette plateforme.',
  'wallet.signOut': 'Se déconnecter',

  'email.download': 'Téléchargez votre attestation',
  'email.viewVerification': 'Voir la page publique de vérification',
  'email.addToLinkedIn': 'Ajouter à votre profil LinkedIn',
  'email.viewAll': 'Voir toutes vos attestations',
  'email.assurance':
    'Cette attestation est signée cryptographiquement. N’importe qui peut confirmer son authenticité via le lien de vérification ci-dessus, sans créer de compte.',
  'email.issuedWith': 'Délivrée avec OpenCred, la plateforme de certification open source.',

  'status.valid': 'Valide',
  'status.expired': 'Expirée',
  'status.revoked': 'Révoquée',
  'status.processing': 'En cours',
};
