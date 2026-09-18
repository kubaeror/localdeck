import type { ServiceDescriptor } from './types.js';

/** Container services, in console order. */
export const CONTAINER_SERVICES = [
  {
    id: 'ecs',
    displayName: 'ECS',
    category: 'Containers',
    sdkPackage: '@aws-sdk/client-ecs',
    iconKey: 'ecs',
    operations: [
      'ListClusters',
      'DescribeClusters',
      'CreateCluster',
      'DeleteCluster',
      'ListServices',
      'DescribeServices',
      'ListTasks',
      'RegisterTaskDefinition',
    ],
    parityLevel: 'browser',
    summary: 'Container clusters, services and task definitions.',
    browser: {
      list: {
        operation: 'ListClusters',
        resultPath: 'clusterArns',
        pagination: { requestField: 'nextToken', responseField: 'nextToken' },
      },
      describe: { operation: 'DescribeClusters', idParam: 'clusters', idParamIsArray: true },
      delete: { operation: 'DeleteCluster', idParam: 'cluster' },
    },
  },
  {
    id: 'ecr',
    displayName: 'ECR',
    category: 'Containers',
    sdkPackage: '@aws-sdk/client-ecr',
    iconKey: 'ecr',
    operations: [
      'DescribeRepositories',
      'CreateRepository',
      'DeleteRepository',
      'ListImages',
      'DescribeImages',
      'GetAuthorizationToken',
    ],
    parityLevel: 'browser',
    summary: 'Container image repositories, tags and image scans.',
    browser: {
      list: {
        operation: 'DescribeRepositories',
        resultPath: 'repositories',
        idField: 'repositoryName',
        pagination: { requestField: 'nextToken', responseField: 'nextToken' },
      },
      describe: {
        operation: 'DescribeRepositories',
        idParam: 'repositoryNames',
        idParamIsArray: true,
      },
      delete: { operation: 'DeleteRepository', idParam: 'repositoryName' },
    },
  },
  {
    id: 'eks',
    displayName: 'EKS',
    category: 'Containers',
    sdkPackage: '@aws-sdk/client-eks',
    iconKey: 'eks',
    operations: [
      // Clusters
      'ListClusters',
      'DescribeCluster',
      'CreateCluster',
      'DeleteCluster',
      'DescribeClusterVersions',
      // Managed node groups
      'ListNodegroups',
      'DescribeNodegroup',
      'CreateNodegroup',
      'UpdateNodegroupConfig',
      'DeleteNodegroup',
      // Tags (clusters and node groups share the ARN-keyed tag API)
      'ListTagsForResource',
      'TagResource',
      'UntagResource',
    ],
    parityLevel: 'dedicated',
    summary: 'Managed Kubernetes clusters and node groups.',
    healthKeys: ['eks-auth'],
  },
  {
    id: 'managedblockchain',
    displayName: 'Managed Blockchain',
    category: 'Containers',
    sdkPackage: '@aws-sdk/client-managedblockchain',
    iconKey: 'managedblockchain',
    operations: ['ListNetworks', 'GetNetwork', 'CreateNetwork', 'DeleteNetwork', 'ListMembers'],
    parityLevel: 'browser',
    summary: 'Managed Hyperledger Fabric and Ethereum networks.',
    browser: {
      list: { operation: 'ListNetworks', resultPath: 'Networks', idField: 'Id', nameField: 'Name' },
      describe: { operation: 'GetNetwork', idParam: 'NetworkId' },
      delete: { operation: 'DeleteNetwork', idParam: 'NetworkId' },
    },
  },
] as const satisfies readonly ServiceDescriptor[];
