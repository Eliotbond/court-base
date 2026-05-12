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
