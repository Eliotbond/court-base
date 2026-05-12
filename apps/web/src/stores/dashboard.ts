import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
  fetchActivityFeed,
  fetchDashboardAlerts,
  fetchDuesBreakdown,
  fetchOfficialsProfitability,
  fetchThisWeekBookings,
  type ActivityFeedEntry,
  type DashboardAlerts,
  type DuesBreakdown,
  type OfficialsProfitability,
  type WeekBookingRow,
} from '@/repositories/dashboard.repo'

/**
 * Source unique des données affichées sur le Dashboard.
 *
 * `load()` batche les 5 appels repo en parallèle et expose `loading` + `error`
 * pour que la vue reste passive (composants = pas de logique métier).
 *
 * Voir docs/frontend-desktop.md (architecture en couches) et CLAUDE.md
 * (`apps/web`) : les vues consomment ce store via le pattern Pinia, jamais
 * directement les repos.
 */
export const useDashboardStore = defineStore('dashboard', () => {
  const alerts = ref<DashboardAlerts | null>(null)
  const weekBookings = ref<WeekBookingRow[]>([])
  const officialsProfitability = ref<OfficialsProfitability | null>(null)
  const duesBreakdown = ref<DuesBreakdown | null>(null)
  const activityFeed = ref<ActivityFeedEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const [alertsResult, bookings, profitability, dues, activity] = await Promise.all([
        fetchDashboardAlerts(),
        fetchThisWeekBookings(),
        fetchOfficialsProfitability(),
        fetchDuesBreakdown(),
        fetchActivityFeed(),
      ])
      alerts.value = alertsResult
      weekBookings.value = bookings
      officialsProfitability.value = profitability
      duesBreakdown.value = dues
      activityFeed.value = activity
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur de chargement du dashboard'
    } finally {
      loading.value = false
    }
  }

  return {
    alerts,
    weekBookings,
    officialsProfitability,
    duesBreakdown,
    activityFeed,
    loading,
    error,
    load,
  }
})
