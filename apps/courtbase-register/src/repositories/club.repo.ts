import { FirestoreError, doc, getDoc } from 'firebase/firestore'
import type { ClubConfig, ClubConfigData } from '@club-app/shared-types'
import { db } from '@/services/firebase'

/**
 * Repository Club — Firestore-backed (côté app courtbase-register).
 *
 * Lecture seule du singleton `/config/club`. Les écritures sur `/config/club`
 * sont admin-only et vivent dans `apps/web` (Settings).
 *
 * Permissions (cf. `firestore.rules` §config) : lecture autorisée à tout
 * `isSignedIn()`. Le contenu (nom, logo, IBAN du club) est diffusé en clair
 * dans les emails de demande de paiement et dans l'écran "Payer" — pas de PII
 * tierce ici.
 *
 * Pourquoi un fichier séparé (et pas `settings.repo.ts`) : aucun
 * infrastructure de lecture club n'existait avant ce chantier dans l'app
 * register. Pour rester cohérent avec le scope (lecture only, no settings
 * editing depuis register), on isole dans `club.repo.ts`.
 */

const CONFIG_DOC_PATH = ['config', 'club'] as const

/**
 * Lit le doc `/config/club`. Retourne `null` si le doc n'existe pas (projet
 * fraîchement provisionné, pas encore initialisé) ou si la lecture échoue
 * pour permission. Sinon retourne `ClubConfig` complet.
 */
export async function loadClubConfig(): Promise<ClubConfig | null> {
  try {
    const snap = await getDoc(doc(db, CONFIG_DOC_PATH[0], CONFIG_DOC_PATH[1]))
    if (!snap.exists()) return null
    const data = snap.data() as ClubConfigData
    return { id: snap.id, ...data }
  } catch (err) {
    if (err instanceof FirestoreError && err.code === 'permission-denied') {
      return null
    }
    throw err
  }
}
