<script setup lang="ts">
import {
  AlertTriangle,
  Bell,
  BellRing,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Home,
  Inbox,
  Megaphone,
  MoreVertical,
  Plus,
  Shield,
  Users,
  XCircle,
} from 'lucide-vue-next'

import CbAvatar from '@/components/ui/CbAvatar.vue'
import CbBanner from '@/components/ui/CbBanner.vue'
import CbBottomBar from '@/components/ui/CbBottomBar.vue'
import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbHeader from '@/components/ui/CbHeader.vue'
import CbMatchCard from '@/components/ui/CbMatchCard.vue'
import CbMemberRow from '@/components/ui/CbMemberRow.vue'
import CbNotifItem from '@/components/ui/CbNotifItem.vue'
import CbPill from '@/components/ui/CbPill.vue'
import CbSidebar from '@/components/ui/CbSidebar.vue'
import CbSkel from '@/components/ui/CbSkel.vue'
import CbTabBar, { type CbTab } from '@/components/ui/CbTabBar.vue'
import type { CbNavItem } from '@/components/ui/CbSidebar.vue'

/**
 * Showcase design system — référence visuelle de tous les primitives `Cb*`.
 * Accessible sur `/_design` (route hors auth). À utiliser pour valider le
 * port du bundle claude.design vers Vue + comparer avec les artboards du
 * design canvas.
 */

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
  { icon: Inbox, label: 'Demandes', badge: 5 },
  { icon: Megaphone, label: 'Diffuser' },
  { icon: Bell, label: 'Notifs' },
]

const navCoach: CbNavItem[] = [
  { icon: Home, label: 'Accueil' },
  { icon: Users, label: 'Mes équipes' },
  { icon: Calendar, label: 'Planning' },
  { icon: Clipboard, label: 'Inscriptions', badge: 3 },
  { icon: Bell, label: 'Notifications', badge: 2 },
]
const navAdmin: CbNavItem[] = [
  { icon: Home, label: 'Accueil' },
  { icon: BellRing, label: 'Staffing' },
  { icon: Inbox, label: 'Demandes', badge: 5 },
  { icon: Megaphone, label: 'Diffuser' },
  { icon: Bell, label: 'Notifications' },
]
</script>

<template>
  <div class="ds-canvas">
    <header class="ds-header">
      <h1 class="cb-h1">Design system — courtbase-app</h1>
      <p class="cb-sub">
        Référence visuelle des primitives portés depuis le bundle claude.design.
        Cf. <code>docs/courtbase-app.md</code> + <code>docs/design-brief-courtbase-app.md</code>.
      </p>
    </header>

    <!-- ─── 1. Color tokens ─────────────────────────────────────── -->
    <section>
      <h2 class="ds-h">1. Couleurs sémantiques</h2>
      <div class="ds-colors">
        <div v-for="tone in ['emerald', 'amber', 'rose', 'sky', 'violet', 'slate']" :key="tone">
          <div class="ds-swatch" :style="`background: var(--${tone}-500)`" />
          <div class="ds-swatch-label">{{ tone }}</div>
        </div>
      </div>
    </section>

    <!-- ─── 2. Status pills ─────────────────────────────────────── -->
    <section>
      <h2 class="ds-h">2. Pills (S4)</h2>
      <div class="ds-stack">
        <CbPill tone="emerald" dot>Confirmé</CbPill>
        <CbPill tone="amber" dot>À pourvoir 2/3</CbPill>
        <CbPill tone="rose">Exclu</CbPill>
        <CbPill tone="sky">Info</CbPill>
        <CbPill tone="violet">Admin</CbPill>
        <CbPill tone="slate">Inactif</CbPill>
        <CbPill tone="emerald" solid>Payé</CbPill>
        <CbPill tone="rose" solid>Urgent</CbPill>
      </div>
    </section>

    <!-- ─── 3. Avatars ──────────────────────────────────────────── -->
    <section>
      <h2 class="ds-h">3. Avatars</h2>
      <div class="ds-stack" style="align-items: center">
        <CbAvatar name="Mathieu Brun" size="xs" />
        <CbAvatar name="Mathieu Brun" size="sm" />
        <CbAvatar name="Mathieu Brun" />
        <CbAvatar name="Mathieu Brun" size="lg" />
        <CbAvatar name="Sarah Dupont" tone="emerald" />
        <CbAvatar name="Léo Martin" tone="violet" />
        <CbAvatar name="Inès Vidal" tone="amber" />
      </div>
    </section>

    <!-- ─── 4. Buttons ──────────────────────────────────────────── -->
    <section>
      <h2 class="ds-h">4. Buttons</h2>
      <div class="ds-stack">
        <button class="cb-btn primary">Primary</button>
        <button class="cb-btn secondary">Secondary</button>
        <button class="cb-btn outline">Outline</button>
        <button class="cb-btn ghost">Ghost</button>
        <button class="cb-btn danger">Danger</button>
        <button class="cb-btn danger outline">Refuser</button>
        <button class="cb-btn primary sm">Small</button>
        <button class="cb-btn primary lg">Large</button>
        <button class="cb-btn primary" disabled>Disabled</button>
      </div>
    </section>

    <!-- ─── 5. Banners ──────────────────────────────────────────── -->
    <section>
      <h2 class="ds-h">5. Banners</h2>
      <div style="display: flex; flex-direction: column; gap: 0; max-width: 480px">
        <CbBanner tone="amber" title="Licence officiel manquante">
          <template #icon><AlertTriangle :size="18" /></template>
          Vous n'avez pas de licence officiel active — l'auto-inscription est bloquée.
        </CbBanner>
        <CbBanner tone="sky">
          <template #icon><Bell :size="18" /></template>
          Trois entraînements seront libérés automatiquement à la création de ce match.
        </CbBanner>
        <CbBanner tone="rose" title="Action requise">
          <template #icon><AlertTriangle :size="18" /></template>
          Deux inscriptions attendent votre décision depuis plus de 7 jours.
        </CbBanner>
        <CbBanner tone="emerald">
          <template #icon><CheckCircle2 :size="18" /></template>
          Toutes les assignations de la semaine sont confirmées.
        </CbBanner>
      </div>
    </section>

    <!-- ─── 6. Empty state ──────────────────────────────────────── -->
    <section>
      <h2 class="ds-h">6. Empty state (S7)</h2>
      <div class="cb-card" style="max-width: 380px; padding: 0">
        <CbEmptyState
          :icon="Inbox"
          title="Aucune assignation"
          body="Vous n'avez pas encore d'assignation officiel. Allez voir les matchs à pourvoir pour vous inscrire."
        >
          <template #actions>
            <button class="cb-btn primary sm">
              <Plus :size="16" /> Voir les matchs
            </button>
          </template>
        </CbEmptyState>
      </div>
    </section>

    <!-- ─── 7. Member row + Match card ──────────────────────────── -->
    <section>
      <h2 class="ds-h">7. Member rows (S5)</h2>
      <div class="cb-card flush" style="max-width: 420px">
        <CbMemberRow name="Sarah Dupont" sub="U16F · née 2009 · #4501">
          <template #pills>
            <CbPill tone="emerald" dot>Payée</CbPill>
            <CbPill tone="emerald">Licenciée</CbPill>
          </template>
        </CbMemberRow>
        <CbMemberRow name="Léo Martin" sub="U16M · né 2008" avatar-tone="amber">
          <template #pills>
            <CbPill tone="amber">Cotisation pending</CbPill>
          </template>
        </CbMemberRow>
        <CbMemberRow name="Inès Vidal" sub="U16F · née 2009 · #4612" faded>
          <template #pills>
            <CbPill tone="rose" dot>Exclue</CbPill>
            <CbPill tone="slate">Non licenciée</CbPill>
          </template>
        </CbMemberRow>
        <CbMemberRow name="Tom Riedo" sub="U16M · né 2008">
          <template #pills>
            <CbPill tone="violet">Exception pending</CbPill>
          </template>
        </CbMemberRow>
      </div>
    </section>

    <section>
      <h2 class="ds-h">8. Match cards (S6)</h2>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; max-width: 900px">
        <CbMatchCard
          date="Sa 18 oct."
          time="14:30"
          type="CSJC"
          opponent="Pully BC U16M"
          venue="Centre sportif · Court A"
          :staffing="{ filled: 2, total: 3 }"
          :officials="['MB', 'SD']"
        />
        <CbMatchCard
          date="Di 19 oct."
          time="11:00"
          type="AFBB"
          opponent="Yverdon Basket U14F"
          venue="Salle des écoles · Court 1"
          :staffing="{ filled: 3, total: 3, complete: true }"
          :officials="['MB', 'SD', 'LV']"
        />
        <CbMatchCard
          date="Sa 25 oct."
          time="18:00"
          type="Amical"
          opponent="Lausanne Devils U18M"
          venue="Pully · Vieux-Moulin"
          away
        />
      </div>
    </section>

    <!-- ─── 9. Notif items ──────────────────────────────────────── -->
    <section>
      <h2 class="ds-h">9. Notif items (S10)</h2>
      <div class="cb-card flush" style="max-width: 460px">
        <CbNotifItem
          unread
          type="urgent"
          title="Match annulé"
          extract="Le match U16M vs Pully BC du Sa 18 oct. est annulé. Plus de détails dans l'app."
          time="il y a 12 minutes"
        />
        <CbNotifItem
          unread
          type="officials_needed"
          title="Officiel manquant"
          extract="U14F vs Yverdon — il manque encore 1 officiel niveau 2 pour ce dimanche."
          time="il y a 2 h"
        />
        <CbNotifItem
          type="match"
          title="Nouveau match programmé"
          extract="U16M vs Lausanne Devils — Sa 25 oct., 18:00, Pully Vieux-Moulin."
          time="hier"
        />
        <CbNotifItem
          type="check"
          title="Assignation confirmée"
          extract="Vous êtes confirmé pour le match U16M vs Pully BC du Sa 18 oct."
          time="il y a 3 jours"
        />
      </div>
    </section>

    <!-- ─── 10. Skeletons ───────────────────────────────────────── -->
    <section>
      <h2 class="ds-h">10. Skeletons</h2>
      <div class="cb-card flush" style="max-width: 380px">
        <div style="display: flex; gap: 12px; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--border)">
          <CbSkel w="36px" :h="36" style="border-radius: 18px" />
          <div style="flex: 1; display: flex; flex-direction: column; gap: 8px">
            <CbSkel w="60%" :h="11" />
            <CbSkel w="40%" :h="9" />
          </div>
        </div>
        <div style="display: flex; gap: 12px; align-items: center; padding: 14px 16px">
          <CbSkel w="36px" :h="36" style="border-radius: 18px" />
          <div style="flex: 1; display: flex; flex-direction: column; gap: 8px">
            <CbSkel w="70%" :h="11" />
            <CbSkel w="45%" :h="9" />
          </div>
        </div>
      </div>
    </section>

    <!-- ─── 11. Shell — mobile + desktop ────────────────────────── -->
    <section>
      <h2 class="ds-h">11. Shells (S1 + S2)</h2>
      <p class="cb-sub" style="margin-bottom: 14px">
        Mobile (header + tab bar) à gauche, desktop (sidebar + main) à droite.
        Les artboards reproduisent l'aspect des prévisualisations du design canvas.
      </p>

      <div style="display: grid; grid-template-columns: 375px 1fr; gap: 24px; align-items: flex-start">
        <!-- Mobile frame -->
        <div class="ds-mobile-frame">
          <CbHeader title="Mes équipes" club="BCA" notif-badge />
          <div class="cb-mobile-body" style="height: 460px; overflow: hidden">
            <div class="cb-page">
              <div class="cb-card">
                <div class="cb-h3">U16M Compétition</div>
                <div class="cb-sub" style="margin-top: 4px">12 joueurs · prochain training mardi 18:00</div>
                <div style="margin-top: 10px; display: flex; gap: 6px">
                  <CbPill tone="emerald" dot>Licence active</CbPill>
                  <CbPill tone="amber">2 exclus</CbPill>
                </div>
              </div>
              <div class="cb-card">
                <div class="cb-h3">U14F Loisir</div>
                <div class="cb-sub" style="margin-top: 4px">8 joueuses · prochain training mercredi 17:00</div>
              </div>
            </div>
          </div>
          <CbTabBar :tabs="tabsCoach" :active="0" />
        </div>

        <!-- Desktop frame -->
        <div class="ds-desktop-frame">
          <CbDesktopShell
            :items="navCoach"
            :active="1"
            brand-name="BC Aigles"
            brand-sub="Saison 2025/26"
            club-initials="BCA"
            user-name="Mathieu Brun"
            user-role="Coach · Officiel"
          >
            <header style="padding: 20px 28px; display: flex; align-items: center; justify-content: space-between; gap: 16px; background: var(--bg); border-bottom: 1px solid var(--border)">
              <div>
                <h1 class="cb-h1" style="font-size: 22px">Mes équipes</h1>
                <div class="cb-sub" style="margin-top: 2px">2 équipes coachées · saison 2025/26</div>
              </div>
              <button class="cb-btn primary"><Plus :size="16" /> Nouvelle équipe</button>
            </header>
            <div style="padding: 24px 28px; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px">
              <div class="cb-card">
                <div class="cb-h3">U16M Compétition</div>
                <div class="cb-sub" style="margin-top: 4px">12 joueurs · prochain training mardi 18:00</div>
                <div style="margin-top: 12px; display: flex; gap: 6px">
                  <CbPill tone="emerald" dot>Licence active</CbPill>
                  <CbPill tone="amber">2 exclus</CbPill>
                </div>
              </div>
              <div class="cb-card">
                <div class="cb-h3">U14F Loisir</div>
                <div class="cb-sub" style="margin-top: 4px">8 joueuses · prochain training mercredi 17:00</div>
              </div>
            </div>
          </CbDesktopShell>
        </div>
      </div>
    </section>

    <!-- ─── 12. Variantes de tab bars ───────────────────────────── -->
    <section>
      <h2 class="ds-h">12. Tab bars (S3)</h2>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, 375px); gap: 24px">
        <div class="ds-mobile-frame" style="height: auto">
          <div style="padding: 12px 16px; background: var(--slate-50); color: var(--text-subtle); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em">Coach</div>
          <CbTabBar :tabs="tabsCoach" :active="0" />
        </div>
        <div class="ds-mobile-frame" style="height: auto">
          <div style="padding: 12px 16px; background: var(--slate-50); color: var(--text-subtle); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em">Officiel</div>
          <CbTabBar :tabs="tabsOfficial" :active="1" />
        </div>
        <div class="ds-mobile-frame" style="height: auto">
          <div style="padding: 12px 16px; background: var(--slate-50); color: var(--text-subtle); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em">Admin</div>
          <CbTabBar :tabs="tabsAdmin" :active="2" />
        </div>
      </div>
    </section>

    <!-- ─── 13. Bottom bar sticky ───────────────────────────────── -->
    <section>
      <h2 class="ds-h">13. Bottom bar (S8)</h2>
      <div class="ds-mobile-frame" style="height: 200px; position: relative">
        <CbHeader title="Confirmer" show-back />
        <div class="cb-mobile-body" style="padding: 16px">
          <p class="cb-sub">Aperçu du sticky bottom CTA — mobile only.</p>
        </div>
        <CbBottomBar>
          <button class="cb-btn outline" style="flex: 1">Annuler</button>
          <button class="cb-btn primary" style="flex: 1">Confirmer</button>
        </CbBottomBar>
      </div>
    </section>

    <!-- ─── 14. Blocker (S11) ───────────────────────────────────── -->
    <section>
      <h2 class="ds-h">14. Membre inactif blocker (S11)</h2>
      <div class="ds-mobile-frame" style="height: 520px">
        <div style="padding: 80px 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 20px; height: 100%">
          <div style="width: 64px; height: 64px; border-radius: 32px; background: var(--rose-100); color: var(--rose-700); display: flex; align-items: center; justify-content: center">
            <XCircle :size="32" />
          </div>
          <div>
            <h2 class="cb-h1">Votre compte est inactif</h2>
            <p class="cb-sub" style="margin-top: 10px; max-width: 280px">
              Contactez l'administration de votre club ou réinscrivez-vous via le portail.
            </p>
          </div>
          <div style="width: 100%; max-width: 280px; display: flex; flex-direction: column; gap: 8px">
            <button class="cb-btn primary block">Ouvrir le portail</button>
            <button class="cb-btn ghost block">Se déconnecter</button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ds-canvas {
  padding: 32px 24px 80px;
  max-width: 1280px;
  margin: 0 auto;
  background: var(--bg-muted);
  min-height: 100%;
}
.ds-header { margin-bottom: 32px; }
section { margin-bottom: 40px; }
.ds-h {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-subtle);
  margin-bottom: 14px;
}
.ds-stack { display: flex; flex-wrap: wrap; gap: 8px; }
.ds-colors { display: flex; gap: 16px; flex-wrap: wrap; }
.ds-swatch { width: 56px; height: 56px; border-radius: 12px; box-shadow: var(--shadow-sm); }
.ds-swatch-label {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-subtle);
  font-family: var(--font-mono);
  text-align: center;
}
.ds-mobile-frame {
  width: 375px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 24px;
  overflow: hidden;
  box-shadow: var(--shadow-md);
}
.ds-desktop-frame {
  height: 540px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--shadow-md);
}
</style>
