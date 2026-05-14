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
| **Phase D — Workflow coach (`apps/web`)** | 🟡 **En cours 2026-05-14** (vue Inscriptions + refus + binding member/user livrés) |
| **Phase E — Cotisation + email + paiement manuel + archive** | 🟡 **En cours 2026-05-14** |
| Phase E bis — Licences post-inscription (E15) | 🔜 Pas commencée |
| Phase F — Maturité (cron, becomeOwner, vendor mail) | 🔜 Pas commencée |

### Phase E — En cours (2026-05-14)

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

**Pièces à livrer (côté Functions + apps web/register, autres agents)** :

- Callable `markDuePaid({ dueId, paidAmount, paymentMethod, paidAt? })` — pose `paid` + `/pendingEmails` confirmation. Validation `admin || treasurer` côté serveur.
- Extension `initiateDuesOnPlayerActivation` pour poser `paymentReference` à la création.
- Trigger (ou call inline depuis `issueDuesScheduled`) qui produit le doc `/pendingEmails` `dues_payment_request` (idempotent via `due.emailedAt`).
- Extension `refuseRegistration` pour archiver le member lié (`status='archived'` + champs `archived*`) quand `matchedMemberId` a été créé via ce flow.
- UI web : carte "Paiements" Settings → role treasurer assignable, table `/dues` filtrable, action "Marquer payé".
- UI register : écran "Payer" affichant `banking` + référence + bouton confirmation.

**Pièces livrées côté register UI (2026-05-15)** :

- Affichage cotisations payées sur la home — badge vert "Cotisation payée · {montant} · le {date}" + CTA "Voir le reçu" sur les cards registration une fois le due `paid` (extension `apps/courtbase-register/src/repositories/dues.repo.ts` + `stores/dues.ts` avec `myPaidDues`/`findPaidDueForMember`).
- Reçu sur `PaymentInstructions.vue` état `paid` : carte récap montant versé (`paidAmount`), date (`paidAt`), méthode, référence + note explicite si arrangement comité (`paidAmount < amount`).

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
