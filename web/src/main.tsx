import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ToastProvider } from './components/Toast';
import './index.css';
import { ApiError } from './lib/api';
import { initServiceWorker } from './pwa/sw-bridge';

initServiceWorker();

/** Any 401 from a query/mutation ends the session and shows the login screen. */
function Root() {
  return (
    <AuthBridge>
      <App />
    </AuthBridge>
  );
}

let onAuthError: (e: unknown) => void = () => undefined;
function AuthBridge({ children }: { children: React.ReactNode }) {
  const { handleAuthError } = useAuth();
  useMemo(() => {
    onAuthError = handleAuthError;
  }, [handleAuthError]);
  return <>{children}</>;
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (e) => onAuthError(e) }),
  mutationCache: new MutationCache({ onError: (e) => onAuthError(e) }),
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      // Retry network/server errors briefly, never client errors (4xx).
      retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <Root />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
