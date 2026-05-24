<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import TabPanels from 'primevue/tabpanels'
import TabPanel from 'primevue/tabpanel'

import LicenseRequestsTab from '@/views/licenses/LicenseRequestsTab.vue'
import LicensesTab from '@/views/licenses/LicensesTab.vue'

/**
 * Page `/licenses` — vue centralisée des licences pour le staff.
 *
 * Deux onglets self-contained (montent leur propre store + repo) :
 *   - `requests` : `/licenseRequests` — workflow demande coach → parent →
 *     coach review → trésorier. Cf. chantier `project_licenses_coach_launch`
 *     (memory) + `docs/licenses/parent-completion-workflow.md`.
 *   - `issued`   : `/licenses` — licences fédérales émises (cf.
 *     `docs/main.md` § Licences).
 *
 * Onglet actif synchronisé avec la query `?tab=requests|issued` pour permettre
 * deep-link + back/forward navigateur sans perdre l'état. Default `requests`
 * (c'est la liste actionnable — les licences émises sont plus consultatives).
 *
 * Pas de filtres top-level ici : chaque onglet gère ses filtres
 * (statut/saison/rôle/recherche) dans son propre store. La page parent reste
 * un shell léger. Pattern emprunté à `Bookings.vue` (planning / list).
 *
 * Routing : accès `treasurer | secretary | admin | rootAdmin` (cf. `router/
 * index.ts`). Coach n'a pas accès — il a sa propre vue dans courtbase-app.
 */

type LicensesTabKey = 'requests' | 'issued'

const route = useRoute()
const router = useRouter()

/** Parse la query `?tab=` au mount (default `requests`). */
function readTabFromQuery(): LicensesTabKey {
  const raw = route.query['tab']
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === 'issued' ? 'issued' : 'requests'
}

const activeTab = ref<LicensesTabKey>(readTabFromQuery())

// Sync query sur changement d'onglet (sans push à l'historique pour éviter la
// pollution back-button).
watch(activeTab, (next) => {
  if (route.query['tab'] === next) return
  void router.replace({ query: { ...route.query, tab: next } })
})

// Sync onglet sur navigation back/forward (le watch ci-dessus seul ne suffit
// pas — il déclenche sur changement d'activeTab, pas de query).
watch(
  () => route.query['tab'],
  (raw) => {
    const value = Array.isArray(raw) ? raw[0] : raw
    const next: LicensesTabKey = value === 'issued' ? 'issued' : 'requests'
    if (next !== activeTab.value) activeTab.value = next
  },
)
</script>

<template>
  <section class="p-6 space-y-4">
    <Tabs v-model:value="activeTab">
      <TabList>
        <Tab value="requests">Demandes en cours</Tab>
        <Tab value="issued">Licences émises</Tab>
      </TabList>
      <TabPanels>
        <TabPanel value="requests">
          <LicenseRequestsTab />
        </TabPanel>
        <TabPanel value="issued">
          <LicensesTab />
        </TabPanel>
      </TabPanels>
    </Tabs>
  </section>
</template>
