import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { TerminalProvider } from './context/TerminalContext';
import { ErrorBoundary } from './components/ErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <TerminalProvider>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </TerminalProvider>
);
