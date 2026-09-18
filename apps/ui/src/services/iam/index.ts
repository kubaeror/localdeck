import type { ServicePageRoute } from '@localdeck/shared';
import type { UiServiceModule } from '../types';
import { DashboardPage } from './pages/Dashboard';
import { GroupCreatePage } from './pages/GroupCreate';
import { GroupDetailPage } from './pages/GroupDetail';
import { GroupsListPage } from './pages/GroupsList';
import { PoliciesListPage } from './pages/PoliciesList';
import { PolicyCreatePage } from './pages/PolicyCreate';
import { PolicyDetailPage } from './pages/PolicyDetail';
import { RoleCreatePage } from './pages/RoleCreate';
import { RoleDetailPage } from './pages/RoleDetail';
import { RolesListPage } from './pages/RolesList';
import { UserCreatePage } from './pages/UserCreate';
import { UserDetailPage } from './pages/UserDetail';
import { UsersListPage } from './pages/UsersList';
import { spec } from './spec';

/**
 * The IAM console: the dashboard plus one list, create wizard and detail page
 * per resource type. IAM is the first service with several resource types, so
 * it declares a page id per view (the shared `ServicePageKind` trio stays the
 * default for services with a single resource). The shell discovers this
 * module by folder, so this file is the only wiring needed.
 */
const routes: readonly ServicePageRoute[] = [
  { path: '', title: 'Dashboard', page: 'dashboard' },
  { path: 'users', title: 'Users', page: 'users' },
  { path: 'users/create', title: 'Create user', page: 'user-create' },
  { path: 'users/:userName', title: 'User', page: 'user-detail' },
  { path: 'groups', title: 'User groups', page: 'groups' },
  { path: 'groups/create', title: 'Create user group', page: 'group-create' },
  { path: 'groups/:groupName', title: 'User group', page: 'group-detail' },
  { path: 'roles', title: 'Roles', page: 'roles' },
  { path: 'roles/create', title: 'Create role', page: 'role-create' },
  { path: 'roles/:roleName', title: 'Role', page: 'role-detail' },
  { path: 'policies', title: 'Policies', page: 'policies' },
  { path: 'policies/create', title: 'Create policy', page: 'policy-create' },
  { path: 'policies/:policyArn', title: 'Policy', page: 'policy-detail' },
];

export const serviceModule: UiServiceModule = {
  descriptor: spec.descriptor,
  spec,
  routes,
  pages: {
    dashboard: DashboardPage,
    users: UsersListPage,
    'user-create': UserCreatePage,
    'user-detail': UserDetailPage,
    groups: GroupsListPage,
    'group-create': GroupCreatePage,
    'group-detail': GroupDetailPage,
    roles: RolesListPage,
    'role-create': RoleCreatePage,
    'role-detail': RoleDetailPage,
    policies: PoliciesListPage,
    'policy-create': PolicyCreatePage,
    'policy-detail': PolicyDetailPage,
  },
};

export default serviceModule;
