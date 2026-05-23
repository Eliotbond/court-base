# Workflow — Demande de licence parent (complétion documents)

> **État** : mock-only (2026-05-23). UI livrée en démo, backend à brancher en Phase ultérieure. Statuts étendus définis dans `packages/shared-types/src/license-extended.ts` (draft, à promouvoir vers `license.ts` quand backend land).

## Intention

Aujourd'hui, la demande de licence fédérale se déclenche depuis l'app coach (`apps/courtbase-app`) via un toggle simple qui crée un `/licenseRequests` (cf. `docs/firebase.md` § `/licenseRequests`). L'admin reçoit la demande, valide ou refuse — mais **rien ne collecte les pièces justificatives** côté parent (passeport, AVS si manquant, lettre de sortie en cas de transfert, contexte joueur étranger). Aujourd'hui ces pièces transitent par email / WhatsApp, hors plateforme.

Ce workflow ajoute une étape intermédiaire : entre la demande coach et la validation admin, **le parent (ou le joueur majeur) complète un dossier en ligne**.

## Statuts étendus (`LicenseRequestExtendedStatus`)

```
(none)
  │ coach clique "Demander licence" (gate cotisation OK)
  ▼
pending_parent_docs
  │ parent uploade les documents + envoie
  ▼
parent_docs_submitted
  │ admin valide
  ▼
approved  /  rejected
```

- **`pending_parent_docs`** (nouveau) : la demande existe, en attente des pièces parent.
- **`parent_docs_submitted`** (nouveau) : les pièces sont là, en attente de validation admin.
- **`approved` / `rejected`** : terminal (validation admin, déclenche création `/licenses` côté backend).

Les statuts historiques `pending` / `approved` / `rejected` restent valides — le workflow simple ancien continue de fonctionner. Les nouveaux statuts sont **additifs**.

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

⚠️ **Pas de `transfer_letter_foreign`** : la Letter of Clearance FIBA est gérée hors-bande par l'admin via FIBA MAP (cf. ci-dessous).

## Cas joueur étranger (transfert international)

Si le parent indique un club précédent à l'étranger (pays ≠ Suisse), le formulaire bascule en mode **transfert international** et n'affiche aucun upload supplémentaire. À la place, des bannières informent le parent de la procédure FIBA :

- **Bannière principale** : explique la procédure FIBA MAP (Movement Authorization Procedure), gérée par le club, frais ≈ CHF 269.25 facturés par FIBA.
- **Toggle "compétition à l'étranger"** : si oui → bannière "Letter of Clearance requise" ; si non → procédure FIBA MAP simplifiée ("joueur sans compétition étranger").
- **Bannière U18** (additionnelle si `isMinor`) : la procédure mineurs est plus stricte (permis de séjour, attestation domicile/scolarisation, consentement parental, National Team Declaration). Le club recontacte.
- **Warning permanent** : "Déclarez tout antécédent fédéral, même en jeunesse. La procédure FIBA MAP croise les bases de toutes les fédérations nationales. Une omission entraîne une amende infligée au club."

Le club déclenche ensuite la procédure FIBA réelle hors-plateforme.

## Notification parent (mock vs futur)

**Mock actuel** : à la création coach, un `console.info` affiche un faux email encadré avec un lien `http://localhost:5174/account/license-requests/{requestId}` cliquable. Pas de vrai envoi.

**Futur backend** : la callable `requestLicenseDocuments` écrira un doc `/pendingEmails/{requestId}_documents_pending` avec template `license_documents_pending` (cf. pattern existant `dues_payment_request`). Le vendor email (à câbler) délivre le message au parent.

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

Persistance des saisies : `sessionStorage` clé `court-base.register.mockLicenseRequests`. Survit aux refresh, sauf les `blobUrl` (cohérent avec le pattern `Step6TransferLetter.vue`).

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

## Limitations Phase mock

- Pas de Storage réel : `URL.createObjectURL(file)` → blob perdu au refresh (fileName/size conservés).
- Pas de callable serveur : create / submit log uniquement.
- Pas de notification email réelle : `console.info` encadré.
- Pas de validation admin : la transition `parent_docs_submitted → approved/rejected` est out of scope.
- Pas de mutation des fixtures source : `create()` ne push pas dans `MOCK_LICENSE_REQUESTS` (convention mock immuable).

## Future work (Phase backend)

- **Callables** dans `functions/src/licenses/` :
  - `requestLicenseDocuments({ memberId, requiredDocs[] })` — gate cotisation + write `/licenseRequests` + écrit `/pendingEmails`.
  - `submitLicenseDocuments({ requestId, foreignPlayerContext? })` — valide ownership, transition `parent_docs_submitted`.
  - `validateLicenseRequest({ requestId, decision, adminComment? })` — admin only, transition terminal + create `/licenses` pending.
- **Rules `/licenseRequests`** : immutabilité de `requiredDocs` / `uploadedDocs` post-création (modifications via callable uniquement).
- **Storage** : path `licenseRequests/{uid}/{requestId}/{file}` déjà ouvert dans `storage.rules` (cf. `docs/firebase.md`).
- **Template email** : `license_documents_pending` à seeder.
- **Promotion shared-types** : déplacer `LicenseRequestMock` vers `LicenseRequestData`, convertir `number` → `Timestamp`, supprimer `license-extended.ts` + le `denorm`.
- **Vue admin** : panneau dédié `apps/web/src/views/LicenseRequests.vue` pour validation (en attendant, l'admin transite par `MOCK_REQUESTS`).

## Références

- `packages/shared-types/src/license-extended.ts` — types draft
- `packages/shared-types/src/mock-fixtures/licenseRequests.ts` — fixtures
- `apps/courtbase-app/src/utils/licenseGate.ts` — gate cotisation
- `apps/courtbase-register/src/views/LicenseRequestForm.vue` — UI parent
- `docs/main.md` § Licences — règles métier
- `docs/firebase.md` § `/licenseRequests` — schéma actuel
