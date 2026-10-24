import { QueryClientProvider } from '@tanstack/react-query'

import { queryClient } from '@/api/queries'
import { AppShell } from '@/components/layout/AppShell'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useDashboardState } from '@/hooks/useDashboardState'
import { AccuracyPage } from '@/pages/AccuracyPage'
import { OverviewPage } from '@/pages/OverviewPage'
import { VersionsPage } from '@/pages/VersionsPage'

function Dashboard() {
  const [state, update] = useDashboardState()

  return (
    <AppShell view={state.view} onNavigate={(view) => update({ view })}>
      {state.view === 'overview' && <OverviewPage state={state} onChange={update} />}
      {state.view === 'accuracy' && <AccuracyPage state={state} onChange={update} />}
      {state.view === 'versions' && <VersionsPage state={state} onChange={update} />}
    </AppShell>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <Dashboard />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
