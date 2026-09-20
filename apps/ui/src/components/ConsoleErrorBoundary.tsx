import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ErrorBoundary from '@cloudscape-design/components/error-boundary';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState, type ReactElement, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { CONSOLE_HOME_PATH } from '../services/paths';

export interface ConsoleErrorBoundaryProps {
  children: ReactNode;
  /** Boundary identifier, included in the onError payload and the DOM. */
  scope: string;
}

/**
 * Render-error recovery for the console. Cloudscape renders its fallback in
 * place of the crashed subtree, and the fallback here always offers a way back
 * to Console Home: navigating remounts the boundary, so a page that threw on
 * stale data gets a clean shell instead of a white screen.
 *
 * The boundary around `<App/>` (main.tsx) catches provider errors; the one
 * around `<Routes>` (App.tsx) catches page errors. Both use this component.
 */
export function ConsoleErrorBoundary({ children, scope }: ConsoleErrorBoundaryProps): ReactElement {
  const navigate = useNavigate();
  const [resetKey, setResetKey] = useState(0);
  const [captured, setCaptured] = useState<Error | null>(null);

  const recover = (): void => {
    setCaptured(null);
    setResetKey((previous) => previous + 1);
    void navigate(CONSOLE_HOME_PATH);
  };

  return (
    <ErrorBoundary
      key={resetKey}
      errorBoundaryId={scope}
      suppressNested
      onError={({ error, errorInfo }) => {
        // The console has no telemetry backend; the browser console is the log.
        console.error(`[localdeck] unhandled render error in ${scope}`, error, errorInfo);
        setCaptured(error);
      }}
      i18nStrings={{
        headerText: 'This view crashed',
        descriptionText:
          'An unexpected error stopped this screen from rendering. Nothing was changed in LocalStack.',
        refreshActionText: 'Reload the page',
      }}
      renderFallback={({ header, description }) => (
        <Box margin={{ vertical: 'l' }} padding={{ horizontal: 'l' }}>
          <Container
            header={<Header variant="h2">{header ?? 'This view crashed'}</Header>}
            footer={
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="primary" onClick={recover}>
                  Back to Console Home
                </Button>
                <Button
                  onClick={() => {
                    window.location.reload();
                  }}
                >
                  Reload the page
                </Button>
              </SpaceBetween>
            }
          >
            <SpaceBetween size="s">
              <Box>{description}</Box>
              {captured === null ? null : (
                <Box variant="code" color="text-status-error">
                  {captured.message}
                </Box>
              )}
            </SpaceBetween>
          </Container>
        </Box>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
