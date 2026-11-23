import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary area="Crate Digger">
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)

