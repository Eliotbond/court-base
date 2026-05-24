import {
  FirestoreError,
  collection,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore'
import type { Season, SeasonData } from '@club-app/shared-types'
import { db } from '@/services/firebase'

/**
 * Repository Seasons — lecture seule de la saison active depuis l'app
 * companion.
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase (cf.
 * `apps/courtbase-app/CLAUDE.md` — architecture en couches).
 *
 * L'app companion n'expose volontairement QUE la saison courante (consigne
 * produit : un coach/officiel travaille toujours dans la saison active, jamais
 * dans une archive ou un draft). Pas de listing global ni de getById ici —
 * si un cas d'usage l'impose, le wiring se fait depuis `apps/web`.
 *
 * Query : `where status == 'active' limit 1` — égalité simple, aucun index
 * composite requis. Au plus une saison `active` à la fois côté métier (cf.
 * `docs/main.md` §Season lifecycle).
 *
 * Permissions (`firestore.rules` §seasons) : `read` ouvert à tout signed-in.
 * `permission-denied` ⇒ dégrade en `null` pour ne pas bloquer le shell.
 */
export async function getActiveSeason(): Promise<Season | null> {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'seasons'),
        where('status', '==', 'active'),
        limit(1),
      ),
    )
    if (snap.empty) return null
    const first = snap.docs[0]
    if (!first) return null
    return { id: first.id, ...(first.data() as SeasonData) }
  } catch (err) {
    if (err instanceof FirestoreError && err.code === 'permission-denied') {
      return null
    }
    const code = err instanceof FirestoreError ? err.code : 'unknown'
    console.error(`[seasons.repo] getActiveSeason failed [${code}]`, err)
    throw err
  }
}
