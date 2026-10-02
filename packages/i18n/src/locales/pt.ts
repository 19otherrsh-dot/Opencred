import type { Catalogue } from './en';

/**
 * Portuguese (Brazilian usage, which is the larger LATAM market for this
 * product; European Portuguese differs mainly in the second person and a few
 * lexical choices).
 *
 * REVIEW STATUS: not yet reviewed by a native speaker.
 */
export const pt: Catalogue = {
  'verify.valid.title': 'Esta credencial é válida',
  'verify.valid.subtitle': 'Emitida por {issuer} e verificada criptograficamente agora mesmo.',
  'verify.revoked.title': 'Esta credencial foi revogada',
  'verify.revoked.subtitle': '{issuer} revogou esta credencial em {date}.',
  'verify.revoked.subtitleNoDate': '{issuer} revogou esta credencial.',
  'verify.expired.title': 'Esta credencial expirou',
  'verify.expired.subtitle': 'Foi válida até {date}.',
  'verify.invalid.title': 'Não foi possível verificar esta credencial',
  'verify.invalid.subtitle': 'A assinatura não corresponde ao conteúdo da credencial.',

  'verify.section.credential': 'Credencial',
  'verify.field.awardedTo': 'Concedida a',
  'verify.field.issuedBy': 'Emitida por',
  'verify.field.issueDate': 'Data de emissão',
  'verify.field.validUntil': 'Válida até',
  'verify.field.expired': 'Expirada',
  'verify.field.revoked': 'Revogada',
  'verify.field.credentialId': 'Identificador da credencial',

  'verify.checks.title': 'O que foi verificado',
  'verify.checks.subtitle':
    'Verificada em {timestamp}. Estas verificações são feitas a cada visita, não apenas na emissão.',
  'verify.checks.signature': 'Assinatura digital',
  'verify.checks.signatureDetail': 'a credencial não foi alterada desde a emissão',
  'verify.checks.issuer': 'Identidade do emissor',
  'verify.checks.issuerDetail': 'a chave de assinatura pertence ao emissor indicado',
  'verify.checks.issuerDetailDid': 'assinada por {did}',
  'verify.checks.revocation': 'Situação de revogação',
  'verify.checks.revocationDetail': 'verificada na lista de revogação publicada pelo emissor',
  'verify.checks.validity': 'Período de validade',
  'verify.checks.validityDetail': 'expira em {date}',
  'verify.checks.validityDetailNever': 'esta credencial não expira',
  'verify.checks.anchor': 'Carimbo de tempo externo',
  'verify.checks.anchorDetail': 'opcional; este emissor não o ativou',
  'verify.checks.passed': 'aprovado',
  'verify.checks.failed': 'reprovado',
  'verify.checks.notChecked': 'não verificado',

  'verify.errors.title': 'Por que falhou',

  'verify.action.download': 'Baixar',
  'verify.action.share': 'Compartilhar',
  'verify.action.shareCopied': 'Link copiado',
  'verify.action.addToLinkedIn': 'Adicionar ao perfil do LinkedIn',
  // Apple and Google specify this wording themselves and treat it as a
  // trademark matter, so the platform name is not translated.
  'verify.action.addToAppleWallet': 'Adicionar à Apple Wallet',
  'verify.action.addToGoogleWallet': 'Adicionar à Google Wallet',
  'verify.action.viewJson': 'Ver o JSON assinado',
  'verify.action.verifyAnother': 'Verificar outra credencial',

  'verify.developers.title': 'Para desenvolvedores e empregadores',
  'verify.developers.body':
    'Esta credencial é um Open Badge 3.0 / Credencial Verificável do W3C. Você pode verificá-la por conta própria, com qualquer verificador em conformidade, sem passar por esta página.',
  'verify.developers.jsonLink': 'JSON assinado da credencial',
  'verify.developers.issuerDid': 'DID do emissor',

  'verify.contact': 'Dúvidas sobre esta credencial? Escreva para {email}.',
  'verify.poweredBy':
    'Emitida com o OpenCred, a plataforma de credenciais de código aberto. Qualquer pessoa pode executá-la e qualquer pessoa pode auditá-la.',

  'notFound.title': 'Nenhuma credencial com esse identificador',
  'notFound.subtitle': 'Este emissor nunca emitiu nada com este identificador.',
  'notFound.reasons': 'Há dois motivos comuns:',
  'notFound.typo.label': 'Um erro de digitação.',
  'notFound.typo.body':
    'Os identificadores nunca contêm os dígitos 0 ou 1, nem as letras o, i ou l — eles são excluídos justamente porque são lidos errado. Confira o identificador no certificado e tente novamente.',
  'notFound.forged.label': 'A credencial não é autêntica.',
  'notFound.forged.body':
    'Se o identificador foi copiado exatamente de um documento e mesmo assim não aparece, esse documento não foi emitido por esta plataforma.',
  'notFound.tryAnother': 'Tentar outro identificador',

  'wallet.title': 'Suas credenciais',
  'wallet.intro':
    'Todos os certificados e selos já emitidos para o seu e-mail, de todas as organizações, em um só lugar.',
  'wallet.emailLabel': 'Seu endereço de e-mail',
  'wallet.emailHint': 'O endereço para onde suas credenciais foram enviadas. Sem senha.',
  'wallet.requestLink': 'Enviar um link de acesso',
  'wallet.checkInbox': 'Confira sua caixa de entrada',
  'wallet.checkInboxBody':
    'Se {email} recebeu alguma credencial, um link de acesso está a caminho. Ele vale por 30 minutos.',
  'wallet.privacyNote':
    'Não informamos, de propósito, se um endereço possui credenciais — isso permitiria a qualquer pessoa descobrir quem tem o quê.',
  'wallet.empty': 'Nada foi emitido para este endereço nesta instalação ainda.',
  'wallet.count': '{count} emitidas para {email}',
  'wallet.issuedOn': 'Emitida em {date}',
  'wallet.expiresOn': 'expira em {date}',
  'wallet.action.verificationPage': 'Página de verificação',
  'wallet.theseAreYours': 'Elas são suas',
  'wallet.theseAreYoursBody':
    'Cada credencial é um documento assinado e portátil. Você pode baixar o JSON e guardá-lo, ou entregá-lo a qualquer verificador em conformidade — ele continuará verificável mesmo que a organização emissora deixe de usar esta plataforma.',
  'wallet.signOut': 'Sair',

  'email.download': 'Baixe sua credencial',
  'email.viewVerification': 'Ver a página pública de verificação',
  'email.addToLinkedIn': 'Adicionar ao seu perfil do LinkedIn',
  'email.viewAll': 'Ver todas as suas credenciais',
  'email.assurance':
    'Esta credencial é assinada criptograficamente. Qualquer pessoa pode confirmar que é autêntica no link de verificação acima — sem precisar de conta.',
  'email.issuedWith': 'Emitida com o OpenCred, a plataforma de credenciais de código aberto.',

  'status.valid': 'Válida',
  'status.expired': 'Expirada',
  'status.revoked': 'Revogada',
  'status.processing': 'Processando',
};
