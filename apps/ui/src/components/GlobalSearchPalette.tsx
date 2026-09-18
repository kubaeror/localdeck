import { isServiceEmulated, type ServiceDescriptor } from '@localdeck/shared';
import Box from '@cloudscape-design/components/box';
import Input from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { colorBackgroundItemSelected } from '@cloudscape-design/design-tokens';
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
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
 *
 * Implements the ARIA combobox/listbox pattern: the search input is the
 * combobox and owns `aria-activedescendant`; every result is an option, so
 * screen readers announce the highlight that sighted users see.
 */
export function GlobalSearchPalette({ onDismiss }: GlobalSearchPaletteProps): ReactElement {
  const navigate = useNavigate();
  const { services } = useServiceCatalog();
  const status = useLocalStackStatus();
  const { visited } = useRecentlyVisited();

  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  const listboxId = useId();
  const activeOptionRef = useRef<HTMLLIElement | null>(null);

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
  const activeMatch = matches[activeIndex];
  const servicesReported = status.health?.localstack.services ?? {};

  const optionId = (serviceId: string): string => `${listboxId}-option-${serviceId}`;

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

  // Keyboard navigation must bring the highlighted option into view, exactly
  // like a native select. jsdom has no layout, so the call is guarded.
  useEffect(() => {
    const element = activeOptionRef.current;
    if (element === null) return;
    if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, matches]);

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
          nativeInputAttributes={{
            role: 'combobox',
            'aria-expanded': true,
            'aria-controls': listboxId,
            'aria-autocomplete': 'list',
            ...(activeMatch === undefined
              ? {}
              : { 'aria-activedescendant': optionId(activeMatch.service.id) }),
          }}
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
                if (activeMatch === undefined) break;
                event.preventDefault();
                openService(activeMatch.service);
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
            <Box variant="small" fontWeight="bold" color="text-body-secondary">
              {isSearching ? 'Matches' : 'Recently visited'}
            </Box>
            <ul
              id={listboxId}
              role="listbox"
              aria-label="Search results"
              style={{ listStyle: 'none', margin: 0, padding: 0 }}
            >
              {matches.map((match, index) => {
                const isActive = index === activeIndex;
                const emulation = isServiceEmulated(match.service, servicesReported)
                  ? 'emulated locally'
                  : 'not emulated locally';
                return (
                  <li
                    key={match.service.id}
                    id={optionId(match.service.id)}
                    role="option"
                    aria-selected={isActive}
                    ref={isActive ? activeOptionRef : undefined}
                    className="console-search__result"
                    style={{
                      background: isActive ? colorBackgroundItemSelected : undefined,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '4px 8px',
                      borderRadius: '4px',
                    }}
                    onPointerEnter={() => {
                      setActiveId(match.service.id);
                    }}
                  >
                    <ServiceIcon
                      iconKey={match.service.iconKey}
                      category={match.service.category}
                      size="small"
                    />
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
                    <Box color="text-body-secondary">
                      {match.service.category} · {emulation}
                    </Box>
                  </li>
                );
              })}
            </ul>
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
