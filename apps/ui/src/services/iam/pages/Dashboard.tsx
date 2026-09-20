import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Grid from '@cloudscape-design/components/grid';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConsoleBreadcrumbs } from '../../../components/ConsoleBreadcrumbs';
import { toApiError } from '../../../lib/apiClient';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { listAllGroups, listAllPolicies, listAllRoles, listAllUsers } from '../api';

interface DashboardCounts {
  users: number;
  groups: number;
  roles: number;
  /** Customer managed policies; the AWS managed set is not counted. */
  policies: number;
}

/**
 * The IAM landing page: the four account-wide counts and links into each
 * section, mirroring the console's dashboard. Each count asks LocalStack for up
 * to a thousand items in one page; only an account larger than that pays for
 * additional pages, so a visit is usually four calls and never under-reports.
 */
export function DashboardPage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    try {
      const listOptions = { pageSize: 1000 };
      const [users, groups, roles, policies] = await Promise.all([
        listAllUsers(listOptions),
        listAllGroups(listOptions),
        listAllRoles(listOptions),
        listAllPolicies('Local', listOptions),
      ]);
      if (requestId.current !== id) return;
      setCounts({
        users: users.length,
        groups: groups.length,
        roles: roles.length,
        policies: policies.length,
      });
      setError(null);
    } catch (caught) {
      if (requestId.current !== id) return;
      setError(toApiError(caught));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- dashboard counts fetch
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  const open = (path: string) => {
    void navigate(`${serviceConsolePath(descriptor.id)}/${path}`);
  };

  const cards: readonly { title: string; count: number; label: string; path: string }[] =
    counts === null
      ? []
      : [
          { title: 'User groups', count: counts.groups, label: 'View user groups', path: 'groups' },
          { title: 'Users', count: counts.users, label: 'View users', path: 'users' },
          { title: 'Roles', count: counts.roles, label: 'View roles', path: 'roles' },
          {
            title: 'Customer managed policies',
            count: counts.policies,
            label: 'View policies',
            path: 'policies',
          },
        ];

  return (
    <ContentLayout
      breadcrumbs={<ConsoleBreadcrumbs items={[{ text: descriptor.displayName }]} />}
      header={
        <Header
          variant="h1"
          description="Manage identities and their permissions in this LocalStack account."
          actions={
            <Button
              iconName="refresh"
              ariaLabel="Refresh dashboard"
              loading={loading}
              onClick={() => {
                void load();
              }}
            />
          }
        >
          Dashboard
        </Header>
      }
    >
      <SpaceBetween size="l">
        {error === null ? null : (
          <Alert
            type="error"
            header="Could not load the IAM dashboard"
            action={
              <Button
                onClick={() => {
                  void load();
                }}
              >
                Retry
              </Button>
            }
          >
            {error.message}
          </Alert>
        )}

        {loading && counts === null ? (
          <Box textAlign="center" padding="l">
            <Spinner size="large" />
          </Box>
        ) : (
          <Grid gridDefinition={cards.map(() => ({ colspan: { default: 12, xs: 6, m: 3 } }))}>
            {cards.map((card) => (
              <Container key={card.path} header={<Header variant="h3">{card.title}</Header>}>
                <SpaceBetween size="s">
                  <Box variant="h2">{card.count}</Box>
                  <Link
                    href={`${serviceConsolePath(descriptor.id)}/${card.path}`}
                    onFollow={(event) => {
                      event.preventDefault();
                      open(card.path);
                    }}
                  >
                    {card.label}
                  </Link>
                </SpaceBetween>
              </Container>
            ))}
          </Grid>
        )}

        <Container header={<Header variant="h2">IAM resources</Header>}>
          <SpaceBetween size="s">
            <Box>
              IAM in LocalDeck manages users, groups, roles and policies through the LocalStack IAM
              API. Permissions are recorded but not enforced by LocalStack unless IAM enforcement is
              enabled — LocalDeck never pretends otherwise.
            </Box>
            <SpaceBetween direction="horizontal" size="s">
              <Button onClick={() => open('users/create')}>Create user</Button>
              <Button onClick={() => open('groups/create')}>Create user group</Button>
              <Button onClick={() => open('roles/create')}>Create role</Button>
              <Button onClick={() => open('policies/create')}>Create policy</Button>
            </SpaceBetween>
          </SpaceBetween>
        </Container>
      </SpaceBetween>
    </ContentLayout>
  );
}

export default DashboardPage;
