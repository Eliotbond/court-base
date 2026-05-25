/**
 * Registry des modules templates supportés par le sender.
 *
 * Le sender lookup `templates[doc.template]` et marque `unknown_template`
 * si la clé n'est pas présente. Au fil des PRs, les nouveaux templates
 * s'ajoutent ici (PR2 : 5 migrations, PR3 : 2 trial, PR4 : 4 licence).
 */
import type { EmailTemplateKey, TemplateModule } from '../types'
import { registrationSubmittedConfirm } from './registration_submitted_confirm'

/**
 * Map partielle (templates effectivement implémentés). Les clés non
 * présentes dans le registry sont traitées comme "unknown_template" par le
 * sender et marquées `status='failed'`.
 *
 * Le type `Partial` reflète l'état évolutif : tous les `EmailTemplateKey`
 * sont déclarés dans `types.ts` (contrat), mais seuls ceux migrés sont
 * implémentés ici.
 */
export const templates: Partial<{
  [K in EmailTemplateKey]: TemplateModule<K>
}> = {
  registration_submitted_confirm: registrationSubmittedConfirm,
}

/** Helper de lookup type-safe. Retourne `undefined` si non implémenté. */
export function getTemplate(
  key: string,
): TemplateModule | undefined {
  if (!isKnownKey(key)) return undefined
  return templates[key] as TemplateModule | undefined
}

function isKnownKey(key: string): key is EmailTemplateKey {
  return key in templates
}
