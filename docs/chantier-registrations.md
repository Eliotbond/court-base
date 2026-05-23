# Chantier — Système d'inscriptions (`apps/courtbase-register`)

> Index du chantier "Inscriptions". Le brief complet est découpé en 5 documents thématiques sous `docs/registrations/`. Ne charge que ce qui sert à la tâche en cours.
> Stack : Vue 3 + Vite + TS + PrimeVue + Pinia + Firebase modular SDK (mêmes choix que `apps/web`).

## Pourquoi ce chantier

L'app `web` est faite pour les **admins et coachs**. Les **parents et joueurs** n'ont aucun point d'entrée pour rejoindre le club aujourd'hui — l'admin doit créer le membre manuellement. Le chantier livre un **portail public** dédié à l'inscription (Vue 3 + Firebase, build et hosting target distincts du même projet Firebase), qui permet aux parents/joueurs de s'inscrire en autonomie, pilote la validation côté coach/admin, puis le process licence fédérale.

## État global

| Phase | Status |
|---|---|
| Phase A — Schéma + rules + types | ✅ Livrée |
| Phase B — Scaffolding + auth + E1–E4 | ✅ Livrée |
| **Phase C — Wizard E5–E14** | ✅ **DONE 2026-05-14** |
| **Phase D — Workflow coach (`apps/web`)** | ✅ **DONE 2026-05-23** (vue Inscriptions complète + 6 callables + 3 triggers serveur) |
| **Phase D bis — UI Coach mobile (`courtbase-app`)** | 🔜 Brief écrit, en attente impl autre session |
| **Phase E — Cotisation + email + paiement manuel + archive** | ✅ **Livrée 2026-05-15** |
| Phase E bis — Licences post-inscription (E15) | 🔜 Pas commencée |
| Phase F — Maturité (auto-rerouting, becomeOwner, vendor mail, anti-abus refus) | 🔜 Pas commencée |

### Phase E — Livrée (2026-05-15)

Couche cotisation/email/paiement manuel autour des registrations confirmées. Trigger : (a) parent clique "Payer" dans `apps/courtbase-register`, (b) coach confirme une registration après essai via `confirmRegistration`. Dans les deux cas le trigger `initiateDuesOnPlayerActivation` crée un `/dues`.

**Pièces livrées (foundations) — packages/shared-types + rules + docs** :

- **Types partagés** (`packages/shared-types/src/`) :
  - `config.ts` → `BankingInfo` + `banking` sur `ClubConfigData`, `ClubConfigPatch` exposé pour les patches partiels.
  - `member.ts` → `MemberStatus` (`'active' | 'archived'`) + champs `status`, `archivedAt`, `archivedReason`, `archivedByUid`.
  - `user.ts` → énum canonique `UserRole` incluant `'treasurer'` (rôle additif).
  - `dues.ts` → champs `paymentReference` (référence virement déterministe) + `emailedAt` (idempotence email).
- **Rules** (`firestore.rules`) :
  - Helper `isTreasurer()` aligné sur `isAdmin()`/`isCoach()`.
  - `/dues/{id}` read autorisé à `treasurer` (full collection, pas de scope team) ; write direct toujours admin-only (treasurer passe par callable `markDuePaid`).
  - `/members/{id}` archive documentée — pose via callable serveur uniquement (pas d'ouverture client dédiée).
- **Docs** :
  - `docs/firebase.md` → sections `/config/club.banking`, `/users` `treasurer`, `/members.status`, `/dues.paymentReference + emailedAt`, `/pendingEmails` templates `dues_payment_request` et `dues_payment_confirmed`.
  - `docs/main.md` → bloc "Cotisations — email à payer, paiement, archive" (déclencheurs, autorisations `markDuePaid`, archive on refuse).

**Pièces livrées côté Functions + apps web** :

- Callable `markDuePaid({ dueId, paidAmount, paymentMethod, paidAt? })` — pose `paid` + `/pendingEmails` confirmation. Validation `admin || treasurer` côté serveur.
- Extension `initiateDuesOnPlayerActivation` — pose `paymentReference` à la création + lookup `registeredByUid` depuis la registration. Quand cette ancre est résolue, la cotisation naît `status='issued'` avec `dueAt = registration.trialStartedAt + 14j` et `emailedAt = now` (cf. `registrations/lifecycle.md` §9 — garantie 14 jours max).
- Extension `refuseRegistration` — archive le member lié (`status='archived'` + champs `archived*`) quand `matchedMemberId` a été créé via ce flow.
- UI web : carte "Paiements" Settings → rôle treasurer assignable, table `/dues` filtrable, action "Marquer payé".
- UI register : écran "Payer" affichant `banking` + référence + bouton confirmation.

**Pièces livrées côté register UI (2026-05-15)** :

- Affichage cotisations payées sur la home — badge vert "Cotisation payée · {montant} · le {date}" + CTA "Voir le reçu" sur les cards registration une fois le due `paid` (extension `apps/courtbase-register/src/repositories/dues.repo.ts` + `stores/dues.ts` avec `myPaidDues`/`findPaidDueForMember`).
- Reçu sur `PaymentInstructions.vue` état `paid` : carte récap montant versé (`paidAmount`), date (`paidAt`), méthode, référence + note explicite si arrangement comité (`paidAmount < amount`).

### Self-service compte / RGPD (2026-05-23)

Nouvelle page `/account` (`apps/courtbase-register/src/views/Account.vue`) accessible depuis le menu user du Home. Quatre sections :

1. **Mes informations** — édition `displayName`, `phone`, `address` du `/users/{uid}` via `auth.saveProfile` (rule register déjà ouverte). `email` reste read-only (lié au compte Auth, change via club).
2. **Mon profil joueur** (si `userDoc.memberId`) — read-only sur `/members/{id}` (firstName, lastName, birthDate, AVS, licenseNumber) avec helper "Pour modifier, contactez le club" ; édition du contact privé `/members/{id}/private/contact` (rule autorise `isLinkedMember`).
3. **Mes enfants** — liste `/members where guardianUserIds array-contains uid` ; chaque ligne porte un bouton "Délier" qui appelle la callable `unlinkGuardian` (le caller se retire de `guardianUserIds`). Le member enfant est laissé en l'état côté club.
4. **Zone dangereuse** — bouton "Supprimer mon compte". Disabled tant qu'il reste un pupille, ou qu'un due `paid` est lié au linked member. Sur clic : modal avec saisie obligatoire `"SUPPRIMER"` puis appel callable `deleteMyAccount` qui :
   - Vérifie côté serveur l'absence de pupille + l'absence de due `paid`.
   - Cleanup transactionnel : member lié (+ dues non-paid + retrait teams + unlink registrations en gardant l'audit) + drafts de registrations du caller + sub `/users/{uid}/fcmTokens/*` + `/users/{uid}`.
   - Hors tx : `admin.auth().deleteUser(uid)` (best-effort ; `authDeleted: false` signale un cleanup partiel à reporter à l'admin).
   - Au retour : sign-out client + redirect `/?account_deleted=1`.

Pas de modif `firestore.rules` : tout passe par les deux callables. Côté Functions : `account/unlinkGuardian.ts` + `account/deleteMyAccount.ts` exportées depuis `functions/src/index.ts`. Penser au binding IAM `allUsers/run.invoker` post-deploy (cf. `[[deploy-functions-v2-invoker-binding]]`).

## Les 5 briefs thématiques

| Fichier | Sujet |
|---|---|
| [`registrations/overview.md`](./registrations/overview.md) | Pourquoi cette app, acteurs et rôles, flow utilisateur global, hosting, hors-scope MVP. |
| [`registrations/schema.md`](./registrations/schema.md) | Schéma Firestore complet : `/registrations`, sub `/teams/{id}/refusalLogs`, extensions Team/Member/User, rules, indexes. |
| [`registrations/functions.md`](./registrations/functions.md) | Cloud Functions (callables + triggers + scheduled), inputs/outputs, gotchas v2 (binding IAM, gcloud logs, indexes fieldOverrides). |
| [`registrations/lifecycle.md`](./registrations/lifecycle.md) | Les 10 statuts d'une registration, transitions, branches open/conditional, auto-rerouting, expiration trial 14j. |
| [`registrations/phases.md`](./registrations/phases.md) | Phasage A→F + livrables Phase C + leçons Phase C + critères de done par phase. |

## À lire dans cet ordre selon ton objectif

- **Tu codes une vue du wizard** → `docs/prompt-phase-c-wizard.md` (brief wizard step-by-step) + [`registrations/schema.md`](./registrations/schema.md).
- **Tu écris une Cloud Function** → [`registrations/functions.md`](./registrations/functions.md) + [`registrations/schema.md`](./registrations/schema.md).
- **Tu modifies les rules Firestore** → [`registrations/schema.md`](./registrations/schema.md) (sections "Permissions Firestore" et "Extensions sur les rules").
- **Tu débugges un statut de registration** → [`registrations/lifecycle.md`](./registrations/lifecycle.md).
- **Tu démarres la Phase D (workflow coach)** → [`registrations/phases.md`](./registrations/phases.md) (Phase D) + [`registrations/lifecycle.md`](./registrations/lifecycle.md).
- **Tu cherches un livrable Phase C** → [`registrations/phases.md`](./registrations/phases.md) (section "Livrables Phase C").

## Briefs voisins

- [`design-to-vue-register.md`](./design-to-vue-register.md) — Mapping prototype claude.design → Vue (atoms CSS portés, conversion HTML→template).
- [`design-brief-register.md`](./design-brief-register.md) — Brief design produit côté visual.
- [`prompt-phase-c-wizard.md`](./prompt-phase-c-wizard.md) — Playbook step-by-step Phase C (référence historique).
- [`registrations/coach-app-screens.md`](./registrations/coach-app-screens.md) — Brief Phase D bis : 3 écrans coach dans `courtbase-app` (liste / détail / dialog d'action).
- [`main.md`](./main.md) — Domaine global.
- [`firebase.md`](./firebase.md) — Schéma Firestore complet du projet.
- [`apps/courtbase-register/CLAUDE.md`](../apps/courtbase-register/CLAUDE.md) — Règles app register (à lire en début de session).

## Memory liée

- [[project-minors-guardians-v1]] — defaults comms par âge, state machine majorité (réutilisé par `becomeOwnerOfMyMember`).
- [[project-licenses-chantier]] — Phase 2 dépendance pour `/licenses` réelle.
- [[admin-invitation-flow]] — pas réutilisé (self-registration ≠ invitation), mais l'architecture callable + Admin SDK est le même pattern.
- [[project-categories-referential]] — `/categories` source du filtre par âge sur le TeamPicker.
- [[project-roles-additifs]] — `parent` cohabite avec `coach`/`official`/`admin` sans friction.
- [[firestore-collectiongroup-pattern]] — utiliser `collectionGroup('refusalLogs')` pour la vue admin "tous les refus".
- [[design-bundle-import]] — bundle claude.design avec les 19 écrans (`Courtbase Register.html`).
- [[venues-screen-done]] — pattern master/detail in-page réutilisable pour future vue admin "Toutes inscriptions".
- [[deploy-functions-v2-invoker-binding]] — binding IAM Cloud Run obligatoire post-deploy de toute callable v2.
- [[deploy-functions-monorepo-fix]] — packer shared-types en tarball avant `firebase deploy --only functions:*`.
- [[firestore-functions-phase1]] — conventions Cloud Functions (idempotence, region, secrets).
- [[deploy-firestore-rules-required]] — déployer rules + indexes après chaque modif.
