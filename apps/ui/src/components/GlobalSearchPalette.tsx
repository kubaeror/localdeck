import { isServiceEmulated, type ServiceDescriptor } from '@localdeck/shared';
import Box from '@cloudscape-design/components/box';
import Input from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import List from '@cloudscape-design/components/list';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { colorBackgroundItemSelected } from '@cloudscape-design/design-tokens';
import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { GLOBAL_SEARCH_SHORTCUT_LABEL } from '../contexts/global-search-context';
import { useLocalStackStatus } from '../hooks/useLocalStackStatus';
import { useRecentlyVisited } from '../hooks/useRecentlyVisited';
import { useServiceCatalog } from '../hooks/useServiceCatalog';
import { searchServices, type ServiceMatch } from '../lib/serviceSearch';
import { serviceConsolePath } from '../services/paths';
import { ServiceIcon } from './ServiceIcon';

const MAX_RESULTS = 8;
const MAX_SUGGESTIONS = 5;

export interface GlobalSearchPaletteProps {
  onDismiss: () => void;
}

/**
 * Console-wide service search. Mounted with the Ctrl+/ shortcut (or the top
 * navigation search button), it fuzzy matches the whole registry — names, ids,
 * categories, summaries and whitelisted operations — and routes to the
 * service console.
 */
export function GlobalSearchPalette({ onDismiss }: GlobalSearchPaletteProps): ReactElement {
  const navigate = useNavigate();
  const { services } = useServiceCatalog();
  const status = useLocalStackStatus();
  const { visited } = useRecentlyVisited();

  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  const recentlyVisited = useMemo<readonly ServiceMatch[]>(() => {
    const byId = new Map(services.map((service) => [service.id, service]));
    const matches: ServiceMatch[] = [];
    for (const entry of visited) {
      const service = byId.get(entry.id);
      if (service !== undefined) matches.push({ service, score: 0 });
      if (matches.length === MAX_SUGGESTIONS) break;
    }
    return matches;
  }, [services, visited]);

  const isSearching = query.trim().length > 0;
  const matches = useMemo(
    () => (isSearching ? searchServices(query, services, MAX_RESULTS) : recentlyVisited),
    [isSearching, query, services, recentlyVisited],
  );

  // The highlighted row: explicitly chosen, otherwise the first match.
  const activeIndex = Math.max(
    0,
    matches.findIndex((match) => match.service.id === activeId),
  );
  const servicesReported = status.health?.localstack.services ?? {};

  const openService = (service: ServiceDescriptor): void => {
    onDismiss();
    navigate(serviceConsolePath(service.id));
  };

  const moveActive = (offset: number): void => {
    if (matches.length === 0) return;
    const next = matches[Math.min(Math.max(activeIndex + offset, 0), matches.length - 1)];
    if (next === undefined) return;
    setActiveId(next.service.id);
  };

  return (
    <Modal
      visible
      onDismiss={onDismiss}
      size="large"
      closeAriaLabel="Close search"
      header="Search services"
    >
      <SpaceBetween size="m">
        <Input
          type="search"
          autoFocus
          value={query}
          ariaLabel="Search services"
          placeholder="Search by service name, id, category or operation"
          onChange={(event) => {
            setQuery(event.detail.value);
            setActiveId(null);
          }}
          onKeyDown={(event) => {
            switch (event.detail.key) {
              case 'ArrowDown':
                event.preventDefault();
                moveActive(1);
                break;
              case 'ArrowUp':
                event.preventDefault();
                moveActive(-1);
                break;
              case 'Enter': {
                const match = matches[activeIndex];
                if (match === undefined) break;
                event.preventDefault();
                openService(match.service);
                break;
              }
              default:
                break;
            }
          }}
        />

        {matches.length === 0 ? (
          <Box color="text-body-secondary">
            {isSearching
              ? `No service matches “${query.trim()}”. Try a service name, an id like “s3”, a category or an operation.`
              : 'Search the whole LocalDeck registry: try “bucket”, “queue”, “security” or “ListFunctions”.'}
          </Box>
        ) : (
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">{isSearching ? 'Matches' : 'Recently visited'}</Box>
            <List<ServiceMatch>
              ariaLabel="Search results"
              items={matches}
              renderItem={(match) => {
                const emulation = isServiceEmulated(match.service, servicesReported)
                  ? 'emulated locally'
                  : 'not emulated locally';
                return {
                  id: match.service.id,
                  icon: (
                    <ServiceIcon
                      iconKey={match.service.iconKey}
                      category={match.service.category}
                      size="small"
                    />
                  ),
                  content: (
                    <div
                      className="console-search__result"
                      style={
                        match.service.id === (matches[activeIndex]?.service.id ?? '')
                          ? { background: colorBackgroundItemSelected }
                          : undefined
                      }
                      onPointerEnter={() => {
                        setActiveId(match.service.id);
                      }}
                    >
                      <Link
                        href={serviceConsolePath(match.service.id)}
                        ariaLabel={`Open the ${match.service.displayName} console`}
                        onFollow={(event) => {
                          event.preventDefault();
                          openService(match.service);
                        }}
                      >
                        {match.service.displayName}
                      </Link>
                    </div>
                  ),
                  secondaryContent: (
                    <Box color="text-body-secondary">
                      {match.service.category} · {emulation}
                    </Box>
                  ),
                };
              }}
            />
          </SpaceBetween>
        )}

        <Box variant="small" color="text-body-secondary">
          Enter opens the highlighted service. Press {GLOBAL_SEARCH_SHORTCUT_LABEL} again or Escape
          to close. {services.length} services in the registry.
        </Box>
      </SpaceBetween>
    </Modal>
  );
}
