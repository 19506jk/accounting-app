import { StrictMode }         from 'react';
import { createRoot }         from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GoogleOAuthProvider }              from '@react-oauth/google';
import { AuthProvider }                     from './context/AuthContext';
import { DateProvider }                     from './context/DateContext';
import { ToastProvider }                    from './components/ui/Toast';
import App                                  from './App';
import './global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry:               1,
      staleTime:           30_000,
      refetchOnWindowFocus: false,
    },
  },
});

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const rootElement = document.getElementById('root');

if (!rootElement) throw new Error('Root element not found');

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <AuthProvider>
          <DateProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </DateProvider>
        </AuthProvider>
      </GoogleOAuthProvider>
    </QueryClientProvider>
  </StrictMode>
);
