# Travailler avec Claude Code

> Comment donner du contexte à Claude Code efficacement sans surcharger sa fenêtre.

## Principe : context = minimum viable

Claude Code peut lire le repo à la demande. **Ne lui balance pas tout d'un coup.** Laisse-le suivre le routage défini dans `CLAUDE.md` (racine) et les `CLAUDE.md` locaux.

## Hiérarchie des fichiers de contexte

```
CLAUDE.md                      # racine — router court, règles globales
├── apps/web/CLAUDE.md         # contexte spécifique web
├── apps/control-plane/CLAUDE.md
├── apps/mobile/CLAUDE.md
├── functions/CLAUDE.md
└── packages/shared-types/CLAUDE.md
docs/
├── main.md                    # toujours pertinent
├── firebase.md                # si tu touches schéma/rules/Functions
├── frontend-desktop.md        # si tu touches le web
├── mobile-app.md              # si tu touches le mobile
├── deployment.md              # si tu touches le multi-projet
├── git-workflow.md            # si tu fais une PR
└── claude-code-guide.md       # ce fichier
```

## Comment démarrer une session

### Cas 1 — Nouvelle feature
```
Tu : "Je veux implémenter le CRUD Members côté web."
Claude Code : [lit CLAUDE.md racine → apps/web/CLAUDE.md → docs/main.md + docs/frontend-desktop.md + docs/firebase.md (section members)]
```

Tu n'as **pas** besoin de lui dire quoi lire. Le système de routage le fait.

### Cas 2 — Bug fix
```
Tu : "Le booking ne passe pas en 'cancelled' quand on ajoute une closure."
Claude Code : [lit docs/firebase.md (section bookings + Functions) + functions/CLAUDE.md]
```

### Cas 3 — Question domaine
```
Tu : "Rappelle-moi le flow des dues exceptions."
Claude Code : [lit docs/main.md section Dues]
```

## Comment mettre à jour la doc / les règles

### Workflow standard

Quand tu veux changer une règle métier, un schéma, ou un workflow :

```
Tu : "Change la règle : le grace period des dues passe à 30 jours par défaut, et je veux pouvoir le paramétrer par équipe et non plus globalement."
```

Claude Code doit :
1. Identifier les docs impactés (`main.md`, `firebase.md`).
2. Modifier les docs **en premier**.
3. Propager dans le code : `firestore.rules`, `functions/`, `apps/web/`, `packages/shared-types/`.
4. Une seule PR avec commit `feat(functions): make dues grace period per-team`.

### Si tu n'es pas sûr de l'impact

Demande :
```
Tu : "Avant de coder, dis-moi tous les endroits qu'on doit toucher si je veux X."
```

Claude Code listera les fichiers (docs + code + rules + types) et tu valides.

## Patterns à favoriser

### "Référence explicite à un doc"
```
Tu : "Implémente l'écran Members selon la section 'Members' de docs/main.md."
```
Claude charge directement le bon fichier.

### "Reprend la dernière session"
```
Tu : "On était sur le CRUD Members. Reprends où on s'est arrêtés et regarde ce qui a été fait sur la branche feat/web-members-crud."
```

### "Self-check"
```
Tu : "Avant de commit, vérifie que les rules sont à jour, que les types shared sont sync, et que docs/firebase.md reflète tes changements."
```

## Patterns à éviter

- ❌ Copier-coller tous les docs en début de session. Inutile, Claude lit à la demande.
- ❌ Demander à Claude de "tout connaître le projet" avant de coder. Il chargera ce qu'il faut quand il faut.
- ❌ Laisser Claude commit sans qu'il ait MAJ la doc concernée.

## Quand Claude Code dérive

Si une session devient longue / confuse :
- **Nouvelle session** + résumé court : *"Je travaille sur X. Voilà où on en est : [3 lignes]. Reprends."*
- Demande à Claude de **résumer ce qu'il a fait** avant de continuer.
- Demande de **relire `CLAUDE.md` racine** s'il commence à ignorer les règles globales.

## Conventions Claude Code

| Tu dis | Claude fait |
|---|---|
| "Implémente X" | Code + tests + MAJ docs si règle/schéma touché |
| "Quel est l'impact de X ?" | Liste fichiers, pas de modif |
| "Mets à jour la doc" | Modifie `.md`, pas de code |
| "Refacto X" | Pas de changement fonctionnel, pas de doc à toucher en principe |
| "Commit & push" | Conventional commit, branche feature, push, ouvre PR si demandé |

## Cas particulier : Phase 0

Tant que le control-plane et les scripts de provisioning n'existent pas, **développe en local sur un seul projet Firebase de dev**. Le multi-projet est conceptuel pour l'instant. Quand on attaque Phase 0, on créera l'editor project et on adaptera la CI.

## Mémo final

> Le doc est la source de vérité. Le code suit la doc. Claude Code synchronise les deux.
