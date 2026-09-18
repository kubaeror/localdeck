import type { ServicePageRoute } from '@localdeck/shared';
import type { UiServiceModule } from '../types';
import { CreatePage } from './pages/Create';
import { DetailPage } from './pages/Detail';
import { ListPage } from './pages/List';
import { spec } from './spec';

/**
 * The S3 console: the bucket list, the create wizard and the bucket detail
 * page with its Objects / Properties / Permissions tabs. The shell discovers
 * this module by folder, so this file is the only wiring needed.
 */
const routes: readonly ServicePageRoute[] = [
  { path: '', title: 'Buckets', page: 'list' },
  { path: 'create', title: 'Create bucket', page: 'create' },
  { path: 'buckets/:bucketName', title: 'Bucket', page: 'detail' },
];

export const serviceModule: UiServiceModule = {
  descriptor: spec.descriptor,
  spec,
  routes,
  pages: { list: ListPage, detail: DetailPage, create: CreatePage },
};

export default serviceModule;
