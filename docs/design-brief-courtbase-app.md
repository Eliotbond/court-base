# Design brief — `courtbase-app` (companion mobile-first)

> Brief à copier-coller dans claude.ai/design pour produire les maquettes de l'app companion du club.
> Spec produit complète : `docs/courtbase-app.md`.
> Spec métier : `docs/main.md`. Schéma : `docs/firebase.md`.
> Tonalité : **outil de terrain** — claire, dense, rapide d'usage. Pas marketing.

---

## 0. À copier-coller dans claude.ai/design

> Je veux concevoir une web app responsive **mobile-first** pour le **personnel d'un club de basketball amateur** : les coachs (gestion d'équipe, présences, demandes), les officiels (table de marque, arbitres ; voir et confirmer leurs assignations), et les admins (validation des demandes, override staffing en mobilité). L'app s'appelle **courtbase-app**.
>
> **Ce n'est pas une app pour parents/joueurs** (eux passent par `courtbase-register`, déjà conçue). C'est un **outil de travail** pour les bénévoles du club, à utiliser en bord de terrain ou dans le bus.
>
> **Contraintes globales** :
> - **Mobile-first 375px**, scale jusqu'à desktop 1280px (tablet 768px + desktop 1024px+ doivent rendre proprement, mais l'optimisation prioritaire est mobile portrait).
> - Design system aligné sur l'app admin existante (PrimeVue + Tailwind, palette neutre + accents emerald / sky / amber / rose / violet / slate).
> - **Tab bar bottom** sur mobile (3-4 onglets selon les rôles du user), **sidebar gauche** sur desktop ≥1024px.
> - Tonalité : **directe, opérationnelle**. Pas de tutoriels longs, pas de jargon marketing. On annonce ce qu'on attend de l'utilisateur en 1 phrase et on lui donne le CTA.
> - **Vouvoiement** (cohérent avec `courtbase-register`).
> - **FR uniquement**.
> - Composants centraux : tab bar role-aware, listes denses avec pills de status, dialog fullscreen sur mobile, sticky bottom CTAs.
> - **Aucune action destructive** sans confirmation modale (annuler une assignation, désactiver un membre, refuser une demande, etc.).
> - Affichage de l'**identité** en permanence : sur mobile, header compact "Logo club · {prénom user}", icône cloche notifications avec badge non-lus, menu kebab pour profil/déconnexion.
>
> **Identité visuelle** : palette du club (cf. design bundle de l'app admin existante — emerald / sky / amber / rose / violet / slate). L'app reste un outil administratif sportif local, **pas** un produit consumer flashy. Beaucoup de texte, peu d'images.
>
> Couleurs à utiliser :
> - **Emerald** : succès / confirmé.
> - **Amber** : attention / en attente / exception pending.
> - **Rose** : danger / exclusion / refus.
> - **Sky** : info / pending bénin.
> - **Violet** : tags admin / assignations.
> - **Slate** : neutre / inactif / placeholders.

---

## 1. Système (composants partagés à concevoir d'abord)

| # | Composant | Description |
|---|---|---|
| S1 | **Shell mobile** | Header sticky compact (logo club mini + nom user + cloche notifs avec badge + menu kebab Profil/Déconnexion). Tab bar bottom (max 4 onglets selon rôles : Coach / Officiel / Admin / Notifs). Zone safe area iOS respectée. |
| S2 | **Shell desktop** | Sidebar gauche fixe (220px), logo en haut, items navigation (1 par audience), avatar + nom user en bas. Zone contenu à droite, max-width 1080px centré. Tab bar absente. |
| S3 | **Tab bar bottom (mobile)** | 3-4 items selon les rôles. Icône + label, item actif en couleur primaire, badge numérique rouge sur l'onglet Notifs. Hauteur 56px + safe-area. |
| S4 | **Status pill** | 4 variants (emerald success, amber warning, rose error, sky info). Réutilisé partout (status assignation, status registration, status due). |
| S5 | **Member row** | Ligne dense de membre : avatar (initiales), nom + prénom (gras), 1-2 pills de status (cotisation, licence), petit texte secondaire (n° de licence, équipe…). Tappable, chevron à droite sur mobile, hover state sur desktop. |
| S6 | **Match card** | Carte match : badge type (chip coloré CSJC/AFBB/Amical), date + heure proéminentes, opponent name, lieu (venue + court OU adresse extérieure si away), pill "à pourvoir X/Y" si staffing incomplet. |
| S7 | **Empty state** | Illustration légère (icône) + titre + texte + CTA optionnel. Pour : aucune équipe, aucune assignation, aucune notif, etc. |
| S8 | **Sticky bottom action bar** | Sur mobile : 1-2 CTAs primary/secondary collés en bas du viewport, fond blanc, ombre légère vers le haut. Sur desktop : CTAs alignés à droite en haut du contenu. |
| S9 | **Dialog fullscreen mobile** | Sur mobile, toute confirmation / formulaire ouvre un fullscreen avec header (← retour + titre) et content scrollable + CTA sticky bas. Sur desktop : dialog PrimeVue centré classique. |
| S10 | **Notification list item** | Row de notif : icône type (cloche / urgent / match / officials_needed), titre court + extrait, timestamp relatif (il y a 2h), point de "non-lu" à gauche si pas dans `readBy[]`. Tap = deep-link + marquer lu. |
| S11 | **Member-inactive blocker** | Plein écran : illustration ✕, titre "Votre compte est inactif", texte "Contactez l'administration de votre club ou réinscrivez-vous via le portail.", CTA primary "Ouvrir le portail d'inscription" (lien `courtbase-register`), CTA secondary "Se déconnecter". |

---

## 2. Écrans communs (tous rôles)

### C1. Sign-in

**But** : authentifier l'utilisateur. Pas de sign-up direct ici — l'accès se fait toujours sur invitation (admin) ou liaison member (depuis l'app admin).

Contenu :
- Hero compact : logo du club centré, headline "Connexion équipe {NomClub}", sous-headline "Coachs, officiels et admins du club".
- 3 boutons d'auth verticaux : **Google**, **Apple**, **Email** (style identique à `courtbase-register` — logo provider + label "Continuer avec X").
- En-dessous, lien discret "J'ai déjà essayé sans succès — contactez le club" → mailto pré-rempli.
- Footer minuscule : version de l'app + lien mentions légales.

**État erreur** : si OAuth tombe sur un compte non-invité (deny-orphan), affichage d'un toast rose "Compte non autorisé. Demandez à un admin de votre club de vous inviter." + retour sign-in.

### C2. Profile completion (premier sign-in)

**But** : compléter `/users/{uid}` avec `displayName`, `phone`, `address` si absent. Identique à E3 de `courtbase-register` mais en mobile-first plus compact.

Contenu :
- Headline "Quelques infos pour commencer".
- Champs : `displayName`, `phone` (input avec drapeau CH), `address` (Rue / N° / NPA / Ville / Pays).
- CTA sticky bas "Continuer".
- Skippable **non** : le user ne peut pas accéder à l'app tant que le profil n'est pas complété (cohérent avec `register`).

### C3. Home (role-aware)

**But** : point d'entrée après login. Le contenu dépend des rôles du user.

Structure générale :
- Header standard.
- **Si rôles multiples** (ex: coach + official) → tab bar bottom avec 1 onglet par rôle + 1 onglet "Notifs". Tab actif = home du rôle prédominant (coach en priorité, puis official, puis admin).
- **Si 1 seul rôle** → pas de tab bar de rôle, juste 2 onglets : "Accueil" + "Notifs".

#### C3-coach. Home Coach
- Section "Mes équipes" : liste de Team cards (nom équipe, catégorie + tag, nombre de joueurs, chevron).
- Section "À traiter" : raccourcis pills cliquables — "{N} inscriptions à valider", "{N} exclusions à gérer".
- CTA secondaire en bas : "Créer un match à l'extérieur" (raccourci direct vers CO7).

#### C3-official. Home Officiel
- Banner info en haut si `member.officialLicense == null` : amber, "Vous n'avez pas de licence officiel active — l'auto-inscription est bloquée. Contactez votre admin.".
- Section "Matchs à pourvoir" : liste de Match cards triées par date, max 5 puis lien "Voir tous".
- Section "Mes assignations à venir" : 3 prochaines assignations, status pill, CTA "Confirmer" / "Décliner" inline si pending.

#### C3-admin. Home Admin (mobile)
- Section "Requests à traiter" : 3 raccourcis pills — "{N} demandes de licence", "{N} demandes d'exception cotisation", "{N} demandes de déplacement match".
- Section "Matchs à pourvoir" : liste compacte des bookings `match_home` < 7 jours non full staff (cross-club).
- CTA "Envoyer une notification" en bas (vers A4-broadcast).

### C4. Liste des notifications

**But** : voir l'historique des notifs reçues, marquer lues, ouvrir le deep-link.

Contenu :
- Liste paginée de Notification list items (S10).
- Filtres en haut (chips horizontaux scrollables) : "Toutes" (default), "Non lues", "Matchs", "Demandes", "Urgentes".
- Pull-to-refresh.
- Empty state si aucune notif : "Pas de notification pour le moment" + illustration cloche.
- Tap sur un item → deep-link route correspondante + `readBy[]` mis à jour.

### C5. Profil utilisateur

**But** : voir et éditer ses infos perso + gérer les préférences notifs + déconnexion.

Contenu :
- Card user : avatar (initiales), `displayName`, email, téléphone, adresse formatée.
- Section "Préférences notifications" : toggle "Recevoir les notifications push", lien "Tester une notification" (envoie une notif de test au token courant).
- Section "Membre lié" (si `user.memberId`) : nom du membre, équipes, statut licence — read-only, pas de modif ici.
- Section "Rôles" : liste de chips read-only.
- CTA tertiaire en bas : "Se déconnecter" (rose).

### C6. Membre inactif (blocker)

**But** : afficher S11 quand `linkedMember.active === false` au boot post-login.

(cf. S11 dans la section système)

---

## 3. Écrans Coach

### CO1. Mes équipes

**But** : lister les équipes que coache le user.

Contenu :
- Header "Mes équipes".
- Liste de Team cards :
  - Nom équipe (gras), pill catégorie + chip tag.
  - Sous-texte : `{N} joueurs · prochain training {date}`.
  - Badge alerte rose en coin si exclusions actives dans cette équipe (`{N} exclus`).
- Empty state si aucune équipe : "Vous n'êtes coach d'aucune équipe. Contactez l'admin du club."

### CO2. Effectif d'équipe

**But** : voir tous les joueurs d'une équipe, accéder à leur détail, ajouter un membre.

Contenu :
- Header "Effectif — {nom équipe}", flèche retour.
- Tabs : "Joueurs" (default) · "Staff" (coachs/officiels de l'équipe, read-only).
- Liste de Member rows (S5) :
  - Avatar + nom + DOB compacte.
  - Pills : status cotisation (emerald paid / amber pending_grace / amber issued / rose excluded / sky excepted), pill licence (emerald licencié / slate non-licencié).
  - Si excluded : pill rose "Exclu" + petit texte "Cotisation impayée".
  - Si excepted : badge violet "Exception pending".
- Sticky bottom CTA "+ Ajouter un joueur" → CO3.

### CO3. Member form (create / edit)

**But** : créer ou éditer un joueur.

Contenu :
- Header "Nouveau joueur" ou "Modifier {prénom}", flèche retour.
- Champs (sections collapsées par défaut sur mobile, ouvertes sur desktop) :
  - **Identité** : prénom, nom, date de naissance, genre.
  - **Contact** (optionnel) : téléphone joueur, email.
  - **Adresse** : rue, n°, NPA, ville, pays.
  - **Rôles** : checkboxes (player default, official, coach, referee).
  - **AVS** : input masque + helper "Obligatoire pour établir la licence fédérale".
  - **Tuteurs** (si DOB < 18 ans) : section "Tuteurs", liste des tuteurs liés + bouton "Lier un tuteur" (recherche par email parmi `/users`).
- Sticky CTA bas "Enregistrer" + secondaire "Annuler".

**Mode édition** : bouton kebab top-right avec actions "Désactiver" (rose, modal de confirmation type-to-confirm "tape 'désactiver' pour confirmer") + "Voir la fiche détaillée" (vers CO4).

### CO4. Detail member (fiche compacte)

**But** : voir le détail d'un joueur, accéder aux actions coach.

Contenu :
- Header avec avatar + nom + équipe.
- Quick info card : DOB + âge, n° de licence (si licencié), AVS (masqué 756.xxx.xxxx.xx avec toggle "Voir"), tuteurs si mineur.
- Section "Cotisation saison courante" : status pill + montant + date paiement si payée + si excluded : CTA "Soumettre une demande d'exception" (vers CO4-exception).
- Section "Licence" : pill "Licencié" / "Non licencié" + toggle (avec dialog de confirmation) "Demander une licence" / "Demander retrait" → crée `licenseRequest` pending.
- Section "Présences saison" : compteur P/A/E + lien "Voir le détail".
- CTA bas : "Éditer la fiche" (vers CO3 edit) + kebab "Désactiver".

### CO4-exception. Dialog "Soumettre une exception cotisation"

Modal fullscreen mobile / dialog desktop :
- Titre "Exception cotisation — {prénom}".
- Texte d'explication : "Soumettez une demande d'exception pour que ce joueur puisse continuer à s'entraîner pendant que sa cotisation est régularisée. L'admin examinera votre demande."
- Champ "Motivation" (textarea, obligatoire, min 20 chars).
- CTA "Soumettre la demande" + "Annuler".
- Toast emerald success "Demande envoyée — le joueur peut s'entraîner en attendant la décision."

### CO5. Planning d'équipe

**But** : voir le planning bookings d'une équipe, naviguer par semaine.

Contenu :
- Header "Planning — {nom équipe}", segmented control "Semaine" / "Mois" (Mois optionnel v2).
- Vue semaine compacte mobile :
  - Bandeau horizontal scrollable de 7 jours (L M M J V S D + numéro date), jour actif souligné.
  - Liste verticale des bookings du jour sélectionné, triés par heure.
  - Chaque booking = card horizontale : heure début-fin, type (chip coloré : training emerald, match_home violet, match_away sky, freed/cancelled slate), venue + court OU adresse away.
  - Tap card → CO6 (attendance pour training) ou détail match (read-only).
- Vue semaine desktop : grille 7 colonnes × heures, blocks colorés par slotType.
- Sticky CTA bas "+ Réserver un créneau" (ad-hoc booking sur slot freed/reserve).

### CO6. Attendance d'un training

**But** : marquer présence des joueurs sur un booking de training.

Contenu :
- Header "Présences — {date} {heure} · {team}".
- Sub-header : info booking (venue + court).
- Liste des joueurs de l'équipe (Member row condensé) avec 3 boutons radio horizontaux par row :
  - **Présent** (emerald, défaut blanc) — **désactivé** si `duesStatus == "excluded"` et **pas** d'exception pending.
  - **Absent** (slate).
  - **Excusé** (amber).
- Si joueur excluded : row barré + pill rose "Exclu" + texte "Pas d'option présent" + tooltip "Cotisation impayée — soumettez une exception depuis sa fiche".
- Si joueur excepted : badge violet "Exception pending" mais options dispo normalement.
- Sticky CTA bas "Enregistrer".

### CO7. Création match à l'extérieur

**But** : créer un match away pour son équipe.

Contenu :
- Header "Nouveau match extérieur — {team}".
- Champs :
  - **Date** (date picker).
  - **Heure de début** (time picker).
  - **Équipe adverse** (input texte, obligatoire).
  - **Adresse du gymnase extérieur** (textarea ou input multi-ligne).
  - **Type de match** (select parmi `/matchTypes` actifs).
- Banner info amber si trainings de l'équipe conflictueux détectés : "Les entraînements suivants seront libérés automatiquement : ...".
- Sticky CTA bas "Créer le match".

### CO8. Liste registrations à traiter

**But** : voir les registrations soumises pour les équipes du coach.

Contenu :
- Header "Inscriptions".
- Filtres chips : "À traiter" (default — status `submitted` + `open_pending_trial` + `conditional_pending_review`) · "Essai en cours" · "Toutes".
- Liste de registration cards :
  - Avatar + nom joueur + DOB.
  - Team cible + status pill.
  - Date soumission.
  - Si status = `submitted` : 2 CTAs inline "Marquer essai en cours" + "Refuser".
  - Si status = `trial_in_progress` : indication "Essai depuis {date}" + 2 CTAs "Confirmer l'inscription" + "Refuser".
- Tap card → CO9 (détail registration).

### CO9. Détail registration

**But** : voir tous les détails d'une registration avant décision.

Contenu :
- Header "Inscription — {prénom nom joueur}", flèche retour.
- Card "Joueur" : DOB, AVS, gender, contact, adresse.
- Card "Inscrit par" : nom du parent / tuteur, relationship, contact.
- Card "Historique" : `previouslyLicensed` (oui/non), nom ancien club, à l'étranger ou non.
- Card "Documents" : lettre de sortie (si uploadée), state pills.
- CTAs bas : "Confirmer l'inscription" (emerald) + "Refuser" (rose, ouvre dialog motivation) + "Marquer essai en cours" (sky) — disponibles selon status courant.

### CO10. Demande de déplacement match home (matchRequest)

**But** : demander à l'admin de déplacer un `match_home` existant.

Accessible depuis le détail d'un booking match_home dans CO5.

Contenu :
- Modal fullscreen / dialog desktop.
- Titre "Demande de déplacement".
- Récap du match actuel (date, heure, court, opponent).
- Champs : nouvelle date proposée, nouvelle heure, court préféré (select des courts du club), motivation (textarea obligatoire).
- CTA "Envoyer la demande" → crée `/matchRequests` pending. Toast confirmation + retour CO5.

---

## 4. Écrans Officiel

### O1. Matchs à pourvoir

**But** : afficher les matchs needing officials accessibles à l'officiel (filtrés au niveau).

Contenu :
- Header "Matchs à pourvoir".
- Banner info amber si `member.officialLicense == null` : "Vous n'avez pas de licence officiel active. L'auto-inscription est bloquée."
- Filtres chips : "Tous" (default) · "Domicile" · "Extérieur" · "Cette semaine".
- Liste de Match cards (S6) triées par date :
  - Date + heure proéminentes.
  - Pill "À pourvoir 2/3" (avec ratio).
  - Type de match (chip coloré).
  - Lieu.
  - Petit avatar group des officiels déjà inscrits (initiales).
- Tap card → O3 (détail match).
- Empty state : "Aucun match à pourvoir pour le moment".

### O2. Mes assignations

**But** : voir ses propres assignations (toutes saisons confondues v1).

Contenu :
- Header "Mes assignations".
- Tabs : "À venir" (default) · "Passées".
- Tab "À venir" : 3 sections collapsibles :
  - **Pending** (chip ambre, badge nombre).
  - **Confirmées** (chip emerald, badge).
  - **Déclinées** (chip slate, badge).
- Chaque row = mini Match card + CTA inline selon status :
  - Pending → "Confirmer" + "Décliner".
  - Confirmed → "Ajouter au calendrier" + kebab "Décliner".
  - Declined → kebab "Re-postuler".
- Tap row → O3 détail match.

### O3. Détail match

**But** : voir toute l'info d'un match et CTA contextuel.

Contenu :
- Header avec date + heure proéminents.
- Card type de match + opponent + lieu.
- Card "Équipe à domicile" (si home match) : nom équipe + coach + contact.
- Section "Officiels" : liste des assignations actuelles, par niveau requis :
  - "Niveau 2 : 1/2 — {nom} (confirmé)" / "À pourvoir".
  - Avatars + status pills.
- Section "Vous" :
  - Si pas inscrit : CTA primary "Je m'inscris" (gaté côté UI si pas de licence active).
  - Si inscrit `pending` : 2 CTAs "Confirmer" + "Décliner".
  - Si inscrit `confirmed` : CTA "Ajouter au calendrier" (génère `.ics` + lien Google Cal) + kebab "Décliner".
  - Si inscrit `declined` : CTA "Re-postuler".
- Note : pas de rappels locaux à planifier côté client (le backend envoie les push J-1 et H-2).

### O4. Dialog confirmation / décline

Modal fullscreen mobile / dialog desktop :
- Pour "Décliner" : champ "Motif" (optionnel, textarea), CTA "Confirmer le refus" (rose).
- Pour "Confirmer" : récap du match + CTA "Confirmer ma présence" (emerald).
- Toast après action + retour O2 ou O3.

---

## 5. Écrans Admin restreint

### A1. Staffing officiels (cross-club)

**But** : voir tous les matchs à pourvoir du club et override le staffing.

Contenu :
- Header "Staffing officiels".
- Filtres chips : "À pourvoir" (default — staffing incomplet) · "Tous les matchs" · "Cette semaine" · "Mois".
- Liste de Match cards (S6) avec ratio "X/Y".
- Tap card → A2 détail staffing.

### A2. Détail staffing match

**But** : éditer les assignations d'un match.

Contenu :
- Header avec récap match.
- Section "Assignations" : liste éditable, 1 row par slot d'officiel requis (par niveau) :
  - Si vide : CTA "+ Assigner un officiel" (ouvre dialog de sélection parmi les members `/members` avec `officialLevel >= requiredLevel`).
  - Si rempli : avatar + nom + status pill + kebab "Retirer" / "Notifier" / "Forcer confirmé" (rootAdmin only).
- Section "Notification" : CTA "Envoyer un rappel officials_needed" si staffing incomplet.

### A3. Requests à traiter

**But** : voir et traiter les 3 types de requests pending.

Contenu :
- Header "Demandes".
- Tabs : "Licences" · "Exceptions cotisation" · "Déplacements match".
- Chaque tab = liste de request cards :
  - Nom membre / coach demandeur.
  - Date demande.
  - Motivation extrait.
  - 2 CTAs inline "Approuver" (emerald) + "Refuser" (rose).
- Tap card → écran détail de la request (titre + tous champs + commentaire avant decision).

### A4. Broadcast notification

**But** : envoyer une notification manuelle à une audience donnée.

Contenu :
- Header "Envoyer une notification".
- Form :
  - **Type** : select parmi `urgent`, `officials_needed`, `match_reminder`, `new_match`.
  - **Audience** : radio "Tous les officiels" / "Officiels par niveau" (sub-select) / "Membres d'une équipe" (sub-select team) / "Custom" (multi-select users).
  - **Titre** (input texte).
  - **Message** (textarea).
  - **Deep-link** (optionnel, select parmi routes connues : match X, equipe Y, etc.).
- Sticky CTA "Envoyer" + secondaire "Aperçu" (qui montre la card de notification telle qu'elle apparaîtra).
- Confirmation modale "Confirmer l'envoi à {N} destinataires" avant submit.

---

## 6. États à mocker explicitement

Pour les écrans clés, fournir :

- **Loading state** (skeleton rows) : C3 (home), CO2 (effectif), O1 (matches), A1 (staffing).
- **Empty state** : CO1 (aucune équipe), O1 (aucun match à pourvoir), O2 (aucune assignation), A3 (aucune request), C4 (aucune notif).
- **Error state** : C1 (sign-in échoué — toast rose), tout callable raté → toast d'erreur générique avec code.
- **Member inactif blocker** (C6).
- **Banner amber "Pas de licence officiel"** (sur C3-official et O1).
- **Mobile portrait 375px** + **Mobile landscape 667px** (optionnel) + **Tablet 768px** + **Desktop 1280px**.

---

## 7. Tonalité textes

- **Direct, opérationnel** : "Marquer présent", "Confirmer ma présence", "Soumettre la demande". Pas de "voulez-vous, peut-être...".
- **Vouvoiement**.
- **Pas de jargon** : "Cotisation impayée" plutôt que "duesStatus excluded".
- **Helpers concrets** sous les inputs uniquement quand l'info change la décision (AVS, exception motivation).
- **Toasts** : 1 phrase max + un verbe au passé ("Inscription confirmée", "Demande envoyée", "Présences enregistrées").

---

## 8. Conventions visuelles

### Tab bar bottom (mobile)
- 56px + safe-area iOS.
- Icône 24px + label 11px.
- Item actif : couleur primaire + label gras + indicator subtle ligne en haut.
- Badge non-lus (Notifs) : pastille rose 8px en haut-droite de l'icône.

### Header mobile
- Sticky, 56px.
- Logo club mini à gauche (32px).
- Titre de la page au centre (truncate si long).
- Cloche notifs + menu kebab à droite.
- Flèche retour à la place du logo si pas sur home.

### Cards
- Border-radius 12px sur mobile, 16px sur desktop.
- Shadow légère, élevation 1.
- Tap target minimum 44×44px sur mobile.

### Inputs
- Hauteur 44px minimum (touch-friendly).
- Label au-dessus, placeholder dedans (pattern PrimeVue InputText).
- Erreur en rouge sous l'input, jamais en tooltip.

### Couleurs sémantiques (à respecter strictement)
- **Emerald** : confirmé, payé, présent, ouvert, succès, licencié.
- **Amber** : pending bénin, en attente, à pourvoir, exception pending, profil incomplet.
- **Rose** : exclusion, refus, erreur, danger, suppression, urgent.
- **Sky** : info, déclaration, neutre informatif.
- **Violet** : tags / admin / assignations.
- **Slate** : inactif, archivé, neutre, disabled.

---

## 9. Hors scope du design

- **Inscriptions parents/joueurs** → c'est `courtbase-register`, déjà conçu (`design-brief-register.md`).
- **App admin desktop complète** → c'est `apps/web`, déjà conçue (design bundle existant).
- **Module comptabilité** → reste sur `apps/web` (rôle treasurer / rootAdmin).
- **Settings club** (venues, matchTypes, cotisations, catégories, etc.) → reste sur `apps/web`.
- **Emails (templates)** → séparé.
- **Mode sombre** → pas avant que `apps/web` ne l'ait.
- **Multilingue** → FR uniquement.

---

## 10. Annexe : map des écrans → callable backend

Pour cadrer le designer sur ce qui est techniquement supporté (tout existe déjà) :

| Écran | Callable / write |
|---|---|
| C1 | `firebase.auth().signInWith*` + callable `acceptInvitation` |
| C2 | `setDoc /users/{uid}` (self-update) |
| CO3 (create) | `coachCreateMember` |
| CO3 (edit) | `coachUpdateMember` |
| CO3 (deactivate) | `coachDeactivateMember` |
| CO4-exception | `addDoc /paymentExceptionRequests` |
| CO4 toggle licence | `addDoc /licenseRequests` |
| CO5 ad-hoc booking | `addDoc /bookings` (coach scope) |
| CO5 cancel training | `updateDoc /bookings/{id}` `status=freed` |
| CO6 attendance | `setDoc /bookings/{id}/attendance/{memberId}` |
| CO7 | `coachCreateAwayMatch` |
| CO8/CO9 markTrial | `markTrialInProgress` |
| CO8/CO9 confirm | `confirmRegistration` |
| CO8/CO9 refuse | `refuseRegistration` |
| CO10 | `addDoc /matchRequests` |
| O3 self-register | `addDoc officialAssignment` |
| O3/O4 confirm | `updateDoc officialAssignment.status=confirmed` |
| O3/O4 decline | `updateDoc officialAssignment.status=declined` |
| A2 assign | `addDoc officialAssignment` (admin scope) |
| A3 approve license | `updateDoc /licenseRequests/{id} status=approved` |
| A3 approve exception | `updateDoc /paymentExceptionRequests/{id} status=approved` |
| A3 approve matchRequest | `processMatchRequest` |
| A4 broadcast | `addDoc /notifications` (trigger `fanoutNotification` push automatique) |
