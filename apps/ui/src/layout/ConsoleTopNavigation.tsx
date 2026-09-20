import type { ButtonDropdownProps } from '@cloudscape-design/components/button-dropdown';
import TopNavigation from '@cloudscape-design/components/top-navigation';
import type { TopNavigationProps } from '@cloudscape-design/components/top-navigation';
import { useMemo, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { GLOBAL_SEARCH_SHORTCUT_LABEL } from '../contexts/global-search-context';
import { useFlashbar } from '../hooks/useFlashbar';
import { useGlobalSearch } from '../hooks/useGlobalSearch';
import { useEmulatorStatus } from '../hooks/useEmulatorStatus';
import { useRecentlyVisited } from '../hooks/useRecentlyVisited';
import { CONSOLE_HOME_PATH, DEFAULT_EMULATOR_DOCS_URL } from '../services/paths';

export interface ConsoleTopNavigationProps {
  onOpenHelp: () => void;
}

/**
 * Console top bar, modeled on the AWS console: brand, global search, region
 * selector, help and the local user pill. The terminal entry is behind the
 * `VITE_TERMINAL_ENABLED` feature flag because it is a placeholder, not a
 * working feature.
 */
export function ConsoleTopNavigation({ onOpenHelp }: ConsoleTopNavigationProps): ReactElement {
  const navigate = useNavigate();
  const status = useEmulatorStatus();
  const search = useGlobalSearch();
  const recentlyVisited = useRecentlyVisited();
  const flashbar = useFlashbar();

  const region = status.config?.emulator.region ?? null;
  const endpoint = status.config?.emulator.endpoint ?? null;
  const providerLabel = status.health?.provider.providerLabel ?? 'Emulator';
  const stackVersion = status.health?.provider.version ?? null;
  const stackEdition = status.health?.provider.edition ?? null;
  const providerDocsUrl = status.health?.provider.docsUrl ?? DEFAULT_EMULATOR_DOCS_URL;

  // Stable handlers, so the utilities memo is not rebuilt every time the
  // status poll produces a new state object.
  const refreshStatus = status.refresh;
  const notify = flashbar.notify;
  const clearRecentlyVisited = recentlyVisited.clear;
  const openSearch = search.open;

  const utilities = useMemo<readonly TopNavigationProps.Utility[]>(() => {
    const regionItems: ButtonDropdownProps.Items = [
      {
        id: 'region',
        text: region === null ? 'Region: loading…' : `Region: ${region}`,
        description: `One region per instance: ${providerLabel} serves every request from the region the api is configured with.`,
        disabled: true,
      },
      {
        id: 'endpoint',
        text: endpoint === null ? 'Endpoint: loading…' : `Endpoint: ${endpoint}`,
        description: `${providerLabel} base URL the LocalDeck api proxies to.`,
        disabled: true,
      },
      {
        id: 'stack',
        text:
          stackVersion === null
            ? `${providerLabel}: unreachable`
            : `${providerLabel} ${stackVersion} (${stackEdition ?? 'unknown'})`,
        disabled: true,
      },
      { id: 'refresh', text: 'Refresh status' },
    ];

    const helpItems: ButtonDropdownProps.Items = [
      { id: 'about', text: 'About this console' },
      {
        id: 'docs',
        text: `${providerLabel} documentation`,
        href: providerDocsUrl,
        external: true,
        externalIconAriaLabel: 'Opens in a new tab',
      },
    ];

    const userItems: ButtonDropdownProps.Items = [
      {
        id: 'account',
        text: 'Account 000000000000',
        description:
          'Default account id; MiniStack derives the account from a 12-digit AWS_ACCESS_KEY_ID.',
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

    const searchUtility: TopNavigationProps.Utility = {
      type: 'button',
      iconName: 'search',
      text: 'Search',
      ariaLabel: `Search services (${GLOBAL_SEARCH_SHORTCUT_LABEL})`,
      disableUtilityCollapse: true,
      onClick: openSearch,
    };

    const regionUtility: TopNavigationProps.Utility = {
      type: 'menu-dropdown',
      text: region === null ? 'Region (local)' : `${region} (local)`,
      ariaLabel: 'Region and stack details',
      disableUtilityCollapse: true,
      description: `This console is bound to the ${providerLabel} instance your api is configured with.`,
      items: regionItems,
      onItemClick: ({ detail }) => {
        if (detail.id === 'refresh') refreshStatus();
      },
    };

    const helpUtility: TopNavigationProps.Utility = {
      type: 'menu-dropdown',
      iconName: 'status-info',
      ariaLabel: 'Help',
      disableUtilityCollapse: true,
      title: 'Help',
      items: helpItems,
      onItemClick: ({ detail }) => {
        if (detail.id === 'about') onOpenHelp();
      },
    };

    const userUtility: TopNavigationProps.Utility = {
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
        clearRecentlyVisited();
        notify({
          type: 'success',
          header: 'Recently visited cleared',
          content: 'The Console Home widget no longer lists any services.',
        });
      },
    };

    const entries: TopNavigationProps.Utility[] = [searchUtility, regionUtility];

    // The terminal does not exist yet; showing it only when explicitly
    // enabled keeps a dead end out of the default console.
    if (import.meta.env.VITE_TERMINAL_ENABLED === 'true') {
      entries.push({
        type: 'menu-dropdown',
        iconName: 'command-prompt',
        ariaLabel: 'Terminal (not implemented yet)',
        disableUtilityCollapse: true,
        title: `${providerLabel} terminal`,
        description:
          'A browser terminal that runs AWS CLI commands against this endpoint is not part of this LocalDeck release yet.',
        items: [
          {
            id: 'terminal-unavailable',
            text: 'Not implemented yet',
            description: `Until then, run the AWS CLI yourself with --endpoint-url pointing at your ${providerLabel} instance.`,
            disabled: true,
          },
        ],
      });
    }

    entries.push(helpUtility, userUtility);
    return entries;
  }, [
    clearRecentlyVisited,
    endpoint,
    notify,
    onOpenHelp,
    openSearch,
    providerDocsUrl,
    providerLabel,
    refreshStatus,
    region,
    stackEdition,
    stackVersion,
  ]);

  return (
    <TopNavigation
      identity={{
        href: CONSOLE_HOME_PATH,
        title: 'LocalDeck',
        onFollow: (event) => {
          event.preventDefault();
          void navigate(CONSOLE_HOME_PATH);
        },
      }}
      i18nStrings={{ overflowMenuTriggerText: 'More', overflowMenuTitleText: 'All' }}
      utilities={utilities}
    />
  );
}
