# Claude Code — `packages/shared-types`

> Types TypeScript partagés entre `apps/web`, `apps/control-plane`, et `functions/`.

## Principe

Source unique pour les types qui décrivent le schéma Firestore. Évite la dérive entre client et serveur.

## Structure

```
packages/shared-types/
  src/
    index.ts            # ré-exports
    config.ts           # /config/club
    user.ts             # /users
    member.ts           # /members
    role.ts             # /roles
    team.ts             # /teams
    venue.ts            # /venues + courts + timeSlots
    season.ts           # /seasons + closurePeriods
    booking.ts          # /bookings + officialAssignments + attendance
    matchType.ts
    matchRequest.ts
    notification.ts
    dues.ts             # /dues + paymentExceptionRequests
    license.ts          # /licenseRequests
    meta.ts             # /_meta/schema
  package.json
  tsconfig.json
```

## Conventions

- **Un fichier par collection / domaine**.
- Types nommés au singulier (`Member`, `Team`, `Booking`).
- Types d'input/output sans `id` (l'id est géré par Firestore) : `MemberData`. Avec id : `Member = MemberData & { id: string }`.
- **Pas de logique** dans ce package, juste des types.
- **Pas de dépendance Firebase** dans le package : utiliser `unknown` ou des types primitifs pour `Timestamp` (alias `Timestamp = { seconds: number; nanoseconds: number }` ou re-typer côté consumer).

## Avant de commit

- [ ] `npm run typecheck -w packages/shared-types` passe
- [ ] Tout consumer (web, functions, control-plane) build toujours
- [ ] `docs/firebase.md` reflète les mêmes champs

## Workflow de modif

Quand tu changes un type :
1. Modifie ici en premier.
2. Run `npm run typecheck` à la racine — corrige les erreurs dans les consumers.
3. MAJ `docs/firebase.md` si le schéma change.
4. Commit unique `refactor(types): ...` ou `feat(types): ...`.

## `mock-fixtures/` — fixtures de démo (mock-only)

Exception ciblée à la règle "pas de logique" : ce dossier contient des
**objets littéraux** (et de purs helpers `find` / `filter` sans état) destinés
à être partagés entre apps pour garantir la cohérence des démos sans Firebase
(ex. un `id` figé `lr-leo-2025` consommé à la fois par `apps/courtbase-app`
et `apps/courtbase-register`).

Règles :
- Objets littéraux + helpers `find` / `filter` synchrones uniquement — pas
  d'I/O, pas d'état, pas de mutation runtime.
- IDs figés. Toute mutation runtime se fait côté store de chaque app
  (sessionStorage ou log-only), jamais sur les fixtures source.
- Pas de dépendance Firebase (cohérent avec le reste du package).
- À **supprimer** quand le backend correspondant land — les fixtures
  deviennent alors des seeds Firestore versionnés ailleurs.

Drafts associés :
- `license-extended.ts` — types étendus du workflow "demande de licence
  parent". À promouvoir vers `license.ts` (fusion avec `LicenseRequestData`
  + conversion `number` → `Timestamp` + retrait de `denorm`) quand la Phase
  backend land. Supprimer le fichier après promotion.
