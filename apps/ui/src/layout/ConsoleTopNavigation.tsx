import type { ButtonDropdownProps } from '@cloudscape-design/components/button-dropdown';
import TopNavigation from '@cloudscape-design/components/top-navigation';
import type { TopNavigationProps } from '@cloudscape-design/components/top-navigation';
import { useMemo, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { GLOBAL_SEARCH_SHORTCUT_LABEL } from '../contexts/global-search-context';
import { useFlashbar } from '../hooks/useFlashbar';
import { useGlobalSearch } from '../hooks/useGlobalSearch';
import { useLocalStackStatus } from '../hooks/useLocalStackStatus';
import { useRecentlyVisited } from '../hooks/useRecentlyVisited';
import { CONSOLE_HOME_PATH } from '../services/paths';

const LOCALSTACK_SERVICES_DOCS = 'https://docs.localstack.cloud/aws/services/';

export interface ConsoleTopNavigationProps {
  onOpenHelp: () => void;
}

/**
 * Console top bar, modeled on the AWS console: brand, global search, region
 * selector, a disabled terminal placeholder, help and the local user pill.
 */
export function ConsoleTopNavigation({ onOpenHelp }: ConsoleTopNavigationProps): ReactElement {
  const navigate = useNavigate();
  const status = useLocalStackStatus();
  const search = useGlobalSearch();
  const recentlyVisited = useRecentlyVisited();
  const flashbar = useFlashbar();

  const region = status.config?.localstack.region ?? null;
  const endpoint = status.config?.localstack.endpoint ?? null;
  const stack = status.health?.localstack ?? null;

  const utilities = useMemo<readonly TopNavigationProps.Utility[]>(() => {
    const regionItems: ButtonDropdownProps.Items = [
      {
        id: 'region',
        text: region === null ? 'Region: loading…' : `Region: ${region}`,
        description:
          'One region per instance: LocalStack serves every request from the region the api is configured with.',
        disabled: true,
      },
      {
        id: 'endpoint',
        text: endpoint === null ? 'Endpoint: loading…' : `Endpoint: ${endpoint}`,
        description: 'LocalStack base URL the LocalDeck api proxies to.',
        disabled: true,
      },
      {
        id: 'stack',
        text:
          stack === null
            ? 'LocalStack: unreachable'
            : `LocalStack ${stack.version ?? 'unknown'} (${stack.edition ?? 'unknown'})`,
        disabled: true,
      },
      { id: 'refresh', text: 'Refresh status' },
    ];

    const helpItems: ButtonDropdownProps.Items = [
      { id: 'about', text: 'About this console' },
      {
        id: 'docs',
        text: 'LocalStack documentation',
        href: LOCALSTACK_SERVICES_DOCS,
        external: true,
        externalIconAriaLabel: 'Opens in a new tab',
      },
    ];

    const userItems: ButtonDropdownProps.Items = [
      {
        id: 'account',
        text: 'Account 000000000000',
        description: "LocalStack's fixed test account id.",
        disabled: true,
      },
      {
        id: 'credentials',
        text: 'Credentials stay on the api',
        description:
          'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are read by the LocalDeck api process and are never sent to the browser.',
        disabled: true,
      },
      {
        id: 'clear-recent',
        text: 'Clear recently visited list',
        description: 'Empties the Console Home widget in this browser.',
      },
    ];

    return [
      {
        type: 'button',
        iconName: 'search',
        text: 'Search',
        ariaLabel: `Search services (${GLOBAL_SEARCH_SHORTCUT_LABEL})`,
        disableUtilityCollapse: true,
        onClick: () => {
          search.open();
        },
      },
      {
        type: 'menu-dropdown',
        text: region === null ? 'Region (local)' : `${region} (local)`,
        ariaLabel: 'Region and stack details',
        disableUtilityCollapse: true,
        description:
          'This console is bound to the LocalStack instance your api is configured with.',
        items: regionItems,
        onItemClick: ({ detail }) => {
          if (detail.id === 'refresh') status.refresh();
        },
      },
      {
        type: 'menu-dropdown',
        iconName: 'command-prompt',
        ariaLabel: 'Terminal (not implemented yet)',
        disableUtilityCollapse: true,
        title: 'LocalStack terminal',
        description:
          'A browser terminal that runs AWS CLI commands against this endpoint is not part of this LocalDeck release yet.',
        items: [
          {
            id: 'terminal-unavailable',
            text: 'Not implemented yet',
            description:
              'Until then, run the AWS CLI yourself with --endpoint-url pointing at your LocalStack instance.',
            disabled: true,
          },
        ],
      },
      {
        type: 'menu-dropdown',
        iconName: 'status-info',
        ariaLabel: 'Help',
        disableUtilityCollapse: true,
        title: 'Help',
        items: helpItems,
        onItemClick: ({ detail }) => {
          if (detail.id === 'about') onOpenHelp();
        },
      },
      {
        type: 'menu-dropdown',
        text: 'local',
        iconName: 'user-profile',
        ariaLabel: 'Signed in as local',
        disableUtilityCollapse: true,
        title: 'local',
        description:
          'LocalDeck runs without accounts or logins; every request uses the api credentials.',
        items: userItems,
        onItemClick: ({ detail }) => {
          if (detail.id !== 'clear-recent') return;
          recentlyVisited.clear();
          flashbar.notify({
            type: 'success',
            header: 'Recently visited cleared',
            content: 'The Console Home widget no longer lists any services.',
          });
        },
      },
    ];
  }, [endpoint, flashbar, onOpenHelp, recentlyVisited, region, search, stack, status]);

  return (
    <TopNavigation
      identity={{
        href: CONSOLE_HOME_PATH,
        title: 'LocalDeck',
        onFollow: (event) => {
          event.preventDefault();
          navigate(CONSOLE_HOME_PATH);
        },
      }}
      i18nStrings={{ overflowMenuTriggerText: 'More', overflowMenuTitleText: 'All' }}
      utilities={utilities}
    />
  );
}
