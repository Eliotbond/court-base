# Feature — Photo licence du membre

> **État** : brief posé 2026-05-24. Implémentation à venir (4 PR / agents parallèles).
> **Owner produit** : Eliot. **Stack** : Vue 3 + Pinia + Firebase (Storage + Firestore + Functions).

## Intention

Permettre au **coach** d'attacher une **photo portrait** à un membre de son équipe. Cette photo sera **réutilisée par l'admin/trésorier** lors de la création de la licence fédérale (Swiss Basketball impose une photo de type passeport sur la licence émise).

**Règle métier durcie** :
> Un membre **doit avoir une photo** avant que le coach puisse **valider l'ensemble des documents** d'une demande de licence (transition `parent_docs_submitted → coach_validated`).

La photo n'est pas requise pour démarrer une demande, ni pour reviewer un document individuel — uniquement pour la **transition finale côté coach** qui passe la main au trésorier.

## Périmètre

### Inclus (v1)
- Upload via **caméra directe** (mobile) ou **fichier** (desktop ou galerie mobile).
- Stockage Storage + référence dénormalisée sur `/members/{id}`.
- Affichage sur la fiche membre côté coach (`apps/courtbase-app`) et admin (`apps/web`).
- Affichage sur la vue review de demande de licence (admin + coach).
- Pré-condition serveur `coachReviewLicenseDoc` : refuse la transition `coach_validated` si pas de photo.
- Pré-condition UI coach (banner + bouton désactivé) en miroir.
- Replace : un upload écrase l'ancien fichier Storage.
- Suppression manuelle (admin uniquement).

### Hors scope (v1)
- **Validation automatique du fond clair/uni** — impossible sans pipeline ML. Garde-fou = guideline visuelle ("Fond clair et uni, type photo passeport") + responsabilité coach (qui doit re-uploader si la qualité ne convient pas à la fédération).
- **Crop / aspect ratio enforcement** — recommandé portrait ~35x45 mm (format passeport CH) mais pas enforced techniquement. L'admin peut re-cropper hors plateforme si besoin.
- **Génération automatique de carte licence PDF avec la photo** — la photo est juste exposée dans l'UI ; la création de la carte fédérale reste hors plateforme.
- **Upload côté parent** (depuis `apps/courtbase-register`) — non. La qualité photo est sous responsabilité coach (contrôle visuel direct).
- **Compression / redimensionnement client-side** — la limite de taille (≤ 5 Mo) suffit pour v1.

## Schéma Firestore

Étendre `MemberData` (`packages/shared-types/src/member.ts`) avec :

```ts
interface MemberData {
  // ... champs existants ...

  /**
   * Chemin Storage de la photo licence du membre.
   * Pattern : `members/{memberId}/license-photo.{ext}`.
   * `null` si aucune photo n'a encore été uploadée.
   * Posé par les callables coach/admin uniquement (pas d'écriture self).
   */
  photoStoragePath: string | null

  /** Timestamp du dernier upload (audit + cache-busting URL). `null` si aucune photo. */
  photoUpdatedAt: Timestamp | null

  /** UID du coach/admin qui a uploadé la dernière version. `null` si aucune photo. */
  photoUpdatedByUid: string | null
}
```

**Pas de migration** : ces champs sont nullables et tolérés absents (lecture defensive `?? null`).

## Schéma Storage

```
/members/{memberId}/license-photo.{ext}
```

- `{ext}` ∈ {`jpg`, `jpeg`, `png`, `webp`} (validé côté UI + rules).
- **Une seule photo active** par membre — le `photoStoragePath` Firestore référence l'unique fichier. Sur replace, le store **supprime explicitement** l'ancien fichier Storage avant d'uploader le nouveau (best-effort dans une `Promise.all` non-bloquante).

### Storage rules adoptées (`storage.rules`) — PR-A livrée

Convention du fichier : pas de cross-doc lookup Firestore depuis Storage (cohérent avec `/club/logo`, `/accounting/invoices`). Et `MemberData.teamIds` n'existe pas (la SoT est `/teams.coachIds` / `/teams.playerIds` — non itérable en rule).

→ **Rule Storage permissive** (signed-in seulement, size/MIME validés) :

```javascript
match /members/{memberId}/{fileName} {
  allow read:   if isSignedIn();
  allow write:  if isSignedIn()
                && request.resource.size <= 5 * 1024 * 1024
                && request.resource.contentType.matches('image/(jpeg|png|webp)');
  allow delete: if isSignedIn();
}
```

→ **La vraie autorisation passe par 2 callables Admin SDK** (cf. PR-B) qui re-vérifient le scope coach côté serveur via le helper existant `assertCoachOrAdminOfMember` (`functions/src/members/_coachAuth.ts`) — pattern identique à `coachUpdateMember`. C'est aussi cette callable qui pose `member.photoStoragePath` (les rules `/members` Firestore restent write-admin-only).

## Workflow

```
┌──────────────────────────────────────┐
│ Coach ouvre fiche membre             │
│ (courtbase-app MemberDetail.vue)     │
└──────────────────┬───────────────────┘
                   │
                   ▼ tap "Ajouter photo"
┌──────────────────────────────────────┐
│ Bottom-sheet propose :               │
│  • "Prendre une photo" (caméra)      │
│  • "Choisir depuis la galerie"       │
└──────────────────┬───────────────────┘
                   │ file sélectionné
                   ▼
┌──────────────────────────────────────┐
│ Preview + bouton "Enregistrer"       │
│ Guidelines : "Fond clair et uni,     │
│ type photo passeport"                │
└──────────────────┬───────────────────┘
                   │ confirme
                   ▼
┌──────────────────────────────────────┐
│ Store action `setMemberPhoto(id, f)` │
│  1. Delete ancien Storage (if any)   │
│  2. uploadBytes Storage              │
│  3. updateDoc `/members/{id}` :      │
│     photoStoragePath / At / ByUid    │
└──────────────────────────────────────┘
```

### Implémentation upload caméra + fichier

Pattern HTML standard :

```html
<input type="file" accept="image/jpeg,image/png,image/webp" capture="user" />
```

- `accept="image/jpeg,image/png,image/webp"` — restreint le picker.
- `capture="user"` — ouvre la **caméra frontale** par défaut sur mobile (pour photo type selfie / passeport). Desktop ignore l'attribut → file picker classique.
- Pas besoin d'API MediaDevices custom : le navigateur mobile propose nativement "Prendre une photo / Galerie".

UI : un seul bouton `Ajouter une photo` qui ouvre le picker. Sur iOS/Android le natif propose les deux options dans une sheet système. Pas de double bouton custom.

## Validation gate côté coach

### Backend — `coachReviewLicenseDoc`

Dans la transaction (`functions/src/licenses/coachReviewLicenseDoc.ts`) :

1. Lire `member` (`tx.get(memberRef)`) en plus du license request.
2. Calculer `allCoachAccepted` (logique existante).
3. **Avant la transition vers `coach_validated`** : si `decision === 'accept'` ET `allCoachAccepted === true` ET `member.photoStoragePath == null` → throw :

```ts
throw new HttpsError(
  'failed-precondition',
  '[coachReviewLicenseDoc] Photo membre requise avant validation finale. ' +
  'Uploader la photo licence depuis la fiche du membre.',
)
```

Tests à étendre : ajouter cas "photo manquante bloque la transition `coach_validated`" + cas "photo posée → transition OK".

### Frontend — `LicenseRequestReview.vue` (courtbase-app)

- Lire `member.photoStoragePath` (déjà disponible via `useMembersStore` ou via le `request.denorm` étendu — préférer lecture live du member pour cohérence avec un upload pendant la review).
- Banner top de page si `!photoStoragePath` :
  > **Photo licence manquante** — vous devez uploader une photo membre avant de pouvoir valider la demande. [Bouton "Ouvrir la fiche membre"].
- Désactiver le bouton "Valider la demande" (et désactiver le dernier "Valider" per-doc qui déclencherait la transition `coach_validated`) tant que `photoStoragePath` est null. Tooltip : "Photo membre requise".
- Validation per-doc tant que `!allCoachAccepted` reste autorisée (le coach peut review les pièces avant d'uploader la photo).

## Affichage

### `apps/courtbase-app` (coach)
- **`MemberDetail.vue`** — nouvelle section "Photo licence" (après l'identité, avant cotisations) :
  - Si pas de photo : placeholder gris + bouton "Ajouter une photo".
  - Si photo : thumbnail carré 96x96, bouton "Remplacer" + bouton "Supprimer" (admin only).
- **`LicenseRequestReview.vue`** — afficher la thumbnail dans la card Info du membre (avec lien vers fiche membre pour modifier).

### `apps/web` (admin / trésorier)
- **`ProfileTab.vue`** (`/members/:id`) — section "Photo licence" sous l'Identité :
  - Mêmes UI (placeholder ou thumbnail + actions).
  - Visible à `admin | treasurer | coach`. Édition à `admin | rootAdmin | coach scope`. Suppression à `admin | rootAdmin`.
- **`LicenseRequestReview.vue`** (`/license-requests/:id`) — thumbnail dans la card Info, lien "Ouvrir fiche membre" si modification.

## Couches code

```
Storage (members/{id}/license-photo.{ext})
  ↑
client uploadBytes(file) direct → storagePath
  ↓
Callable `setMemberLicensePhoto` (Admin SDK)
  • Auth = assertCoachOrAdminOfMember(callerUid, memberId)
  • Vérifie le fichier existe + size/MIME OK
  • Pose member.photoStoragePath / photoUpdatedAt / photoUpdatedByUid
  • Best-effort delete de l'ancien path Storage (si différent)
  ↓
Firestore /members/{id} updated

Callable `removeMemberLicensePhoto` (Admin SDK, admin/rootAdmin only)
  • Delete Storage object
  • Clear photoStoragePath / photoUpdatedAt / photoUpdatedByUid (set null)

repositories/members.repo.ts (apps/web + apps/courtbase-app)
  • uploadMemberPhoto(memberId, file) → uploadBytes + appel callable
  • removeMemberPhoto(memberId) → appel callable
  • getMemberPhotoUrl(storagePath) → getDownloadURL (cache buster ?v=photoUpdatedAt.seconds)
  ↑
stores/members.ts + composants UI
  ↑
components MemberPhotoSection.vue (props : memberId, canEdit, canDelete)
  Réimplémenté dans chaque app (composant Vue ne se partage pas entre apps
  via package — copier le pattern, garder une UX cohérente).
```

**Pourquoi callable et pas write client direct ?**
- `/members` Firestore = write-admin-only (rule existante).
- Scope coach pas exprimable en rules Storage ni Firestore.
- Pattern déjà éprouvé dans le repo (`coachUpdateMember`, `coachCreateMember`) — réutilise `assertCoachOrAdminOfMember`.

## PR breakdown (4 agents parallèles)

| PR | Scope | Fichiers principaux |
|---|---|---|
| **PR-A** | Schéma + storage rules + brief doc + sync `docs/firebase.md` + `docs/main.md` | `packages/shared-types/src/member.ts`, `storage.rules`, `docs/members/license-photo.md`, `docs/firebase.md`, `docs/main.md` |
| **PR-B** | Backend : nouvelles callables `setMemberLicensePhoto` + `removeMemberLicensePhoto` (Admin SDK, scope coach/admin) + gate sur `coachReviewLicenseDoc` + tests + repack tarball shared-types | `functions/src/members/setMemberLicensePhoto.ts` (nouveau) + `.test.ts`, `functions/src/members/removeMemberLicensePhoto.ts` (nouveau) + `.test.ts`, `functions/src/licenses/coachReviewLicenseDoc.ts` + `.test.ts`, `functions/src/index.ts` (exports), `functions/CLAUDE.md`, `apps/web/src/services/cloudFunctions.ts` (wrappers typés), `apps/courtbase-app/src/services/cloudFunctions.ts` (wrappers typés), `docs/licenses/parent-completion-workflow.md` |
| **PR-C** | UI courtbase-app coach (upload + review gate) | `apps/courtbase-app/src/repositories/members.repo.ts`, `stores/...`, `views/coach/MemberDetail.vue`, `views/coach/LicenseRequestReview.vue`, `components/member/MemberPhotoSection.vue`, `apps/courtbase-app/CLAUDE.md` |
| **PR-D** | UI apps/web admin (display + ProfileTab + LicenseRequestReview) | `apps/web/src/repositories/members.repo.ts`, `stores/...`, `components/member-detail/ProfileTab.vue`, `components/member-detail/MemberPhotoSection.vue`, `views/licenses/LicenseRequestReview.vue`, `apps/web/CLAUDE.md` |

### Dépendances entre PRs

- **PR-A → PR-B, PR-C, PR-D** : les autres lisent `MemberData.photoStoragePath` (types). En attendant le merge, les agents en aval peuvent travailler en local sur la même base via le brief.
- **PR-C, PR-D ne se touchent pas** (apps disjointes).
- **PR-B ne touche pas l'UI** (callable + tests).
- **Storage rules doivent être déployées** (`firebase deploy --only storage`) avant que les uploads PR-C/PR-D fonctionnent en prod.

### Déploiement

1. Merge PR-A (schéma + rules) → `firebase deploy --only storage`
2. Merge PR-B (callable) → repack tarball shared-types + `firebase deploy --only functions:coachReviewLicenseDoc` (cf. `functions/CLAUDE.md` § deploy gotchas)
3. Merge PR-C + PR-D (UI) → CI build apps

## Garde-fous & gotchas

- **Cache photo** : utiliser `photoUpdatedAt.seconds` comme query string (`?v=<ts>`) sur le signed URL pour invalider le cache navigateur après replace.
- **Old file leakage** : sur replace, delete best-effort de l'ancien path. Si delete échoue (rule denied par exemple), log + ignore — pas critique fonctionnellement (le `photoStoragePath` ne pointe plus dessus).
- **Coach scope dynamique** : la rule Storage utilise un `get()` dynamique sur `/members/{memberId}` — accepté pour les writes individuels mais à surveiller si on bascule un jour sur une LIST query.
- **Photo vs avatar** : ne pas confondre. La photo licence est officielle (format passeport). Un futur avatar général de profil reste un champ distinct.
- **`Timestamp` import** : penser à `import type { Timestamp } from 'firebase/firestore'` côté front, `import { Timestamp } from 'firebase-admin/firestore'` côté Functions.

## Tests

### Backend (PR-B)
- `coachReviewLicenseDoc.test.ts` — étendre :
  - `it('rejects coach_validated transition when member has no photo')`
  - `it('allows coach_validated transition when member.photoStoragePath is set')`
  - `it('still allows per-doc accept that does NOT trigger coach_validated when no photo')`

### Frontend
- Vérification manuelle (pas de Vitest UI configuré sur le repo) :
  - Upload depuis caméra mobile (simulateur iOS) → photo visible dans MemberDetail.
  - Upload depuis fichier desktop → photo visible.
  - Replace → ancien fichier disparu de Storage.
  - Coach tente valider sans photo → callable rejette, UI affiche banner.
  - Admin supprime photo → photoStoragePath retombe `null`, gate coach revient.

## Références

- `packages/shared-types/src/member.ts` — `MemberData` (cible PR-A)
- `storage.rules` — patterns existants (`/registrations`, `/club/logo`, `/licenseRequests`)
- `apps/courtbase-register/src/components/license-request/PassportUpload.vue` — pattern picker fichier
- `apps/web/src/repositories/settings.repo.ts` — `uploadClubLogo` (Storage helper pattern)
- `functions/src/licenses/coachReviewLicenseDoc.ts` — transaction + transition (cible PR-B)
- `apps/courtbase-app/src/views/coach/MemberDetail.vue` — placement section (cible PR-C)
- `apps/web/src/components/member-detail/ProfileTab.vue` — placement section (cible PR-D)
- `docs/licenses/parent-completion-workflow.md` — workflow licence parent
- `docs/firebase.md` — schéma (à étendre via PR-A)
