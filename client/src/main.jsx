import { StrictMode }         from 'react';
import { createRoot }         from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GoogleOAuthProvider }              from '@react-oauth/google';
import { AuthProvider }                     from './context/AuthContext';
import App                                  from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry:              1,
      staleTime:          30_000,   // 30s — avoids over-fetching on tab focus
      refetchOnWindowFocus: false,  // accounting data doesn't need live updates
    },
  },
});

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/*
      Wrapping order:
        QueryClientProvider — server state for all API calls
        GoogleOAuthProvider — Google OAuth context
        AuthProvider        — JWT + user state
        App                 — routes + pages
    */}
    <QueryClientProvider client={queryClient}>
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </GoogleOAuthProvider>
    </QueryClientProvider>
  </StrictMode>
);
