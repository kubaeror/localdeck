import '@cloudscape-design/global-styles/index.css';
import { applyMode, Mode } from '@cloudscape-design/global-styles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ConsoleErrorBoundary } from './components/ConsoleErrorBoundary';
import './styles/app.css';

applyMode(Mode.Light);

const container = document.getElementById('root');
if (container === null) {
  throw new Error('LocalDeck could not start: #root is missing from index.html');
}

/**
 * VITE_BASE_PATH mounts the console under a subpath (for example
 * `/localdeck/`): Vite builds asset URLs from it and the router strips it from
 * every route. The default `/` keeps the previous origin-root behavior.
 */
const basePath = import.meta.env.VITE_BASE_PATH ?? '/';
const basename =
  basePath === '/' || basePath.length === 0 ? undefined : basePath.replace(/\/+$/, '');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter {...(basename === undefined ? {} : { basename })}>
      {/* Top-level boundary: catches provider errors inside App too. */}
      <ConsoleErrorBoundary scope="app">
        <App />
      </ConsoleErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
