import type { ServicePageRoute } from '@localdeck/shared';
import type { UiServiceModule } from '../types';
import { AmiDetailPage } from './pages/AmiDetail';
import { AmisListPage } from './pages/AmisList';
import { DashboardPage } from './pages/Dashboard';
import { InstanceCreatePage } from './pages/InstanceCreate';
import { InstanceDetailPage } from './pages/InstanceDetail';
import { InstancesListPage } from './pages/InstancesList';
import { SecurityGroupDetailPage } from './pages/SecurityGroupDetail';
import { SecurityGroupsListPage } from './pages/SecurityGroupsList';
import { VolumeCreatePage } from './pages/VolumeCreate';
import { VolumeDetailPage } from './pages/VolumeDetail';
import { VolumesListPage } from './pages/VolumesList';
import { spec } from './spec';

/**
 * The EC2 console: the dashboard plus instances, security groups, volumes and
 * AMIs, each with its own list, detail (and where it makes sense, create) page.
 * The shell discovers this module by folder, so this file is the only wiring
 * needed.
 */
const routes: readonly ServicePageRoute[] = [
  { path: '', title: 'Dashboard', page: 'dashboard' },
  { path: 'instances', title: 'Instances', page: 'instances' },
  { path: 'instances/launch', title: 'Launch instance', page: 'instance-launch' },
  { path: 'instances/:instanceId', title: 'Instance', page: 'instance-detail' },
  { path: 'security-groups', title: 'Security groups', page: 'security-groups' },
  { path: 'security-groups/:groupId', title: 'Security group', page: 'security-group-detail' },
  { path: 'volumes', title: 'Volumes', page: 'volumes' },
  { path: 'volumes/create', title: 'Create volume', page: 'volume-create' },
  { path: 'volumes/:volumeId', title: 'Volume', page: 'volume-detail' },
  { path: 'amis', title: 'AMIs', page: 'amis' },
  { path: 'amis/:imageId', title: 'AMI', page: 'ami-detail' },
];

export const serviceModule: UiServiceModule = {
  descriptor: spec.descriptor,
  spec,
  routes,
  pages: {
    dashboard: DashboardPage,
    instances: InstancesListPage,
    'instance-launch': InstanceCreatePage,
    'instance-detail': InstanceDetailPage,
    'security-groups': SecurityGroupsListPage,
    'security-group-detail': SecurityGroupDetailPage,
    volumes: VolumesListPage,
    'volume-create': VolumeCreatePage,
    'volume-detail': VolumeDetailPage,
    amis: AmisListPage,
    'ami-detail': AmiDetailPage,
  },
};

export default serviceModule;
