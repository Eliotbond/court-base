# Claude Code — racine du repo

> **Toi (Claude Code)** : ce fichier est ton point d'entrée. Reste court : la majorité du contexte vit dans les `CLAUDE.md` locaux et dans `docs/`. Ne charge que ce qui sert à la tâche en cours.

## Routage rapide

Avant toute tâche, identifie où elle se passe et ouvre **uniquement** les fichiers concernés.

| Tu travailles sur… | Lis d'abord |
|---|---|
| L'app web admin (Vue) | `apps/web/CLAUDE.md` + `docs/frontend-desktop.md` |
| L'app d'inscription parents (Vue) | `apps/courtbase-register/CLAUDE.md` + `docs/chantier-registrations.md` + `docs/design-to-vue-register.md` |
| L'app companion coach/officiel/admin (Vue, PWA mobile-first) | `apps/courtbase-app/CLAUDE.md` + `docs/courtbase-app.md` + `docs/design-brief-courtbase-app.md` |
| L'app mobile (Flutter) ⚠️ **DÉPRÉCIÉE 2026-05-23** | `apps/mobile/CLAUDE.md` + `docs/mobile-app.md` (référence uniquement) |
| Le control-plane éditeur | `apps/control-plane/CLAUDE.md` + `docs/deployment.md` |
| Cloud Functions | `functions/CLAUDE.md` + `docs/firebase.md` |
| Types partagés | `packages/shared-types/CLAUDE.md` |
| Le module compta | `docs/compta.md` + `docs/firebase.md` |
| Intégration Basketplan (Swiss Basketball) | `docs/basketplan-integration.md` (brief) + `docs/chantier-basketplan.md` (plan PRs) |
| Workflow demande de licence (coach → parent → admin) | `docs/licenses/parent-completion-workflow.md` |
| Schéma Firestore / rules / Auth | `docs/firebase.md` |
| Règles métier du domaine | `docs/main.md` |
| Déploiement multi-projet | `docs/deployment.md` |
| Workflow git / PR / commits | `docs/git-workflow.md` |

## Règles globales (toujours appliquer)

1. **Lis `docs/main.md` au démarrage de toute nouvelle session.** Court, donne le contexte domaine.
2. **Ne charge pas tous les docs** — ouvre uniquement ceux pertinents à la tâche.
3. **Stack** : Vue 3 + Vite + TS + PrimeVue + Pinia (web). TypeScript strict. Pas de `any` sans justification.
4. **Architecture en couches** (web) : `components → composables → stores → repositories → Firebase`. Pas de raccourcis : un composant n'appelle jamais Firestore directement.
5. **Sécurité Firestore d'abord, code après.** Toute nouvelle collection ou champ → mettre à jour `firestore.rules` ET `docs/firebase.md` dans la même PR.
6. **Conventional Commits** : `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. Scope optionnel : `feat(web): ...`.
7. **Branches** : `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>` — branchées sur `main`, mergées via PR.
8. **Multi-tenant** : un projet Firebase par client. **Pas** de `clubId` dans les paths Firestore. Le projet *est* le club.
9. **Try/catch défensif sur tout appel Firestore / callable.** Sans capture explicite du code d'erreur, les bugs disparaissent silencieusement (rules denied, index manquant, network…). Pattern obligatoire :

   ```ts
   import { FirebaseError } from 'firebase/app'

   try {
     await someCallableOrFirestoreOp()
   } catch (err) {
     const code = err instanceof FirebaseError ? err.code : 'unknown'
     console.error(`<action> failed [${code}]`, err)
     // remonte / toast / rethrow selon le besoin
   }
   ```

   Vaut pour repos, stores, composants ; règle stricte sur les nouveaux modules.

10. **Queries petit volume : simple query + tri JS, pas d'index composite.** Pour les lectures attendues `< ~100 docs` (ex. `listMyRegistrations` pour un user donné), préférer :

    ```ts
    const snap = await getDocs(query(coll, where('uid', '==', x)))
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => b.createdAt.seconds - a.createdAt.seconds)
    ```

    plutôt qu'un composite `(uid ASC, createdAt DESC)`. Avantages : pas d'index à déployer, tolère les docs avec `serverTimestamp` pas encore résolu (qui sont exclus d'un `orderBy` Firestore). Au-delà des dizaines/centaines de docs : repasser à un index composite.

11. **Dans `firestore.rules`, JAMAIS `.data.field` — toujours `.data.get('field', default)`.** Un seul doc legacy sans le champ throw côté Rules engine et refuse toute la LIST query en `permission-denied` (pas juste le doc problématique). Mémoire `[[firestore-rules-safe-field-access]]`. Cas vécu : `isGuardianOf` sans default sur `guardianUserIds` a paralysé l'app register pendant 4h le 2026-05-23.

12. **LIST queries Firestore + rule avec `get()` dynamique = risque de refus en bloc.** Si la rule fait `get(/foo/{X}).data...` (lookup dynamique), Firestore peut refuser la LIST query d'office (impossible à pré-valider). Pour les collections lues en LIST par les utilisateurs finaux, dénormaliser un champ statiquement filtrable (ex. `registeredByUid` sur `/dues`). Mémoires `[[firestore-list-query-dynamic-rule]]` et `[[due-registered-by-uid]]`.

13. **`err instanceof FirestoreError` / `FirebaseError` n'est PAS fiable côté bundle Vite.** Le tree-shaking peut casser l'`instanceof`. Toujours check `err.code === '<code>'` directement via un helper. Pattern obligatoire pour tous les catches Firestore. Mémoire `[[firebase-error-instanceof-unreliable]]`.

## Mise à jour de la doc

Quand tu modifies une règle métier, un schéma, ou un workflow, **mets à jour le doc correspondant dans la même PR**. La doc est la source de vérité — le code doit la refléter, jamais l'inverse.

Quand l'utilisateur dit "je veux changer X" sur une règle ou un schéma :
1. Modifie le `.md` concerné en premier.
2. Propage dans le code (rules, types, repos, composants).
3. Commit unique avec message descriptif.

## Ce qu'il ne faut PAS faire

- Démarrer une feature sans lire le `CLAUDE.md` local du dossier concerné.
- Toucher au schéma Firestore sans synchroniser `docs/firebase.md` + `firestore.rules`.
- Mélanger plusieurs features dans une seule PR.
- Importer du code entre `apps/web` et `apps/control-plane` (deux apps distinctes).
- Mettre des secrets dans le repo. `.env.local` est gitignored ; utiliser GitHub Secrets pour la CI.
