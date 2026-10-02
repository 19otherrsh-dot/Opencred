import type { Catalogue } from './en';

/**
 * Spanish.
 *
 * REVIEW STATUS: not yet reviewed by a native speaker.
 *
 * That is recorded honestly rather than quietly, because these strings appear
 * on a page whose entire job is to be trusted. `localeStatus()` reports it, and
 * the launch checklist in docs/localisation.md tracks it. Do not remove this
 * note without an actual review.
 */
export const es: Catalogue = {
  'verify.valid.title': 'Esta credencial es válida',
  'verify.valid.subtitle': 'Emitida por {issuer} y verificada criptográficamente ahora mismo.',
  'verify.revoked.title': 'Esta credencial ha sido revocada',
  'verify.revoked.subtitle': '{issuer} revocó esta credencial el {date}.',
  'verify.revoked.subtitleNoDate': '{issuer} revocó esta credencial.',
  'verify.expired.title': 'Esta credencial ha caducado',
  'verify.expired.subtitle': 'Fue válida hasta el {date}.',
  'verify.invalid.title': 'No se ha podido verificar esta credencial',
  'verify.invalid.subtitle': 'La firma no coincide con el contenido de la credencial.',

  'verify.section.credential': 'Credencial',
  'verify.field.awardedTo': 'Otorgada a',
  'verify.field.issuedBy': 'Emitida por',
  'verify.field.issueDate': 'Fecha de emisión',
  'verify.field.validUntil': 'Válida hasta',
  'verify.field.expired': 'Caducada',
  'verify.field.revoked': 'Revocada',
  'verify.field.credentialId': 'Identificador de la credencial',

  'verify.checks.title': 'Qué se ha comprobado',
  'verify.checks.subtitle':
    'Verificada el {timestamp}. Estas comprobaciones se realizan en cada visita, no solo al emitirse.',
  'verify.checks.signature': 'Firma digital',
  'verify.checks.signatureDetail': 'la credencial no ha sido alterada desde su emisión',
  'verify.checks.issuer': 'Identidad del emisor',
  'verify.checks.issuerDetail': 'la clave de firma pertenece al emisor indicado',
  'verify.checks.issuerDetailDid': 'firmada por {did}',
  'verify.checks.revocation': 'Estado de revocación',
  'verify.checks.revocationDetail': 'comprobado con la lista de revocación publicada por el emisor',
  'verify.checks.validity': 'Periodo de validez',
  'verify.checks.validityDetail': 'caduca el {date}',
  'verify.checks.validityDetailNever': 'esta credencial no caduca',
  'verify.checks.anchor': 'Anclaje temporal externo',
  'verify.checks.anchorDetail': 'opcional; este emisor no lo ha activado',
  'verify.checks.passed': 'correcto',
  'verify.checks.failed': 'incorrecto',
  'verify.checks.notChecked': 'no comprobado',

  'verify.errors.title': 'Por qué ha fallado',

  'verify.action.download': 'Descargar',
  'verify.action.share': 'Compartir',
  'verify.action.shareCopied': 'Enlace copiado',
  'verify.action.addToLinkedIn': 'Añadir al perfil de LinkedIn',
  // Apple and Google specify this wording themselves and treat it as a
  // trademark matter, so the platform name is not translated.
  'verify.action.addToAppleWallet': 'Añadir a Apple Wallet',
  'verify.action.addToGoogleWallet': 'Añadir a Google Wallet',
  'verify.action.viewJson': 'Ver el JSON firmado',
  'verify.action.verifyAnother': 'Verificar otra credencial',

  'verify.developers.title': 'Para desarrolladores y empleadores',
  'verify.developers.body':
    'Esta credencial es una Open Badge 3.0 / Credencial Verificable del W3C. Puede verificarla usted mismo, con cualquier verificador conforme, sin pasar por esta página.',
  'verify.developers.jsonLink': 'JSON firmado de la credencial',
  'verify.developers.issuerDid': 'DID del emisor',

  'verify.contact': '¿Tiene dudas sobre esta credencial? Escriba a {email}.',
  'verify.poweredBy':
    'Emitida con OpenCred, la plataforma de credenciales de código abierto. Cualquiera puede ejecutarla y cualquiera puede auditarla.',

  'notFound.title': 'No existe ninguna credencial con ese identificador',
  'notFound.subtitle': 'Este emisor nunca ha emitido nada con este identificador.',
  'notFound.reasons': 'Hay dos motivos habituales:',
  'notFound.typo.label': 'Un error al escribir.',
  'notFound.typo.body':
    'Los identificadores nunca contienen los dígitos 0 o 1, ni las letras o, i o l — se excluyen precisamente porque se leen mal. Compruebe el identificador en el certificado e inténtelo de nuevo.',
  'notFound.forged.label': 'La credencial no es auténtica.',
  'notFound.forged.body':
    'Si ha copiado el identificador exactamente de un documento y aun así no aparece, ese documento no se emitió a través de esta plataforma.',
  'notFound.tryAnother': 'Probar otro identificador',

  'wallet.title': 'Sus credenciales',
  'wallet.intro':
    'Todos los certificados e insignias emitidos a su dirección de correo, de todas las organizaciones, en un solo lugar.',
  'wallet.emailLabel': 'Su dirección de correo',
  'wallet.emailHint': 'La dirección a la que se enviaron sus credenciales. No hace falta contraseña.',
  'wallet.requestLink': 'Enviarme un enlace de acceso',
  'wallet.checkInbox': 'Revise su bandeja de entrada',
  'wallet.checkInboxBody':
    'Si {email} ha recibido alguna credencial, le enviamos un enlace de acceso. Es válido durante 30 minutos.',
  'wallet.privacyNote':
    'Deliberadamente no indicamos si una dirección tiene credenciales: eso permitiría a cualquiera averiguar quién posee qué.',
  'wallet.empty': 'Todavía no se ha emitido nada a esta dirección en esta instalación.',
  'wallet.count': '{count} emitidas a {email}',
  'wallet.issuedOn': 'Emitida el {date}',
  'wallet.expiresOn': 'caduca el {date}',
  'wallet.action.verificationPage': 'Página de verificación',
  'wallet.theseAreYours': 'Estas son suyas',
  'wallet.theseAreYoursBody':
    'Cada credencial es un documento firmado y portátil. Puede descargar el JSON y conservarlo, o entregarlo a cualquier verificador conforme: seguirá siendo comprobable aunque la organización emisora deje de usar esta plataforma.',
  'wallet.signOut': 'Cerrar sesión',

  'email.download': 'Descargue su credencial',
  'email.viewVerification': 'Ver la página pública de verificación',
  'email.addToLinkedIn': 'Añadir a su perfil de LinkedIn',
  'email.viewAll': 'Ver todas sus credenciales',
  'email.assurance':
    'Esta credencial está firmada criptográficamente. Cualquiera puede confirmar que es auténtica en el enlace de verificación anterior, sin necesidad de cuenta.',
  'email.issuedWith': 'Emitida con OpenCred, la plataforma de credenciales de código abierto.',

  'status.valid': 'Válida',
  'status.expired': 'Caducada',
  'status.revoked': 'Revocada',
  'status.processing': 'Procesando',
};
