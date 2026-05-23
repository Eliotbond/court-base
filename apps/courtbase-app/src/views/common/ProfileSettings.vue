<script setup lang="ts">
/**
 * C5 — Profil utilisateur.
 *
 * Vue companion (mobile-first + desktop ≥1024px) qui affiche les infos perso
 * du user connecté, ses rôles, le membre lié (si applicable), les
 * préférences notifications (toggle push + lien test) et le bouton de
 * déconnexion.
 *
 * Source de données : `useAuthStore()` (qui projette `MOCK_SESSION`) +
 * `getMember()` / `getTeam()` pour résoudre le membre lié et ses équipes.
 *
 * **Mock only** — `logMockAction(...)` pour test-notif et signout. Le wiring
 * réel (callable + redirect) sera fait quand on branchera Firebase Auth.
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Bell,
  BellRing,
  Calendar,
  ChevronRight,
  Clipboard,
  LogOut,
  Mail,
  MapPin,
  Phone,
  Send,
  Users,
} from 'lucide-vue-next'
import ToggleSwitch from 'primevue/toggleswitch'

import CbAvatar from '@/components/ui/CbAvatar.vue'
import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import CbPill from '@/components/ui/CbPill.vue'
import type { CbTab } from '@/components/ui/CbTabBar.vue'
import type { CbNavItem } from '@/components/ui/CbSidebar.vue'
import { useViewport } from '@/composables/useViewport'
import {
  getMember,
  getTeam,
  logMockAction,
  type MockMember,
  type MockTeam,
} from '@/repositories/mock'
import { useAuthStore } from '@/stores/auth'
import type { AppRole } from '@/types/roles'

const router = useRouter()
const auth = useAuthStore()
const { isDesktop } = useViewport()

// ───────────────────────────────────────────────────────────────
// Données dérivées du store auth
// ───────────────────────────────────────────────────────────────

/**
 * Adresse fictive utilisée pour le mock-up — `MOCK_SESSION` ne porte pas
 * d'adresse pour l'instant (le champ vivra dans `/users/{uid}` quand on
 * branchera Firestore). C'est inliné ici sans toucher au seed.
 */
const MOCK_ADDRESS = 'Rue du Lac 12, 1700 Fribourg, Suisse'

const displayName = computed(() => auth.displayName)
const email = computed(() => auth.session.email)
const phone = computed(() => auth.session.phone)
const address = MOCK_ADDRESS

const roles = computed<AppRole[]>(() => auth.roles)

const linkedMember = computed<MockMember | null>(() => {
  const id = auth.session.linkedMemberId
  return id ? getMember(id) : null
})

const linkedMemberTeams = computed<MockTeam[]>(() => {
  const m = linkedMember.value
  if (!m) return []
  return m.teamIds
    .map((id) => getTeam(id))
    .filter((t): t is MockTeam => t != null)
})

const linkedMemberFullName = computed(() => {
  const m = linkedMember.value
  return m ? `${m.firstName} ${m.lastName}` : ''
})

const linkedMemberTeamsLabel = computed(() => {
  const teams = linkedMemberTeams.value
  if (teams.length === 0) return 'Aucune équipe assignée'
  return teams.map((t) => t.name).join(' · ')
})

const officialLicenseLabel = computed(() => {
  const lic = linkedMember.value?.officialLicense
  if (!lic) return null
  return `Officiel niveau ${lic.level} actif`
})

/**
 * Label FR par rôle. Pour `official` on enrichit avec le niveau quand il
 * est connu (ex. "Officiel niveau 2"). Les chips restent read-only.
 */
function roleLabel(role: AppRole): string {
  switch (role) {
    case 'admin':
      return 'Admin'
    case 'coach':
      return 'Coach'
    case 'official': {
      const lvl = auth.officialLevel
      return lvl != null ? `Officiel niveau ${lvl}` : 'Officiel'
    }
  }
}

// ───────────────────────────────────────────────────────────────
// Préférence notifications push (mock — pas de persistance)
// ───────────────────────────────────────────────────────────────

const pushEnabled = ref(true)

function onTestNotification(): void {
  // Phase 5 wiring TBD — déclenchera une notif test via FCM côté serveur.
  logMockAction('c5.test-notif')
}

// ───────────────────────────────────────────────────────────────
// Sign-out
// ───────────────────────────────────────────────────────────────

async function onSignOut(): Promise<void> {
  // `auth.signOut()` appelle Firebase `signOut()` — async. On attend la
  // résolution avant de naviguer, sinon le router beforeEach voit encore
  // `authSnap !== null` et bypass le redirect vers sign-in.
  logMockAction('c5.signout')
  try {
    await auth.signOut()
  } catch (err) {
    console.error('[ProfileSettings] signOut failed', err)
  }
  await router.push({ name: 'sign-in' })
}

// ───────────────────────────────────────────────────────────────
// Sub-role label pour la sidebar desktop (ex. "Coach · Officiel · Admin")
// ───────────────────────────────────────────────────────────────

const userRoleLabel = computed(() => roles.value.map(roleLabel).join(' · '))

// ───────────────────────────────────────────────────────────────
// Tab bar + nav — on prend la variante coach par défaut (cf. Home.vue).
// Le profile est ouvert depuis le header (cloche/avatar) — il n'a pas de
// tab dédié dans la barre du bas, on laisse l'indicateur sur l'item le plus
// pertinent du rôle du user (Coach = "Équipes").
// ───────────────────────────────────────────────────────────────

const tabsCoach: CbTab[] = [
  { icon: Users, label: 'Équipes' },
  { icon: Calendar, label: 'Planning' },
  { icon: Clipboard, label: 'Inscriptions', badge: 3 },
  { icon: Bell, label: 'Notifs', badge: 2 },
]

const tabsOfficial: CbTab[] = [
  { icon: BellRing, label: 'À pourvoir' },
  { icon: Calendar, label: 'Mes matchs' },
  { icon: Bell, label: 'Notifs', badge: 1 },
]

const tabsAdmin: CbTab[] = [
  { icon: BellRing, label: 'Staffing' },
  { icon: Clipboard, label: 'Demandes', badge: 5 },
  { icon: Bell, label: 'Notifs' },
]

/**
 * Tab bar à rendre selon le rôle primaire (coach > official > admin),
 * miroir de la priorité utilisée par le store auth pour la home.
 */
const activeTabs = computed<CbTab[]>(() => {
  if (auth.isCoach) return tabsCoach
  if (auth.isOfficial) return tabsOfficial
  return tabsAdmin
})

const navCoach: CbNavItem[] = [
  { icon: Users, label: 'Mes équipes' },
  { icon: Calendar, label: 'Planning' },
  { icon: Clipboard, label: 'Inscriptions', badge: 3 },
  { icon: Bell, label: 'Notifications', badge: 2 },
]

const navOfficial: CbNavItem[] = [
  { icon: BellRing, label: 'Matchs à pourvoir' },
  { icon: Calendar, label: 'Mes assignations' },
  { icon: Bell, label: 'Notifications', badge: 1 },
]

const navAdmin: CbNavItem[] = [
  { icon: BellRing, label: 'Staffing' },
  { icon: Clipboard, label: 'Demandes', badge: 5 },
  { icon: Bell, label: 'Notifications' },
]

const activeNav = computed<CbNavItem[]>(() => {
  if (auth.isCoach) return navCoach
  if (auth.isOfficial) return navOfficial
  return navAdmin
})

// ───────────────────────────────────────────────────────────────
// Handlers tab bar / nav (re-routent vers les pages correspondantes)
// ───────────────────────────────────────────────────────────────

function onMobileTab(i: number): void {
  if (auth.isCoach) {
    if (i === 0) router.push({ name: 'team' })
    else if (i === 3) router.push({ name: 'notifications' })
    return
  }
  if (auth.isOfficial) {
    if (i === 0) router.push({ name: 'matches-open' })
    else if (i === 1) router.push({ name: 'my-assignments' })
    else if (i === 2) router.push({ name: 'notifications' })
    return
  }
  // admin
  if (i === 0) router.push({ name: 'staffing' })
  else if (i === 1) router.push({ name: 'requests' })
  else if (i === 2) router.push({ name: 'notifications' })
}

function onDesktopNav(i: number): void {
  if (auth.isCoach) {
    if (i === 0) router.push({ name: 'team' })
    else if (i === 3) router.push({ name: 'notifications' })
    return
  }
  if (auth.isOfficial) {
    if (i === 0) router.push({ name: 'matches-open' })
    else if (i === 1) router.push({ name: 'my-assignments' })
    else if (i === 2) router.push({ name: 'notifications' })
    return
  }
  if (i === 0) router.push({ name: 'staffing' })
  else if (i === 1) router.push({ name: 'requests' })
  else if (i === 2) router.push({ name: 'notifications' })
}

function onBack(): void {
  // Retour intelligent : si l'historique a une entrée précédente on l'utilise,
  // sinon fallback sur la home.
  if (window.history.length > 1) router.back()
  else router.push({ name: 'home' })
}

function goNotifications(): void {
  router.push({ name: 'notifications' })
}

// ───────────────────────────────────────────────────────────────
// Action "Modifier mes infos" — placeholder. À terme la même vue
// ProfileSetup sera réutilisée en mode "edit".
// ───────────────────────────────────────────────────────────────

function onEditProfile(): void {
  logMockAction('c5.editProfile')
  router.push({ name: 'profile-setup' })
}
</script>

<template>
  <!-- ─── Mobile shell ──────────────────────────────────────────── -->
  <CbMobileShell
    v-if="!isDesktop"
    title="Mon profil"
    club="BCA"
    show-back
    notif-badge
    :tabs="activeTabs"
    :active-tab="-1"
    @back="onBack"
    @notif-click="goNotifications"
    @tab-select="onMobileTab"
  >
    <div class="cb-page profile-page">
      <!-- ─── Card user ──────────────────────────────────────── -->
      <article class="cb-card profile-user-card">
        <div class="profile-user-head">
          <CbAvatar :name="displayName" size="lg" tone="emerald" />
          <div class="profile-user-meta">
            <div class="cb-h2 profile-name">{{ displayName }}</div>
            <button
              type="button"
              class="cb-btn ghost sm profile-edit-btn"
              @click="onEditProfile"
            >
              Modifier
            </button>
          </div>
        </div>

        <div class="cb-div profile-divider" />

        <ul class="profile-contact">
          <li>
            <Mail :size="16" />
            <span class="profile-contact-value">{{ email }}</span>
          </li>
          <li>
            <Phone :size="16" />
            <span class="profile-contact-value">{{ phone }}</span>
          </li>
          <li>
            <MapPin :size="16" />
            <span class="profile-contact-value">{{ address }}</span>
          </li>
        </ul>
      </article>

      <!-- ─── Section "Rôles" ────────────────────────────────── -->
      <div class="cb-section-label profile-section-label">Rôles</div>
      <div class="profile-roles">
        <CbPill v-for="r in roles" :key="r" tone="violet">
          {{ roleLabel(r) }}
        </CbPill>
      </div>

      <!-- ─── Section "Membre lié" ──────────────────────────── -->
      <template v-if="linkedMember">
        <div class="cb-section-label profile-section-label">Membre lié</div>
        <article class="cb-card profile-linked-card">
          <div class="profile-linked-head">
            <CbAvatar
              :name="linkedMemberFullName"
              :tone="linkedMember.avatarTone ?? 'emerald'"
            />
            <div class="profile-linked-meta">
              <div class="profile-linked-name">{{ linkedMemberFullName }}</div>
              <div class="cb-sub profile-linked-teams">{{ linkedMemberTeamsLabel }}</div>
            </div>
            <CbPill tone="emerald" dot>Actif</CbPill>
          </div>

          <div v-if="officialLicenseLabel" class="profile-linked-license">
            <CbPill tone="emerald" dot>{{ officialLicenseLabel }}</CbPill>
          </div>
          <div v-else class="profile-linked-license">
            <CbPill tone="slate">Pas de licence officiel</CbPill>
          </div>

          <p class="cb-sub profile-linked-hint">
            Ces informations sont gérées par l'administration du club.
            Contactez votre admin pour toute modification.
          </p>
        </article>
      </template>

      <!-- ─── Section "Préférences notifications" ────────────── -->
      <div class="cb-section-label profile-section-label">
        Préférences notifications
      </div>
      <div class="cb-card profile-prefs-card">
        <div class="profile-pref-row">
          <div class="profile-pref-text">
            <div class="profile-pref-title">Notifications push</div>
            <div class="cb-sub">Recevez les rappels match et les urgences.</div>
          </div>
          <ToggleSwitch v-model="pushEnabled" aria-label="Activer les notifications push" />
        </div>

        <div class="cb-div" />

        <button
          type="button"
          class="profile-test-btn"
          @click="onTestNotification"
        >
          <Send :size="16" />
          <span>Tester une notification</span>
          <ChevronRight :size="16" class="profile-test-chev" />
        </button>
      </div>

      <!-- ─── Bouton déconnexion (rose) ──────────────────────── -->
      <button type="button" class="cb-btn ghost block profile-signout" @click="onSignOut">
        <LogOut :size="16" />
        <span>Se déconnecter</span>
      </button>
    </div>
  </CbMobileShell>

  <!-- ─── Desktop shell ─────────────────────────────────────────── -->
  <CbDesktopShell
    v-else
    :items="activeNav"
    :active="-1"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    :user-name="displayName"
    :user-role="userRoleLabel"
    @nav-select="onDesktopNav"
  >
    <CbPageHead title="Mon profil" subtitle="Vos informations personnelles et vos préférences." />

    <div class="profile-desktop">
      <div class="profile-desktop-grid">
        <!-- Colonne 1 : card user -->
        <article class="cb-card profile-user-card desktop">
          <div class="profile-user-head desktop">
            <CbAvatar :name="displayName" size="lg" tone="emerald" />
            <div class="profile-user-meta">
              <div class="cb-h2 profile-name">{{ displayName }}</div>
              <div class="cb-sub">{{ userRoleLabel }}</div>
            </div>
          </div>

          <div class="cb-div profile-divider" />

          <ul class="profile-contact">
            <li>
              <Mail :size="16" />
              <span class="profile-contact-value">{{ email }}</span>
            </li>
            <li>
              <Phone :size="16" />
              <span class="profile-contact-value">{{ phone }}</span>
            </li>
            <li>
              <MapPin :size="16" />
              <span class="profile-contact-value">{{ address }}</span>
            </li>
          </ul>

          <button
            type="button"
            class="cb-btn outline block profile-edit-btn desktop"
            @click="onEditProfile"
          >
            Modifier mes infos
          </button>
        </article>

        <!-- Colonne 2 : sections paramètres -->
        <div class="profile-desktop-right">
          <!-- Rôles -->
          <section>
            <div class="cb-section-label profile-section-label desktop">Rôles</div>
            <div class="profile-roles">
              <CbPill v-for="r in roles" :key="r" tone="violet">
                {{ roleLabel(r) }}
              </CbPill>
            </div>
          </section>

          <!-- Membre lié -->
          <section v-if="linkedMember">
            <div class="cb-section-label profile-section-label desktop">Membre lié</div>
            <article class="cb-card profile-linked-card">
              <div class="profile-linked-head">
                <CbAvatar
                  :name="linkedMemberFullName"
                  :tone="linkedMember.avatarTone ?? 'emerald'"
                />
                <div class="profile-linked-meta">
                  <div class="profile-linked-name">{{ linkedMemberFullName }}</div>
                  <div class="cb-sub profile-linked-teams">{{ linkedMemberTeamsLabel }}</div>
                </div>
                <CbPill tone="emerald" dot>Actif</CbPill>
              </div>

              <div v-if="officialLicenseLabel" class="profile-linked-license">
                <CbPill tone="emerald" dot>{{ officialLicenseLabel }}</CbPill>
              </div>
              <div v-else class="profile-linked-license">
                <CbPill tone="slate">Pas de licence officiel</CbPill>
              </div>

              <p class="cb-sub profile-linked-hint">
                Ces informations sont gérées par l'administration du club.
                Contactez votre admin pour toute modification.
              </p>
            </article>
          </section>

          <!-- Préférences notifications -->
          <section>
            <div class="cb-section-label profile-section-label desktop">
              Préférences notifications
            </div>
            <div class="cb-card profile-prefs-card">
              <div class="profile-pref-row">
                <div class="profile-pref-text">
                  <div class="profile-pref-title">Notifications push</div>
                  <div class="cb-sub">Recevez les rappels match et les urgences.</div>
                </div>
                <ToggleSwitch v-model="pushEnabled" aria-label="Activer les notifications push" />
              </div>

              <div class="cb-div" />

              <button
                type="button"
                class="profile-test-btn"
                @click="onTestNotification"
              >
                <Send :size="16" />
                <span>Tester une notification</span>
                <ChevronRight :size="16" class="profile-test-chev" />
              </button>
            </div>
          </section>

          <!-- Sign-out -->
          <section>
            <button
              type="button"
              class="cb-btn ghost profile-signout desktop"
              @click="onSignOut"
            >
              <LogOut :size="16" />
              <span>Se déconnecter</span>
            </button>
          </section>
        </div>
      </div>
    </div>
  </CbDesktopShell>
</template>

<style scoped>
/* ─── Layout mobile ─────────────────────────────────────────── */
.profile-page { gap: 10px; }
.profile-section-label { padding: 14px 0 6px; }

/* ─── Card user ─────────────────────────────────────────────── */
.profile-user-card { padding: 16px; }
.profile-user-head {
  display: flex;
  align-items: center;
  gap: 14px;
}
.profile-user-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.profile-name {
  font-size: 18px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.profile-edit-btn {
  flex-shrink: 0;
  color: var(--emerald-700);
}
.profile-divider {
  margin: 14px 0;
}
.profile-contact {
  display: flex;
  flex-direction: column;
  gap: 8px;
  list-style: none;
  padding: 0;
  margin: 0;
}
.profile-contact li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text);
}
.profile-contact li > svg {
  color: var(--text-subtle);
  flex-shrink: 0;
}
.profile-contact-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ─── Rôles ─────────────────────────────────────────────────── */
.profile-roles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* ─── Card membre lié ───────────────────────────────────────── */
.profile-linked-card {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.profile-linked-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.profile-linked-meta {
  flex: 1;
  min-width: 0;
}
.profile-linked-name {
  font-weight: 600;
  font-size: 14px;
}
.profile-linked-teams {
  margin-top: 2px;
}
.profile-linked-license {
  display: flex;
}
.profile-linked-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

/* ─── Card préférences notifications ───────────────────────── */
.profile-prefs-card {
  padding: 0;
  overflow: hidden;
}
.profile-pref-row {
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.profile-pref-text {
  flex: 1;
  min-width: 0;
}
.profile-pref-title {
  font-weight: 600;
  font-size: 14px;
}
.profile-test-btn {
  width: 100%;
  padding: 14px 16px;
  border: 0;
  background: transparent;
  font: inherit;
  color: var(--emerald-700);
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
}
.profile-test-btn:hover {
  background: var(--slate-50);
}
.profile-test-btn > span {
  flex: 1;
}
.profile-test-chev {
  color: var(--slate-400);
}

/* ─── Sign-out ──────────────────────────────────────────────── */
.profile-signout {
  margin-top: 14px;
  color: var(--rose-600);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.profile-signout:hover {
  background: var(--rose-50);
  color: var(--rose-700);
}

/* ─── Desktop layout ────────────────────────────────────────── */
.profile-desktop {
  flex: 1;
  overflow: auto;
  padding: 24px 28px 32px;
  background: var(--bg-muted);
}
.profile-desktop-grid {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 24px;
  align-items: start;
  max-width: 1024px;
}
.profile-desktop-right {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.profile-user-card.desktop {
  padding: 24px;
  position: sticky;
  top: 24px;
}
.profile-user-head.desktop {
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
}
.profile-user-head.desktop .profile-user-meta {
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 4px;
  width: 100%;
}
.profile-edit-btn.desktop {
  margin-top: 16px;
}
.profile-section-label.desktop {
  padding: 0 0 8px;
}
.profile-signout.desktop {
  align-self: flex-start;
  padding: 8px 14px;
}

/* ─── Responsive fine-tune ──────────────────────────────────── */
@media (max-width: 1180px) {
  .profile-desktop-grid {
    grid-template-columns: 1fr;
  }
  .profile-user-card.desktop {
    position: static;
  }
}
</style>
