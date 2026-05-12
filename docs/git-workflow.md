# Git workflow — GitHub Flow

> Modèle simple : `main` toujours déployable + feature branches courtes via PR.

## Branches

| Type | Préfixe | Exemple | Durée de vie |
|---|---|---|---|
| Principale | `main` | `main` | Permanent. Protégée. |
| Feature | `feat/` | `feat/member-crud` | Court (jours, pas semaines). |
| Bugfix | `fix/` | `fix/booking-cancel-status` | Court. |
| Chore | `chore/` | `chore/upgrade-vue-3.5` | Court. |
| Docs | `docs/` | `docs/clarify-dues-flow` | Court. |
| Refactor | `refactor/` | `refactor/repo-layer` | Court. |
| Hotfix prod | `hotfix/` | `hotfix/auth-redirect-loop` | Court, fast-track. |

**Règles** :
- Tout branche depuis `main` à jour.
- Une PR = une chose. Pas de mix feature + refactor + chore.
- Rebase plutôt que merge pour rester linéaire. Squash-merge à la fin sur GitHub.

## Conventional Commits

Format :
```
<type>(<scope>): <description courte impérative>

[body optionnel]

[footer optionnel : BREAKING CHANGE: ..., refs #123]
```

Types : `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `style`.

Scopes courants (optionnels) : `web`, `mobile`, `functions`, `rules`, `docs`, `ci`, `control-plane`.

Exemples :
```
feat(web): add member CRUD with role assignment
fix(functions): correct dues issuedAt computation across DST
docs(firebase): clarify rootAdmin claim semantics
refactor(web): extract season grid logic to composable
chore: bump Vue to 3.5.13
```

## PR workflow

1. **Sync `main`** : `git checkout main && git pull`
2. **Branche** : `git checkout -b feat/<slug>`
3. **Commits atomiques**, conventional.
4. **Push** : `git push -u origin feat/<slug>`
5. **PR** sur GitHub avec template (voir `.github/pull_request_template.md`) :
   - Description claire
   - Liste des changements
   - Checklist (tests, docs, rules sync, types sync)
   - Issue liée si applicable
6. **CI** doit être verte (lint + typecheck + test).
7. **Review** : 1 reviewer (ou self-review si solo).
8. **Merge** : **squash & merge**. Message = description PR.
9. **Delete branch** après merge.

## Règles spécifiques au projet

### Sync doc ↔ code
Toute PR qui touche au schéma, à une règle métier, ou au workflow d'un domaine **doit** mettre à jour le `.md` correspondant dans `docs/` dans la **même PR**.

### Sync rules ↔ schéma
Toute PR qui ajoute/modifie une collection ou un champ Firestore **doit** mettre à jour `firestore.rules` + `docs/firebase.md` dans la même PR.

### Types partagés
Toute modif du schéma → MAJ types dans `packages/shared-types/` dans la même PR.

### Protection de `main`
- Pas de push direct.
- PR obligatoire.
- CI verte requise.
- 1 approval requise (peut être désactivée si solo).
- Force-push désactivé.

## Tags & releases

- Tags suivent semver : `v0.1.0`, `v0.2.0`, ...
- Tag créé sur `main` après merge d'une release PR ou commit notable.
- Releases GitHub avec changelog auto-généré (depuis conventional commits).
- Phase 0 : `v0.x.x` (foundations). Phase 1 : `v1.x.x`. Phase 2 : `v2.x.x` (mobile arrivé).

## Hotfix prod

1. Branche `hotfix/<slug>` depuis `main`.
2. Fix + tests.
3. PR avec label `hotfix`, review accélérée.
4. Squash-merge.
5. Tag patch (`v1.2.3` → `v1.2.4`).
6. Deploy.

## Commits & doc — exemples concrets

| Situation | Branche | Commit |
|---|---|---|
| Ajouter le CRUD Members côté web | `feat/web-members-crud` | `feat(web): add Members CRUD with role assignment` |
| Corriger un bug dans Function de dues | `fix/dues-grace-overlap` | `fix(functions): handle overlapping grace periods on team switch` |
| Mettre à jour la doc Firebase | `docs/firebase-clarify-rules` | `docs(firebase): clarify rootAdmin bypass scope` |
| Refacto repo pattern | `refactor/web-repo-layer` | `refactor(web): unify error handling in repository layer` |
| Ajouter une migration | `feat/migration-007-add-license-fee` | `feat(functions): add migration 007 — backfill licenseFee in officialsConfig` |
