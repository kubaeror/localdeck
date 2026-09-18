import type { ServicePageRoute } from '@localdeck/shared';
import type { UiServiceModule } from '../types';
import { ClusterCreatePage } from './pages/ClusterCreate';
import { ClusterDetailPage } from './pages/ClusterDetail';
import { ClustersListPage } from './pages/ClustersList';
import { spec } from './spec';

/**
 * The EKS console: the cluster list, the create-cluster wizard, and the
 * cluster detail page with its Overview / Compute (node groups) / Tags tabs.
 * The shell discovers this module by folder, so this file is the only wiring
 * needed.
 */
const routes: readonly ServicePageRoute[] = [
  { path: '', title: 'Clusters', page: 'clusters' },
  { path: 'create', title: 'Create cluster', page: 'cluster-create' },
  { path: 'clusters/:clusterName', title: 'Cluster', page: 'cluster-detail' },
];

export const serviceModule: UiServiceModule = {
  descriptor: spec.descriptor,
  spec,
  routes,
  pages: {
    clusters: ClustersListPage,
    'cluster-create': ClusterCreatePage,
    'cluster-detail': ClusterDetailPage,
  },
};

export default serviceModule;
