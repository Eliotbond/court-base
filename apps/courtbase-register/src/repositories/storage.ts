import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage'
import { firebaseApp } from '@/services/firebase'

/**
 * Helpers Storage — upload des documents de registration / licence.
 *
 * Conventions de chemin (cf. `storage.rules` + `docs/chantier-registrations.md` §12) :
 *  - `registrations/{uid}/{registrationId}/{filename}` — lettre de sortie et
 *    autres pièces liées à une registration.
 *  - `licenseRequests/{uid}/{requestId}/{filename}` — pièces ID, formulaire
 *    de licence signé.
 *
 * Le segment `{uid}` est l'UID Firebase Auth de l'uploader (auteur de la
 * registration, ou linked member / guardian pour les docs de licence). Le
 * mapping uid ↔ memberId de la licenseRequest sera enforced côté callable
 * `uploadLicenseDocument` (Admin SDK) — les rules Storage valident juste
 * auth + taille + type (limitation `firestore.get()` cross-service).
 *
 * Le SDK Storage retourne un `fullPath` qu'on stocke dans Firestore
 * (`registration.transferLetterStoragePath`, etc.). Les `downloadURL` sont
 * résolus on-demand côté UI — pas dénormalisés (les tokens d'URL changent
 * si les rules sont reset).
 */

const storage = getStorage(firebaseApp)

export interface UploadResult {
  storagePath: string
  contentType: string
  size: number
}

/**
 * Upload une lettre de sortie pour une registration. Retourne le storagePath
 * à stocker dans `registration.transferLetterStoragePath` via
 * `registrations.repo.updateDraft`.
 *
 * Le path utilise `{uid}` (auteur de la registration = current user) pour
 * respecter la convention des rules Storage.
 */
export async function uploadTransferLetter(args: {
  uid: string
  registrationId: string
  file: File
}): Promise<UploadResult> {
  const { uid, registrationId, file } = args
  const ext = inferExtension(file)
  const path = `registrations/${uid}/${registrationId}/transfer_letter${ext}`
  const fileRef = ref(storage, path)
  await uploadBytes(fileRef, file, { contentType: file.type })
  return {
    storagePath: path,
    contentType: file.type,
    size: file.size,
  }
}

/**
 * Upload générique d'un document licence (pièce ID recto/verso, formulaire
 * signé, lettre de sortie post-fact). `kind` détermine le nom de fichier
 * cible — unique par `(uid, requestId, kind)` pour permettre le
 * remplacement (refus admin → re-upload même path).
 *
 * `uid` est l'auteur (= linked member ou guardian — caller signed-in). Le
 * mapping uid ↔ memberId du licenseRequest est validé serveur-side par la
 * callable `uploadLicenseDocument` à venir Phase E.
 */
export async function uploadLicenseDocument(args: {
  uid: string
  requestId: string
  kind: 'id_front' | 'id_back' | 'license_form_signed' | 'transfer_letter'
  file: File
}): Promise<UploadResult> {
  const { uid, requestId, kind, file } = args
  const ext = inferExtension(file)
  const path = `licenseRequests/${uid}/${requestId}/${kind}${ext}`
  const fileRef = ref(storage, path)
  await uploadBytes(fileRef, file, { contentType: file.type })
  return {
    storagePath: path,
    contentType: file.type,
    size: file.size,
  }
}

/**
 * Résout l'URL signée d'un fichier Storage à la demande. Ne pas dénormaliser
 * dans Firestore — l'URL change si les rules sont reset. Le composant appelle
 * cette fonction au moment d'afficher l'aperçu / lien de téléchargement.
 */
export function getStorageUrl(storagePath: string): Promise<string> {
  return getDownloadURL(ref(storage, storagePath))
}

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

function inferExtension(file: File): string {
  const lastDot = file.name.lastIndexOf('.')
  if (lastDot >= 0) return file.name.slice(lastDot).toLowerCase()
  // Fallback rudimentaire sur le contentType.
  if (file.type === 'application/pdf') return '.pdf'
  if (file.type === 'image/png') return '.png'
  if (file.type === 'image/jpeg') return '.jpg'
  return ''
}
