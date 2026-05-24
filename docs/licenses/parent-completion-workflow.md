# Workflow — Demande de licence parent (complétion documents)

> **État** :
> - **PR1** (coach launch en Firestore réel) livrée 2026-05-23.
> - **PR1.5 — UI parent en Firestore réel** livrée 2026-05-24 :
>   suppression du mock register, uploads Storage réels, writes Firestore
>   scopés par les rules, transition `pending_parent_docs → parent_docs_submitted`
>   par write client direct.
> - **PR2 — Fondation backend coach review** livrée 2026-05-24 (cette section) :
>   types `DocReviewDecision` + `UploadedDocRef.coachReview`, callable
>   `coachReviewLicenseDoc`, tests. UI coach à venir.
> - **PR3 — Fondation backend trésorier** livrée 2026-05-24 (partiel) :
>   types `UploadedDocRef.treasurerReview` + `LicenseData.requestId`/`requestedByUid`,
>   callables `treasurerReviewLicenseDoc` + `validateLicenseRequest` (crée
>   `/licenses` `pending`, sans confirmer paiement — `confirmLicense` reste
>   séparé). UI trésorier à venir.
> - **PR3 trésorier-phase — Fondation backend** livrée 2026-05-24 (cette section) :
>   5 statuts ajoutés (`awaiting_parent_signature`, `parent_signed`,
>   `form_confirmed`, `sent_paid`, `approved`), 14 champs ajoutés à
>   `LicenseRequestData` (signableDoc/signedDoc/formConfirmed/sentToFederation/
>   paidAt/paymentProof/licenseNumber/licenseFinalized/linkedLicenseId/
>   treasurerNotes), 4 I/O types dans `license-treasurer.ts`, rules Firestore
>   + Storage étendues. Cloud Functions (`treasurerUploadSignableDoc`,
>   `treasurerConfirmSignedDoc`, `treasurerMarkSentAndPaid`,
>   `treasurerFinalizeLicense`) et UI apps/web à venir.
> - **PR2/PR3 — UI parent (affichage refus + re-upload)** livrée 2026-05-24 :
>   `LicenseRequestForm.vue` affiche désormais le statut per-doc (pill amber
>   "En attente" / emerald "Validé par le coach"/"Validé" / rose "Refusé par
>   le coach"/"Refusé par le trésorier" + raison + date FR). Banner global
>   en haut driver le statut, avec scroll-to vers le 1er doc refusé.
>   Bouton "Envoyer" bloqué tant qu'un doc refusé n'est pas re-uploadé. Le
>   re-upload reset déjà `coachReview` + `treasurerReview` à `null` via le
>   store (cf. §"UI parent" ci-dessous).
>
> Statuts étendus et types associés (`LicenseDocKind`, `UploadedDocRef`,
> `ForeignPlayerContext`, `inferRequiredDocs`, `parentSubmittedAvs`) sont
> définis dans `packages/shared-types/src/license.ts`. Le fichier
> `packages/shared-types/src/mock-fixtures/license-extended.ts` reste un shim
> `@deprecated` (utilisé seulement par `apps/courtbase-app` en mode mock
> fallback) — toute nouvelle import doit pointer vers `license.ts`.

## Conséquence pour le wizard d'inscription

Le wizard `apps/courtbase-register/src/views/register/` **ne collecte plus
aucun document de licence** (suppression effective 2026-05-23 — Step 6
"Lettre de sortie" déprécié et transformé en redirection défensive). Il
capture juste les **flags métadonnées** utiles au coach pour décider de
l'essai : `previouslyLicensed`, `previousClubName`, `previousClubAbroad`.

Tous les uploads (passeport recto/verso, AVS si manquant, lettre de sortie
si club précédent suisse, contexte joueur étranger international) sont
collectés via `LicenseRequestForm.vue` **après** que le coach a déclenché
la demande de licence (`pending_parent_docs`). Voir §"UI parent" ci-dessous.

## Intention

Aujourd'hui, la demande de licence fédérale se déclenche depuis l'app coach (`apps/courtbase-app`) via un toggle simple qui crée un `/licenseRequests` (cf. `docs/firebase.md` § `/licenseRequests`). L'admin reçoit la demande, valide ou refuse — mais **rien ne collecte les pièces justificatives** côté parent (passeport, AVS si manquant, lettre de sortie en cas de transfert, contexte joueur étranger). Aujourd'hui ces pièces transitent par email / WhatsApp, hors plateforme.

Ce workflow ajoute une étape intermédiaire : entre la demande coach et la validation admin, **le parent (ou le joueur majeur) complète un dossier en ligne**.

## Statuts étendus (`LicenseRequestExtendedStatus`)

Le workflow cible comporte **4 stages** (PR1 livre uniquement le premier — coach launch — les autres suivront en PR2/PR3) :

```
(none)
  │ coach clique "Demander licence" (gate cotisation OK)      ← PR1 (livré 2026-05-23)
  ▼
pending_parent_docs
  │ parent uploade les documents + envoie                     ← courtbase-register (déjà mock)
  ▼
parent_docs_submitted
  │ coach review doc par doc (accept / refuse per-doc)        ← PR2 (à venir)
  ▼
coach_validated
  │ treasurer/secretary/admin traite (accept / refuse)        ← PR3 (à venir)
  ▼
approved  /  rejected
```

- **`pending_parent_docs`** : la demande existe, en attente des pièces parent.
- **`parent_docs_submitted`** : les pièces sont là, en attente de review coach.
- **`coach_validated`** (nouveau pour PR2) : le coach a validé chaque document ; en attente du trésorier/secrétaire/admin.
- **`approved` / `rejected`** : terminal (validation trésorier/secrétaire/admin, déclenche création `/licenses` côté backend).

Les statuts historiques `pending` / `approved` / `rejected` restent valides pour rétro-compat — le workflow simple ancien continue de fonctionner. Les nouveaux statuts sont **additifs**. Toute **nouvelle** demande créée par PR1 part en `pending_parent_docs` (jamais en `pending`).

**Per-doc refusal** (coach OU trésorier peut refuser un document spécifique → retour à l'étape précédente avec le doc à re-uploader) : planifié pour PR2/PR3, mais le schéma `LicenseRequestData` est déjà extensible — chaque `UploadedDocRef` pourra porter `refusedBy` / `refusedReason` sans migration cassante.

## Gate cotisation (coach)

Le coach ne peut déclencher une demande que si la cotisation du joueur est en règle. Helper `canRequestLicense(member)` dans `apps/courtbase-app/src/utils/licenseGate.ts` :

- ✅ `duesStatus ∈ {paid, pending_grace, excepted}`
- ❌ `duesStatus ∈ {due, overdue, excluded, issued}` → bouton désactivé + helper text "Cotisation non payée. Le joueur doit régler sa cotisation (ou son arrangement de paiement) avant la demande de licence."
- ❌ `member.licenseNumber` déjà rempli → bouton désactivé (déjà licencié)

`pending_grace` = arrangement comité avec paiement partiel formalisé (cf. `docs/main.md` § Cotisations). `excepted` = exception validée par l'admin = équivalent OK.

## Documents requis (`LicenseDocKind`)

Liste déterminée à la création par le coach selon le profil joueur (`inferRequiredDocs(member)`) :

- `id_front` + `id_back` — toujours requis. **Passeport ou carte d'identité officielle uniquement**. Le permis de conduire et le permis de séjour ne sont pas acceptés par Swiss Basketball.
- `avs` — si `member.avs` est manquant. Champ texte uniquement (regex `/^756\.\d{4}\.\d{4}\.\d{2}$/`), pas de photo de la carte AVS.
- `transfer_letter_swiss` — si le joueur a déjà été licencié dans un autre club suisse (renseigné par le parent via toggle "déjà licencié ailleurs"). Upload optionnel — la lettre peut suivre par email.

**Pour `avs`** : la valeur saisie est persistée dans le champ
`LicenseRequestData.parentSubmittedAvs` (texte). Lors du review (PR2/PR3), le
coach/admin synchronise cette valeur vers `member.avs` (mutation admin-only
via callable ou Settings) — la rule `/members` reste fermée à l'écriture
parent.

⚠️ **Pas de `transfer_letter_foreign`** : la Letter of Clearance FIBA est gérée hors-bande par l'admin via FIBA MAP (cf. ci-dessous).

## Cas joueur étranger (transfert international)

Si le parent indique un club précédent à l'étranger (pays ≠ Suisse), le formulaire bascule en mode **transfert international** et n'affiche aucun upload supplémentaire. À la place, des bannières informent le parent de la procédure FIBA :

- **Bannière principale** : explique la procédure FIBA MAP (Movement Authorization Procedure), gérée par le club, frais ≈ CHF 269.25 facturés par FIBA.
- **Toggle "compétition à l'étranger"** : si oui → bannière "Letter of Clearance requise" ; si non → procédure FIBA MAP simplifiée ("joueur sans compétition étranger").
- **Bannière U18** (additionnelle si `isMinor`) : la procédure mineurs est plus stricte (permis de séjour, attestation domicile/scolarisation, consentement parental, National Team Declaration). Le club recontacte.
- **Warning permanent** : "Déclarez tout antécédent fédéral, même en jeunesse. La procédure FIBA MAP croise les bases de toutes les fédérations nationales. Une omission entraîne une amende infligée au club."

Le club déclenche ensuite la procédure FIBA réelle hors-plateforme.

## Notification parent

**PR1 livré (2026-05-23)** : à la création coach (write direct client `/licenseRequests/{id}`), un doc `/notifications/{notifId}` est écrit **en parallèle** avec :

- `type: 'license_documents_pending'`
- `deepLink: { name: 'license-request-form', params: { id: requestId } }` pointant vers `courtbase-register`
- `memberId` / `parentUid` destinataire(s)

Le trigger backend existant **`fanoutNotification`** push automatiquement via FCM si le parent a un device enregistré (cf. `docs/firebase.md` → Notifications). En l'absence de device, le parent peut aussi accéder à sa demande depuis `courtbase-register /account` (liste des demandes liées à ses enfants).

**Email vendor reste deferred** : à câbler quand l'infra notification email sera disponible (TODO PR ultérieure non spécifique licence — pattern futur sur `/pendingEmails/{id}` avec template `license_documents_pending`, cf. pattern existant `dues_payment_request`).

## UI parent

Vue `apps/courtbase-register/src/views/LicenseRequestForm.vue` — page longue scrollable (pas wizard) avec sections en cards :

1. **Identité joueur** (read-only)
2. **AVS** (read-only ✓ si déjà rempli, sinon input regex)
3. **Pièce d'identité** (deux `PassportUpload` recto/verso)
4. **Historique sportif** (toggle "déjà licencié ailleurs" + club + pays)
5. **Transfert national** (conditionnelle, upload optionnel lettre de sortie)
6. **Transfert international** (conditionnelle, bannières FIBA + toggle compétition, pas d'upload)
7. **Certification & envoi** (checkbox + bouton "Envoyer")

Mini-checklist en haut de chaque card (`CheckCircle2` emerald / `Circle` slate) pour signaler la progression sans wizard.

**Persistance — Firestore réel (PR1.5)** : chaque saisie/upload patche
directement `/licenseRequests/{id}` via le store
`useLicenseRequestsStore`. Pas de sessionStorage intermédiaire — l'état du
formulaire au refresh provient de la lecture Firestore :

- **Upload** : `PassportUpload` / `DocumentUploadTile` émet `pick(File)` →
  le store appelle `uploadLicenseDocument` (Storage path
  `licenseRequests/{uid}/{requestId}/{kind}.{ext}`) puis `setUploadedDoc`
  (dot-notation `uploadedDocs.{kind}` sur Firestore).
- **AVS** : debounce 500 ms → `setParentAvs` (champ
  `parentSubmittedAvs`).
- **Contexte étranger** : watch immédiat → `setForeignContext`
  (`foreignPlayerContext`).
- **Submit** : `submitLicenseRequestDocs` pose
  `status: 'parent_docs_submitted'` + `parentCompletedAt: serverTimestamp()`.
  La rule update parent verrouille ensuite la request (status hors
  `pending_parent_docs`).

**Affichage statut per-doc + re-upload (PR2/PR3 — livré 2026-05-24)** :

- Le composant `components/license-request/DocStatusBanner.vue` est rendu
  sous chaque tile d'upload et porte la décision agrégée :
  - `coachReview === null && treasurerReview === null` après upload → pill
    amber "En attente de validation" ;
  - `coachReview.decision === 'accepted'` seul → pill emerald "Validé par
    le coach" ;
  - `coachReview` et `treasurerReview` tous deux `accepted` → pill emerald
    "Validé" ;
  - `coachReview.decision === 'refused'` ou
    `treasurerReview.decision === 'refused'` → pill rose + bandeau
    `banner-strong` avec la `refusalReason` + date FR (`'lundi 24 mai à
    14:32'`) + CTA "à re-téléverser".
- Un **banner global** en haut de page reprend le status courant
  (`pending_parent_docs` → info, `parent_docs_submitted` /
  `coach_validated` / `approved` → success, `rejected` → strong). Si au
  moins un doc est refusé, le banner bascule en strong "Des documents
  nécessitent votre attention" + bouton "Voir le premier document à
  corriger" qui scroll vers la section concernée.
- Au mount, si la demande est revenue en `pending_parent_docs` avec un ou
  plusieurs docs refusés, on auto-scroll vers la première section
  concernée (`scrollToFirstRefused`).
- Le bouton "Envoyer ma demande" est désactivé tant qu'un doc refusé n'a
  pas été re-uploadé — un message rouge sous le bouton explique pourquoi.
- **Re-upload** : le store `useLicenseRequestsStore.uploadDoc` pose
  `coachReview: null` ET `treasurerReview: null` sur le nouveau
  `UploadedDocRef`. Le doc repart à zéro côté coach et trésorier — la
  rule parent autorise l'update parce que le re-upload renvoie le doc en
  `pending_parent_docs` (cf. §"Statuts étendus" et la callable
  `coachReviewLicenseDoc` qui pose ce status sur refus).
- Quand la demande est dans un état terminal ou post-submit
  (`parent_docs_submitted`, `coach_validated`, `approved`, `rejected`),
  le formulaire d'édition est caché : la vue affiche uniquement un banner
  read-only reflétant le status + un éventuel `adminComment` si rejet.

## Fixtures de démo (5 scénarios)

`packages/shared-types/src/mock-fixtures/licenseRequests.ts` expose 6 fixtures partagées entre les 2 apps (IDs figés pour que les liens email cliquables fonctionnent) :

| ID | Profil | requiredDocs |
|---|---|---|
| `lr-leo-2025` | Première licence suisse | `[id_front, id_back]` |
| `lr-julian-2025` | Changement club national | `[id_front, id_back, transfer_letter_swiss]` |
| `lr-emma-2025` | Transfert étranger majeur (France) | `[id_front, id_back]` + `foreignPlayerContext` |
| `lr-noah-2025` | Transfert étranger mineur (Espagne) | `[id_front, id_back]` + `foreignPlayerContext.isMinor` |
| `lr-paul-2025` | AVS manquant | `[id_front, id_back, avs]` |
| `lr-sarah-2025` | Happy path complet | `[id_front, id_back]` (statut `parent_docs_submitted`) |

## Limitations actuelles (post-PR1.5)

**Coach launch (PR1)** est en Firestore réel : la création passe par un write client direct dans `/licenseRequests/{id}` (ID déterministe `lr-{memberId}-{seasonId}`, idempotence garantie) + écriture parallèle d'un doc `/notifications`. Pas de callable serveur, pas de re-check serveur du gate cotisation (cf. décision PR1 — `canRequestLicense(member)` reste **côté client**).

**UI parent (PR1.5)** est en Firestore réel : uploads Storage + writes
scopés `/licenseRequests/{id}` (rule `update` parent autorisée pour
`uploadedDocs` / `foreignPlayerContext` / `parentSubmittedAvs` /
`parentCompletedAt` / `status` quand `status == pending_parent_docs`). La
transition `parent_docs_submitted` est posée par write client direct (pas
de callable).

**Encore en attente** (PR2/PR3) :

- Pas de notification email réelle : seule la notif in-app + FCM est posée (cf. §"Notification parent").
- Pas de coach review (transition `parent_docs_submitted → coach_validated`) — PR2.
- Pas de validation trésorier (transition `coach_validated → approved/rejected`) — PR3.
- Pas de sync auto `parentSubmittedAvs → member.avs` : le coach/admin doit le faire manuellement lors du review (PR2).

## Backend livré (PR2 / PR3 — 2026-05-24)

### PR2 — Coach review (`parent_docs_submitted → coach_validated`) — backend ✅, UI à venir

- **Schéma** : `UploadedDocRef` étendu avec `coachReview: DocReviewDecision | null` (et le miroir `treasurerReview` posé en PR3). `DocReviewDecision = { decision: 'accepted' | 'refused', at: Timestamp, byUid: string, refusalReason: string | null }`. **Pas d'historique** — chaque review écrase la précédente (volumétrie minime). Voir `packages/shared-types/src/license.ts`.
- **Callable `coachReviewLicenseDoc`** (`functions/src/licenses/coachReviewLicenseDoc.ts`) :
  - Input wire : `{ requestId: string, kind: LicenseDocKind, decision: 'accept' | 'refuse', refusalReason?: string }`.
  - Auth coach scope (`teamId ∈ user.teamIds`) ou admin/rootAdmin.
  - Pré-condition `status === 'parent_docs_submitted'` + `kind ∈ requiredDocs` + `uploadedDocs[kind]` présent.
  - **Pré-condition photo membre** (PR-B, livrée 2026-05-24) : pour la transition `parent_docs_submitted → coach_validated` (= accept du dernier doc en attente), le coach doit avoir uploadé la photo passeport du membre. Si `member.photoStoragePath == null` au moment où `allCoachAccepted` devient `true`, la callable throw `failed-precondition` avec le message "Photo membre requise avant validation finale. Uploader la photo licence depuis la fiche du membre." Le gate ne s'applique **pas** aux accepts partiels (le coach peut review les pièces avant d'uploader la photo) ni aux refus. Cf. `docs/members/license-photo.md` (callable `setMemberLicensePhoto` admin/coach scope, callable `removeMemberLicensePhoto` admin/rootAdmin only).
  - Refuse → pose `coachReview: { decision: 'refused', refusalReason, at: now, byUid: caller }`, status → `pending_parent_docs`, reset `coachValidatedAt/ByUid` à `null`.
  - Accept tous → status → `coach_validated`, pose `coachValidatedAt` / `coachValidatedByUid`.
  - Accept partiel → status reste `parent_docs_submitted`.
  - Output : `{ ok: true, requestId, newStatus, allCoachAccepted }`.
- **Reset auto au re-upload** : `useLicenseRequestsStore` côté `apps/courtbase-register` pose `coachReview: null` (et `treasurerReview: null`) sur le `UploadedDocRef` au moment du nouvel upload — le doc repart depuis le début du cycle.
- **UI coach (à venir)** : nouvel onglet `'À valider'` dans `apps/courtbase-app` (liste `status === 'parent_docs_submitted'` scopée `teamId ∈ user.teamIds`) + vue détail doc-par-doc avec boutons Accept / Refuse (modal commentaire si refus).

### PR3 — Treasurer / secretary / admin — backend ✅ (partiel), UI à venir

- **Schéma** : `UploadedDocRef.treasurerReview: DocReviewDecision | null`. `LicenseData` étendu avec `requestId: string | null` + `requestedByUid: string | null` (ref inverse vers la `/licenseRequests` source ; `null` pour les licences créées hors workflow).
- **Callable `treasurerReviewLicenseDoc`** (`functions/src/licenses/treasurerReviewLicenseDoc.ts`) — symétrique à `coachReviewLicenseDoc` côté trésorier :
  - Auth admin/treasurer/secretary/rootAdmin.
  - Pré-condition `status === 'coach_validated'`.
  - Refuse → reset complet (`status → pending_parent_docs`, `coachValidatedAt/ByUid → null`). C'est strict mais sûr (un défaut détecté tardivement peut concerner le coach review).
  - Accept tous → reste `coach_validated` (le trésorier doit ensuite appeler `validateLicenseRequest`).
  - Output : `{ ok, requestId, newStatus, allTreasurerAccepted }`.
- **Callable `validateLicenseRequest`** (`functions/src/licenses/validateLicenseRequest.ts`) — décision finale :
  - Input : `{ requestId, decision: 'approve' | 'reject', comment?: string }`.
  - Auth identique au trésorier.
  - **Pré-conditions asymétriques** :
    - **Approve** : `status === 'coach_validated'`. La validation coach + la revue per-doc trésorier sont obligatoires avant émission de la licence.
    - **Reject** : `status ∈ {parent_docs_submitted, coach_validated}`. Le trésorier peut couper court dès que les documents parent sont arrivés (sans attendre la validation coach) en cas de défaut flagrant (doc faux, info erronée, fraude). La validation coach reste un pré-filtre qui soulage le trésorier dans le cas nominal, mais elle n'est pas bloquante pour un refus motivé. Les statuts terminaux et `pending_parent_docs` restent refusés dans tous les cas.
  - Approve : exige `computeAllTreasurerAccepted(request)` (sinon `failed-precondition` "Tous les documents doivent être validés par le trésorier avant approbation"). Résout le 1er `/licenseTypes` joueur actif (sinon `failed-precondition` "Aucun /licenseTypes joueur actif"). Crée `/licenses/{auto-id}` `status:'pending'` avec snapshot `role`/`level`/`name`/`fee` + `requestId` + `requestedByUid`. Pose `request.status = 'approved'`.
  - Reject : pose `request.status = 'rejected'`. Pas de `/licenses` créée.
  - Output : `{ ok, requestId, newStatus, licenseId: string | null }`.
- **NB important** : la transition `pending → active` de la licence + l'écriture comptable de la charge restent gérées par la callable existante `confirmLicense` (cf. `confirmLicense.ts`). `validateLicenseRequest` ne crée que la licence en `pending` — le trésorier doit ensuite la confirmer séparément.
- **UI trésorier (à venir)** : vue `apps/web` `/license-requests` avec deux filtres (À traiter `coach_validated` / Toutes en cours `non-terminal`). Détail doc-par-doc + bouton décision finale (Approve / Reject).
- **UI parent (livré 2026-05-24)** : `LicenseRequestForm.vue` affiche pour chaque doc avec `coachReview.decision === 'refused'` ou `treasurerReview.decision === 'refused'` un bandeau d'erreur (`DocStatusBanner.vue`) avec la `refusalReason` + date FR + CTA contextuel. À chaque re-upload, le store reset les deux `*Review` à `null` (déjà câblé). Banner global de statut + scroll-to du 1er doc refusé + blocage du bouton submit tant qu'un refus n'est pas re-uploadé. Cf. §"UI parent" ci-dessus.

## Phase trésorier (PR3 trésorier — fondation backend livrée 2026-05-24)

Après l'approbation coach (`coach_validated`), la demande entre dans une **séquence trésorier** qui matérialise les 4 étapes administratives du traitement fédéral. À la fin de la séquence, la `/licenses/{id}` est en `status: 'active'`, le membre est marqué licencié, et la charge comptable est postée.

### Statuts ajoutés

```
coach_validated
  → awaiting_parent_signature  (trésorier uploade `signable.pdf`)
    → parent_signed            (parent re-uploade `signed.pdf` — write client direct, hors callable)
      → form_confirmed         (trésorier valide la conformité du signed doc)
        → sent_paid            (trésorier marque envoyé fédération + payé)
          → approved           (terminal — trésorier saisit licenseNumber reçu fédération)
```

### Particularités

- **À `sent_paid`**, la `/licenses/{id}` est créée en `status: 'pending'` — **utilisable par le coach en match** dès cet instant (le joueur peut être aligné). La licence sera ensuite passée en `'active'` par `treasurerFinalizeLicense` qui chaîne `confirmLicense`. Bridge bidirectionnel : `licenseRequest.linkedLicenseId` ↔ `license.requestId`.
- **À `approved`** : passage `/licenses` → `'active'` via `confirmLicense` chaîné, pose `member.licensed = true`, dénormalisation `member.officialLicense` / `coachLicense` / `playerLicense`, écriture comptable de la charge (débit "Licences fédérales" / crédit "Banque", montant = `license.feeSnapshot`). Tout dans une transaction.
- **Rôle trésorier** : `rootAdmin` (claim) OU rôle `treasurer` sur `/users/{uid}.roles`. **PAS `admin` standard** — cohérent avec le module compta (`docs/compta.md` § Sécurité). Un admin ne peut pas processer une licence à cette phase.
- **Re-upload parent du signed doc** : transition `awaiting_parent_signature → parent_signed` posée par **write client direct** côté parent (pas de callable). L'UI register de cette action est **différée hors PR3** (le ré-upload se fait pour l'instant via email/WhatsApp avec le trésorier qui patche le doc à la main). La rule Firestore est en place pour qu'on puisse activer l'UI sans re-deploy.
- **Re-upload `payment-proof.{ext}`** à `sent_paid` est autorisé (workflow asynchrone — la preuve peut arriver après l'envoi du dossier fédéral). Whitelist `[paymentProofStoragePath, paymentProofUploadedAt]`.
- **Lettre de sortie** : la génération automatisée de la lettre de sortie pour un joueur sortant **n'est PAS dans ce chantier** — à traiter dans un chantier ultérieur.

### Callables (signatures IO — `packages/shared-types/src/license-treasurer.ts`)

```ts
// 1. coach_validated → awaiting_parent_signature
treasurerUploadSignableDoc({
  requestId: string,
  storagePath: string,    // `licenseRequests/{treasurerUid}/{requestId}/signable.pdf`
  fileName: string,
  sizeBytes: number,
  contentType: string,
}): { newStatus: 'awaiting_parent_signature' }

// 2. parent_signed → form_confirmed
treasurerConfirmSignedDoc({
  requestId: string,
  notes?: string | null,
}): { newStatus: 'form_confirmed' }

// 3. form_confirmed → sent_paid
//    + crée /licenses/{id} en status='pending' (utilisable coach)
treasurerMarkSentAndPaid({
  requestId: string,
  paymentProofStoragePath?: string | null,  // `licenseRequests/{treasurerUid}/{requestId}/payment-proof.{ext}` — optionnel
}): {
  newStatus: 'sent_paid',
  licenseId: string,      // /licenses/{id} créée en 'pending'
}

// 4. sent_paid → approved
//    + chaîne confirmLicense → /licenses 'active', member.licensed=true, charge comptable
treasurerFinalizeLicense({
  requestId: string,
  licenseNumber: string,
}): {
  newStatus: 'approved',
  licenseId: string,
  memberPatch: {           // null si role='player'|'referee' (confirmLicense ne denorm pas ces rôles)
    memberId: string,
    field: 'officialLicense' | 'coachLicense' | 'playerLicense',
  } | null,
}
```

### Storage paths (récap)

- `licenseRequests/{treasurerUid}/{requestId}/signable.pdf` — formulaire pré-rempli, uploadé par le trésorier
- `licenseRequests/{parentUid}/{requestId}/signed.pdf` — doc signé re-uploadé par le parent
- `licenseRequests/{treasurerUid}/{requestId}/payment-proof.{ext}` — extrait bancaire / e-banking

Storage rules sont permissives sur ces paths (ownership uid + taille < 10 MB + image/PDF) — la garde "rôle trésorier" + "status compatible" est faite côté **callable** quand elle consomme le fichier (Storage ne peut pas faire de cross-doc lookup vers Firestore).

### Rules `/licenseRequests` étendues (filets de sécurité côté update direct)

Update trésorier (`rootAdmin || treasurer` — **pas admin**) autorisé sur 5 transitions whitelistées, chacune avec sa propre `affectedKeys.hasOnly([...])` :

| Transition | affectedKeys whitelistées |
|---|---|
| `coach_validated → awaiting_parent_signature` | `[status, signableDocStoragePath, signableDocUploadedAt, signableDocUploadedByUid]` |
| `parent_signed → form_confirmed` | `[status, formConfirmedAt, formConfirmedByUid, treasurerNotes]` |
| `form_confirmed → sent_paid` | `[status, sentToFederationAt, paidAt, paymentProofStoragePath, paymentProofUploadedAt, linkedLicenseId, treasurerNotes]` |
| Re-upload `paymentProof` à `sent_paid` | `[paymentProofStoragePath, paymentProofUploadedAt]` |
| `sent_paid → approved` | `[status, licenseNumber, licenseFinalizedAt, licenseFinalizedByUid, treasurerNotes]` |

Update parent supplémentaire : `awaiting_parent_signature → parent_signed` avec affectedKeys `[status, signedDocStoragePath, signedDocUploadedAt, signedDocUploadedByUid]` (linked member, guardian, OU UID dans `parentUserIds`).

Toutes les rules utilisent `.data.get('<field>', null)` pour éviter le piège `firestore-rules-safe-field-access` sur les demandes legacy en `coach_validated` qui n'ont pas les champs phase trésorier.

### Hors scope persistant (pas planifié dans PR2/PR3)

- **Storage rules** : `licenseRequests/{uid}/{requestId}/{file}` déjà ouvert dans `storage.rules` (cf. `docs/firebase.md`) ; commentaires mis à jour pour documenter les nouveaux fichiers (`signable.pdf`, `signed.pdf`, `payment-proof.{ext}`). Pas de changement structurel.
- **Email vendor** : à câbler quand l'infra notification email sera là (TODO non spécifique licence — voir §"Notification parent" ci-dessus).
- **Template email** : `license_documents_pending` à seeder le jour où le vendor email arrive.
- **UI parent re-upload signed doc** : l'écran courtbase-register pour `awaiting_parent_signature → parent_signed` est différé hors PR3 (les rules + types backend sont prêts).
- **Lettre de sortie** : déférée.

## Références

- `packages/shared-types/src/license.ts` — **types canoniques** (statuts étendus, `LicenseDocKind`, `UploadedDocRef`, `ForeignPlayerContext`, `inferRequiredDocs`, `LicenseRequestData` étendu)
- `packages/shared-types/src/mock-fixtures/license-extended.ts` — shim `@deprecated` (re-export depuis `../license`)
- `packages/shared-types/src/mock-fixtures/licenseRequests.ts` — fixtures
- `apps/courtbase-app/src/repositories/licenseRequests.repo.ts` — repo Firestore réel (PR1)
- `apps/courtbase-app/src/stores/licenseRequests.ts` — store hybride mock + real (PR1)
- `apps/courtbase-app/src/utils/licenseGate.ts` — gate cotisation
- `apps/courtbase-app/src/composables/useSeason.ts` — `useActiveSeason()` (PR1)
- `apps/courtbase-register/src/views/LicenseRequestForm.vue` — UI parent
- `docs/main.md` § Licences — règles métier
- `docs/firebase.md` § `/licenseRequests` — schéma actuel
