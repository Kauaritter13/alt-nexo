import * as React from 'react';

export type Route = { name: 'dashboard' } | { name: 'project'; projectId: string; workspaceId?: string };

function parse(): Route {
  const m = location.hash.match(/^#\/p\/([^/]+)(?:\/w\/([^/]+))?/);
  if (m) return { name: 'project', projectId: m[1], workspaceId: m[2] };
  return { name: 'dashboard' };
}

export function useRoute(): Route {
  const [route, setRoute] = React.useState(parse);
  React.useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const navigate = {
  dashboard: () => (location.hash = '#/'),
  project: (projectId: string, workspaceId?: string) => (location.hash = `#/p/${projectId}${workspaceId ? `/w/${workspaceId}` : ''}`),
  replaceProject: (projectId: string, workspaceId: string) => history.replaceState(null, '', `#/p/${projectId}/w/${workspaceId}`),
};
