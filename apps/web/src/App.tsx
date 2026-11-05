import * as React from 'react';
import { Toaster } from 'sonner';
import { useApp } from '@/stores/app';
import { useRoute } from '@/lib/router';
import { useTheme } from '@/lib/theme';
import { TooltipProvider } from '@/components/ui';
import { Dashboard } from '@/pages/Dashboard';
import { WorkspaceView } from '@/pages/WorkspaceView';
import { Connect } from '@/pages/Connect';
import { SettingsDialog } from '@/components/SettingsDialog';
import { TabBar } from '@/components/TabBar';

export function App() {
  const auth = useApp((s) => s.auth);
  const route = useRoute();
  const { theme } = useTheme();
  React.useEffect(() => {
    void useApp.getState().boot();
  }, []);

  return (
    <TooltipProvider>
      {auth !== 'ready' ? (
        <Connect />
      ) : (
        <div className="flex h-full flex-col">
          <TabBar route={route} />
          <div className="min-h-0 flex-1">
            {route.name === 'project' ? <WorkspaceView key={route.projectId} projectId={route.projectId} workspaceId={route.workspaceId} /> : <Dashboard />}
          </div>
        </div>
      )}
      {auth === 'ready' && <SettingsDialog />}
      <Toaster theme={theme} position="bottom-right" toastOptions={{ className: '!bg-popover !border-border !text-[12.5px]' }} />
    </TooltipProvider>
  );
}
