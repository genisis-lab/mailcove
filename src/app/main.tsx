import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { App } from './App';
import { TooltipProvider } from './components/ui';
import { registerServiceWorker } from './lib/push';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 10_000 },
    mutations: { retry: 0 },
  },
});

void registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TooltipProvider>
      <Toaster position="bottom-left" richColors closeButton toastOptions={{ className: '!rounded-xl !border !border-border !bg-surface !text-text !shadow-[var(--shadow-lg)]' }} />
    </QueryClientProvider>
  </StrictMode>,
);
