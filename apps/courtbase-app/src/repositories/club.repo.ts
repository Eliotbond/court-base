import { FirestoreError, doc, getDoc } from 'firebase/firestore'
import type { ClubConfig, ClubConfigData } from '@club-app/shared-types'
import { db } from '@/services/firebase'

/**
 * Repository Club — lecture du doc singleton `/config/club`.
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. `apps/courtbase-app/CLAUDE.md` — architecture en couches).
 *
 * Lecture-only depuis l'app companion : toutes les écritures vivent côté
 * `apps/web` (Settings → Club info, admin-only). Ici on se contente de
 * brancher le nom, le shortCode et l'URL du logo dans le shell.
 *
 * Permissions (cf. `firestore.rules` §config) : `read` ouvert à tout
 * signed-in. `permission-denied` ⇒ dégrade en `null` (un coach/officiel non
 * signed-in ne devrait pas atteindre cet écran, mais on évite la propagation
 * d'erreur qui casserait le shell).
 *
 * Doc absent (projet vierge avant `runMigrations`) ⇒ `null` aussi : le store
 * tombera sur ses valeurs par défaut.
 */
export async function getClubConfig(): Promise<ClubConfig | null> {
  try {
    const snap = await getDoc(doc(db, 'config', 'club'))
    if (!snap.exists()) return null
    return { id: snap.id, ...(snap.data() as ClubConfigData) }
  } catch (err) {
    if (err instanceof FirestoreError && err.code === 'permission-denied') {
      return null
    }
    const code = err instanceof FirestoreError ? err.code : 'unknown'
    console.error(`[club.repo] getClubConfig failed [${code}]`, err)
    throw err
  }
}
