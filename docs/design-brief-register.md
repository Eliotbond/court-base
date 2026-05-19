# Design brief — app inscriptions (`courtbase-register`)

> Brief à copier-coller dans claude.ai/design pour produire les maquettes des écrans de l'app d'inscription publique.
> Spec produit complète : `docs/chantier-registrations.md`.
> Mockups existants du club (app admin) : design bundle `design-brief.md` (mémoire `design_bundle_import`).
> Tonalité : moderne, accueillante, mobile-first (les parents inscrivent souvent depuis leur téléphone), accessible.

## 0. À copier-coller dans claude.ai/design

> Je veux concevoir une web app responsive d'inscription pour un club de basketball amateur. L'app s'appelle **courtbase-register**. Elle est utilisée par des **parents et des joueurs adultes** pour s'inscrire eux-mêmes ou inscrire un enfant dans une équipe du club, puis pour finaliser leur licence fédérale.
>
> **Contraintes globales** :
> - Mobile-first (375px), responsive jusqu'à desktop (1280px).
> - Design system aligné sur l'app admin existante (PrimeVue + Tailwind, palette neutre + accents).
> - Tonalité : accueillante, rassurante, claire. Pas de jargon administratif. Le parent doit comprendre **où il en est** dans le flow à tout moment.
> - FR uniquement.
> - 16 écrans à concevoir (listés ci-dessous).
> - Composant **wizard** central : stepper visible en permanence avec étape courante + total. Le user peut revenir en arrière sans perdre ses saisies.
> - Aucune action destructive (suppression, annulation) sans confirmation modale.
>
> **Identité visuelle** : palette du club (à reprendre du design bundle de l'app admin — emerald, sky, amber, rose, violet, slate). Pas de marketing flashy : l'app reste un outil administratif d'un club sportif local.

## 1. Système (à concevoir d'abord — composants partagés)

| # | Composant | Description |
|---|---|---|
| S1 | **Layout shell** | Header (logo club + nom user signed in + menu déroulant Profil/Déconnexion) + zone contenu + footer (mentions légales). Mobile : header sticky condensé. |
| S2 | **Wizard stepper** | Barre de progression horizontale au-dessus du contenu, 8 étapes nommées. Étape courante mise en avant. Sur mobile : numéro courant + nom étape + "Étape X sur 8". |
| S3 | **Team card** | Carte d'équipe avec : nom (`U14M Loisir`), pill statut (Ouverte / Sous conditions / Complète), tags (chips colorés), horaires d'entraînement résumés (Lun 18:00 + Mer 18:00), photo + nom du head coach, bouton "Voir détails". |
| S4 | **Document upload tile** | Zone de drag&drop + bouton "Parcourir", affiche le fichier sélectionné (nom + taille + bouton supprimer), états : empty / uploading (progress) / uploaded / refused (avec motif et CTA "Remplacer"). |
| S5 | **Status pill** | Pill de status à 4 variantes : success (vert), warning (ambre), error (rouge), info (sky). Réutilisé pour le status d'équipe et le status de registration. |
| S6 | **Empty state** | Illustration légère + titre + texte explicatif + CTA. Utilisé quand : aucune équipe éligible, aucune inscription, etc. |

## 2. Écrans applicatifs

### E1. Landing publique (avant sign-in)

**But** : présenter l'app et inviter à se connecter.

Contenu :
- Hero : logo du club + headline ("Inscriptions {NomDuClub}") + sous-headline ("Rejoignez le club en quelques minutes — pour vous ou pour votre enfant.").
- Bloc "Comment ça marche" en 3 étapes (icônes + courts textes) :
  1. Créez votre compte.
  2. Choisissez une équipe et complétez l'inscription.
  3. Le coach vous contacte pour un essai.
- Bloc CTA central : 3 boutons d'auth (Google, Apple, Email). Style : bouton blanc avec logo provider à gauche, label "Continuer avec X" à droite.
- Lien discret "J'ai déjà un compte" → même action (sign-in et sign-up sont le même bouton côté Firebase Auth).
- Footer : mentions légales, lien vers le site du club.

### E2. Sign-in / Sign-up par email

**But** : alternative aux boutons OAuth.

Contenu :
- Toggle "Connexion / Création de compte" en haut.
- Champs : email + mot de passe (+ confirmation mot de passe en mode création).
- CTA "Continuer".
- Lien "J'ai oublié mon mot de passe" en mode connexion.
- Lien retour "← Autre méthode" vers E1.

### E3. Profil user (premier sign-in)

**But** : compléter `/users/{uid}` avec adresse + téléphone. Affiché **uniquement** au premier sign-in (pas de `profileCompletedAt`).

Contenu :
- Headline : "Quelques infos pour commencer".
- Sous-titre rassurant : "Ces informations restent privées et ne sont utilisées que par l'administration du club."
- Champs :
  - `displayName` (pré-rempli depuis OAuth si dispo, modifiable).
  - `email` (read-only si OAuth verifié, sinon avec étape verification).
  - `phone` — input avec drapeau + code pays (default CH).
  - `address` : Rue / Numéro / NPA / Ville / Pays. Input pays = select avec autocomplete.
- CTA "Continuer".
- Badge "Étape 0 de l'inscription" pour bien indiquer que le wizard ne démarre qu'après.

### E4. Home (après profil complet, ou retour user signed in)

**But** : afficher les inscriptions du user et lancer une nouvelle inscription.

Contenu :
- Header : "Bonjour {prénom}".
- Section "Mes inscriptions" :
  - Card pour chaque registration. Affiche : nom du joueur ("Pour vous-même" / "Pour {prénom enfant}"), team ciblée, status pill, date soumission.
  - États possibles à mocker (au moins 4 cards d'exemple) :
    1. **Brouillon** (status `draft`) — CTA "Reprendre".
    2. **Soumise** (status `submitted` / `open_pending_trial`) — texte "Le coach vous contactera bientôt".
    3. **En essai** (status `trial_in_progress`) — texte "Essai en cours, J+8 sur 14".
    4. **Licence à compléter** (status `confirmed_pending_dues` + licenseRequest active) — CTA "Compléter mes documents licence" (vers E14).
    5. **Refusée** (status `refused`) — texte motif + éventuel CTA "Voir la suggestion d'équipe alternative".
- CTA principal en bas : "Nouvelle inscription" → E5.
- Empty state si aucune inscription : illustration + texte "Aucune inscription pour le moment" + CTA "Commencer une inscription".

### E5. Wizard step 1 — "Pour qui ?"

**But** : choisir le type d'inscription et le lien de parenté.

Contenu :
- Stepper visible (étape 1/8).
- Titre : "Pour qui inscrivez-vous aujourd'hui ?".
- 2 grandes options en card :
  - **Pour vous-même** — illustration ou icône, texte "Vous êtes le joueur".
  - **Pour un enfant ou un pupille** — illustration, texte "Vous inscrivez quelqu'un dont vous êtes responsable".
- Si "enfant/pupille" sélectionné → apparition d'un sub-form "Quel est votre lien avec le joueur ?" en radio cards :
  - Parent
  - Tuteur légal
  - Frère / Sœur
  - Caritas / Association
  - Autre (avec champ texte)
- Boutons "Précédent" (désactivé étape 1) + "Continuer".

### E6. Wizard step 2 — Identité du joueur + AVS

**But** : saisir l'identité du joueur et déclencher le matching.

Contenu :
- Stepper (étape 2/8).
- Titre : "Qui est le joueur ?".
- Champs :
  - `firstName`, `lastName` (côte à côte sur desktop, stack mobile).
  - `birthDate` — date picker.
  - `gender` — select (M / F / Autre / Préfère ne pas dire).
  - **Bloc AVS distinct, mis en avant** :
    - Input `avs` avec masque `756.XXXX.XXXX.XX`.
    - **Note d'aide visible** sous le champ : *"Le numéro AVS est obligatoire pour établir la licence fédérale et finaliser l'inscription. Si le joueur n'a pas encore d'AVS (procédure d'asile, transfert depuis l'étranger), contactez directement le club."*
    - AVS **obligatoire** : le bouton "Continuer" reste désactivé tant que l'AVS n'est pas valide (pas de case "AVS non disponible").
- CTA "Continuer".

### E7. Wizard step 2.5 — Modal "Joueur similaire trouvé"

**But** : afficher le résultat du match AVS exact et demander confirmation.

Contenu (modal/dialog par-dessus E6) :
- Titre : "Nous avons trouvé un dossier correspondant".
- Card du membre existant matché : prénom + nom + date de naissance + initiales avatar + éventuelle équipe précédente.
- Texte explicatif : "Si c'est bien la même personne, nous allons rattacher cette inscription à son dossier existant — cela évite de créer un doublon."
- Boutons : "Oui, c'est la même personne" / "Non, c'est quelqu'un d'autre".
- Variante "plusieurs matches" : liste de 2-3 cards avec radio buttons + option "Aucun ne correspond".

### E8. Wizard step 3 — Choix de l'équipe

**But** : afficher les équipes éligibles à l'âge du joueur, avec leur statut.

Contenu :
- Stepper (étape 3/8).
- Titre : "Quelle équipe rejoindre ?".
- **Texte indicatif** affiché si > 1 équipe éligible (banner doux info) : *"Plusieurs équipes existent pour cet âge — elles diffèrent par leur niveau de pratique (loisir, compétition, élite). Lisez les descriptions ou contactez le coach avant de choisir."*
- Liste de TeamCard (S3), filtrée par âge.
  - Statut **Ouverte** → card cliquable + bouton "Choisir cette équipe".
  - Statut **Sous conditions** → card cliquable + pill ambre + petit texte "Acceptation par le coach requise".
  - Statut **Complète** → card grisée + tooltip "Cette équipe ne prend pas de nouveaux joueurs cette saison".
- Empty state si aucune équipe éligible : "Aucune équipe ouverte pour cet âge cette saison" + CTA mailto "Contacter le club".

### E9. Wizard step 4a — Manuel d'inscription (équipe ouverte)

**But** : afficher le mot du coach et confirmer.

Contenu :
- Stepper (étape 4/8).
- Titre : "Bienvenue dans l'équipe {teamName}".
- Bloc coach : photo + nom + email cliquable + téléphone cliquable.
- **Manuel d'inscription** rendu en markdown (texte du coach, peut être long). Exemple : *"Venez librement le mercredi 18h, sans inscription préalable. N'oubliez pas vos baskets et une bouteille d'eau."*
- Sidebar / sous-bloc "Horaires d'entraînement" : liste jour + heure + venue.
- CTA "Continuer l'inscription" + "Changer d'équipe" (retour E8).

### E10. Wizard step 4b — Conditions (équipe sous conditions)

**But** : afficher les conditions du coach et confirmer la candidature.

Contenu :
- Stepper (étape 4/8).
- Titre : "Conditions d'intégration — {teamName}".
- Bloc coach idem E9.
- **Description du coach** rendue en markdown : *"Tu dois maîtriser le dribble main faible et avoir déjà joué en club. Tests organisés mi-août."*
- **Critères en chips** (`conditionalCriteria`) : exemples — "Niveau intermédiaire", "Présence ≥ 80%", "Bases techniques".
- Banner info : "Votre candidature sera examinée par le coach. Vous recevrez une réponse dans les jours qui suivent."
- CTA "Soumettre ma candidature" + "Changer d'équipe".

### E11. Wizard step 5 — Contact & historique sportif

**But** : compléter les infos optionnelles.

Contenu :
- Stepper (étape 5/8).
- Titre : "Quelques infos supplémentaires".
- Champs :
  - `playerPhone` — input téléphone, label "Téléphone du joueur (recommandé)".
    - Helper text : *"Si le joueur est mineur, vous pouvez laisser vide — nous utiliserons votre téléphone parent."*
  - Switch `previouslyLicensed` : "Le joueur a-t-il déjà été licencié dans un autre club ?".
  - **Si activé** → apparition de :
    - `previousClubName` input.
    - Switch `previousClubAbroad` : "Ce club est-il à l'étranger ?".
- CTA "Continuer".

### E12. Wizard step 6 — Lettre de sortie (conditionnel)

**But** : informer + permettre upload (uniquement si `previouslyLicensed`).

Contenu :
- Stepper (étape 6/8).
- Titre : "Lettre de sortie de votre ancien club".
- Banner explicatif fort : *"Pour qu'une nouvelle licence soit délivrée, votre ancien club doit fournir une **lettre de sortie**. Vous pouvez l'uploader maintenant ou plus tard depuis votre espace personnel. Aucune licence ne pourra être émise tant que ce document manque."*
- Document upload tile (S4), label "Lettre de sortie (PDF ou image)".
- **Si `previousClubAbroad`** → bloc additionnel ambre : *"Transfert international détecté. Un admin du club vous contactera après votre inscription pour la procédure spécifique."*
- CTA "Continuer" (toujours actif, l'upload reste optionnel).

### E13. Wizard step 7 — Info licence

**But** : poser les attentes avant la soumission finale.

Contenu :
- Stepper (étape 7/8).
- Titre : "Avant de terminer — la licence fédérale".
- Bloc explicatif (texte structuré, pas un simple paragraphe) :
  - Section "Documents nécessaires pour la licence" — liste à puces avec icônes :
    - **Carte d'identité ou passeport** en cours de validité, recto **et** verso, lisible, entière. **Pas** de permis de conduire ni de permis de séjour.
    - **Formulaire de demande de licence** signé (nous vous le fournirons pré-rempli).
    - Pour les joueurs déjà licenciés ailleurs : **lettre de sortie**.
  - Section "Conditions" — pictogramme et phrase :
    - Validation du coach après essai.
    - Paiement de la cotisation annuelle.
    - Réception complète des documents.
  - Phrase finale : *"La décision d'établir une licence appartient au coach et à l'administration du club."*
- CTA "Soumettre mon inscription".

### E14. Wizard step 8 — Confirmation

**But** : succès + récap + next step.

Contenu :
- Illustration succès.
- Titre : "Inscription envoyée".
- Récap en card : joueur, équipe, statut "En attente de prise en charge".
- Texte : "Un email de confirmation vous a été envoyé à {email}. Le coach prendra contact avec vous dans les prochains jours."
- CTA principal : "Revenir à mes inscriptions" (vers E4).
- CTA secondaire : "Inscrire un autre joueur" (vers E5).

### E15. Page documents licence

**But** : uploader les docs après que le coach a déclenché une licenseRequest.

Contenu :
- Header : "Documents licence — {nom joueur}".
- Stepper visuel "Statut" : Demandée → Documents reçus → Vérification → Licence émise.
- Liste de Document upload tiles (S4) :
  - **Carte d'identité / passeport — recto** (helper text : "Image ou PDF, en entier, lisible. Pas de permis.").
  - **Carte d'identité / passeport — verso** (helper text idem).
  - **Formulaire de licence signé** — avec bouton "Télécharger le formulaire pré-rempli" en haut de la tile, puis tile d'upload pour le re-déposer signé.
  - **Lettre de sortie** — tile, **uniquement si requis** et pas déjà uploadée.
- Si un document a été refusé : tile en état "refused" avec motif visible + bouton "Remplacer".
- CTA "Sauvegarder et fermer" (autosave à chaque upload).

### E16. Modal "Devenir maître de mon membre"

**But** : permettre à un mineur devenu majeur de prendre la main sur son membre (post-transition).

Contenu (modal accessible depuis E4 quand applicable) :
- Titre : "Vous êtes désormais majeur".
- Texte explicatif : *"Votre dossier est actuellement géré par vos tuteurs ({listGuardians}). Vous pouvez à présent en prendre la main : vos communications viendront directement à vous, et vous gérerez vous-même vos inscriptions futures."*
- Banner info doux : "Cette action est irréversible. Vos tuteurs conserveront un accès en lecture seule si vous le souhaitez (option ci-dessous)."
- Option "Garder mes tuteurs en copie des communications" (toggle, default ON).
- CTA "Confirmer le transfert" + "Pas maintenant".

## 3. États à mocker explicitement

Pour chaque écran où c'est pertinent, fournir au moins :
- **Empty state** (E4, E8).
- **Loading state** (E8 lors du fetch des équipes, E15 pendant un upload).
- **Error state** (E2 mauvais mot de passe, E6 AVS invalide, E15 upload échoué).
- **Mobile + Desktop** (375px / 1280px).

## 4. Hiérarchie visuelle des étapes du wizard

À chaque étape :
1. **Stepper** (barre fine en haut).
2. **Titre** (h1, friendly, conversationnel).
3. **Sous-titre / explication** (optionnel, mais utile aux étapes anxiogènes — AVS, conditions, licence).
4. **Formulaire / contenu principal**.
5. **CTA** primaire + secondaire (Précédent en grisé).

Les CTA primaires sont en bas sur mobile (sticky bottom bar) et en bas-droit sur desktop. Le bouton "Précédent" est toujours visible (sauf étape 1).

## 5. Tonalité textes

À tester directement dans les maquettes (donc à inclure dans les copies des écrans) :
- **Rassurant** : éviter "obligatoire" si possible — utiliser "nécessaire pour ...".
- **Direct** : pas de longue intro légale, on explique pourquoi on demande l'info dans la helper text du champ.
- **Pas de tutoiement** par défaut (clubs amateurs mais administration → vouvoiement). À ajuster si le club veut tutoyer (paramètre futur).

## 6. Hors scope du design

- Les écrans **admin/coach** de validation des inscriptions vivent dans `apps/web` (déjà conçus dans le design bundle existant, à étendre dans un brief séparé).
- Les emails (templates) — séparé.
- Les écrans de paiement — pas avant Phase F (cf. spec produit).
