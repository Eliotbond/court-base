/**
 * Repo mock pour les demandes de licence parent.
 *
 * Source de vérité : les fixtures partagées de `@club-app/shared-types`
 * (`MOCK_LICENSE_REQUESTS`). Les patches (upload doc, AVS saisi, contexte
 * étranger, submit) sont stockés en **sessionStorage** sous une clé unique —
 * `loadAll` fusionne les deux pour donner l'état effectif à l'UI.
 *
 * Conventions :
 *  - Pas de Firebase / Storage réel.
 *  - Les `url` blob (`URL.createObjectURL(file)`) ne survivent pas au refresh ;
 *    on persiste `fileName`/`sizeBytes`/`uploadedAt` mais on remplace `url`
 *    par un sentinel `'mock://lost-after-refresh'` pour signaler la perte du
 *    preview (cohérent avec `Step6TransferLetter.vue`).
 *  - Tout merge est immuable : on ne mute jamais `MOCK_LICENSE_REQUESTS`.
 */

import {
  MOCK_LICENSE_REQUESTS,
  getMockLicenseRequestById,
  type LicenseRequestMock,
  type UploadedDocFileMock,
} from '@club-app/shared-types'

const STORAGE_KEY = 'court-base.register.mockLicenseRequests'
const LOST_BLOB_SENTINEL = 'mock://lost-after-refresh'

/** Patch partiel persisté en sessionStorage. */
type StoredOverride = Partial<LicenseRequestMock> & { id: string }

function readOverrides(): Record<string, StoredOverride> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, StoredOverride>
  } catch (err) {
    console.warn(`[licenseRequests.mock] readOverrides failed`, err)
    return {}
  }
}

function writeOverrides(map: Record<string, StoredOverride>): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch (err) {
    console.warn(`[licenseRequests.mock] writeOverrides failed`, err)
  }
}

/**
 * Sanitize un override avant persistance : remplace les URL blob (jamais
 * réutilisables après refresh) par un sentinel, conserve fileName/sizeBytes.
 */
function sanitizeForStorage(req: LicenseRequestMock): LicenseRequestMock {
  const cleaned: typeof req.uploadedDocs = {}
  for (const [k, v] of Object.entries(req.uploadedDocs)) {
    if (!v) {
      cleaned[k as keyof typeof req.uploadedDocs] = null
      continue
    }
    cleaned[k as keyof typeof req.uploadedDocs] = {
      ...v,
      url: v.url.startsWith('blob:') ? LOST_BLOB_SENTINEL : v.url,
    }
  }
  return { ...req, uploadedDocs: cleaned }
}

/**
 * Merge une fixture source avec son override sessionStorage (le cas échéant).
 * Si pas d'override, renvoie la fixture telle quelle.
 */
function mergeWithOverride(
  fixture: LicenseRequestMock,
  override: StoredOverride | undefined,
): LicenseRequestMock {
  if (!override) return fixture
  return { ...fixture, ...override }
}

/**
 * Charge l'état effectif de toutes les demandes : fixtures source + patches.
 * Renvoie aussi les requests créées dynamiquement (bouton dev "Simuler") qui
 * n'ont pas de fixture source — elles vivent uniquement en sessionStorage.
 */
export function loadAll(): LicenseRequestMock[] {
  const overrides = readOverrides()
  const out: LicenseRequestMock[] = []
  const seen = new Set<string>()

  // 1. Fixtures source (mergées avec override si présent).
  for (const fixture of MOCK_LICENSE_REQUESTS) {
    out.push(mergeWithOverride(fixture, overrides[fixture.id]))
    seen.add(fixture.id)
  }

  // 2. Requests dev-seeded (pas de fixture source — full doc en override).
  for (const id of Object.keys(overrides)) {
    if (seen.has(id)) continue
    const o = overrides[id]
    // Un override sans fixture source doit être un doc complet — on filtre
    // les patches orphelins (sécurité, ne devrait pas arriver).
    if (
      o &&
      o.memberId &&
      o.teamId &&
      o.status &&
      o.requiredDocs &&
      o.denorm
    ) {
      out.push(o as LicenseRequestMock)
    }
  }

  return out
}

/** Renvoie l'état effectif d'une request donnée (fixture + override). */
export function getById(id: string): LicenseRequestMock | undefined {
  const overrides = readOverrides()
  const fixture = getMockLicenseRequestById(id)
  if (fixture) return mergeWithOverride(fixture, overrides[id])
  const o = overrides[id]
  if (
    o &&
    o.memberId &&
    o.teamId &&
    o.status &&
    o.requiredDocs &&
    o.denorm
  ) {
    return o as LicenseRequestMock
  }
  return undefined
}

/**
 * Persiste un patch override pour une request. Le doc fusionné est sanitizé
 * (URL blob remplacées par sentinel).
 */
export function persistOverride(request: LicenseRequestMock): void {
  const overrides = readOverrides()
  const sanitized = sanitizeForStorage(request)
  overrides[request.id] = sanitized
  writeOverrides(overrides)
}

/**
 * Seed dev — utilisé par le bouton "🧪 Simuler demande coach" sur Home.
 * Crée une request synthétique en sessionStorage avec un id `dev-` préfixé.
 * Ne mute jamais les fixtures source.
 */
export function seedDevLicenseRequest(args: {
  memberId: string
  teamId: string
  memberFirstName: string
  memberLastName: string
  teamName?: string
  coachName?: string
  requiredDocs?: LicenseRequestMock['requiredDocs']
  status?: LicenseRequestMock['status']
}): LicenseRequestMock {
  const id = `dev-${args.memberId}-${Date.now().toString(36)}`
  const doc: LicenseRequestMock = {
    id,
    memberId: args.memberId,
    teamId: args.teamId,
    requestedBy: 'dev-coach',
    status: args.status ?? 'pending_parent_docs',
    requiredDocs: args.requiredDocs ?? ['id_front', 'id_back'],
    uploadedDocs: {},
    parentNotes: null,
    parentCompletedAt: null,
    createdAt: Date.now(),
    denorm: {
      memberFirstName: args.memberFirstName,
      memberLastName: args.memberLastName,
      teamName: args.teamName ?? 'Équipe (dev)',
      coachName: args.coachName ?? 'Coach Démo',
    },
  }
  persistOverride(doc)
  return doc
}

/**
 * Supprime tous les overrides — utilitaire de debug (non exposé à l'UI).
 * Exporté pour faciliter les snapshots de tests futurs.
 */
export function clearAllOverrides(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* noop */
  }
}

export const __testing__ = { STORAGE_KEY, LOST_BLOB_SENTINEL }

// Re-export du type pour les consumers (store) qui ne veulent pas réimporter
// depuis shared-types.
export type { LicenseRequestMock, UploadedDocFileMock }
