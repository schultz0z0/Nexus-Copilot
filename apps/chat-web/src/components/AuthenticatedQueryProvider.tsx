import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';

function IdentityQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  useEffect(() => () => {
    void queryClient.cancelQueries();
    queryClient.clear();
  }, [queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function AuthenticatedQueryProvider({ identity, children }: {
  identity: string | null;
  children: ReactNode;
}) {
  return <IdentityQueryProvider key={identity ?? '__anonymous__'}>{children}</IdentityQueryProvider>;
}
