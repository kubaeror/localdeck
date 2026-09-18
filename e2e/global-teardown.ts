import { E2E_RESOURCE_PREFIX, E2E_TAG_KEY, UI_ORIGIN, readTrackedResources } from './support';

/**
 * Best-effort sweep of the resources this suite creates in the developer's own
 * LocalStack. Playwright keeps the web servers alive while global teardown
 * runs, so every call goes through the same `/api` proxy the tests used.
 *
 * Two layers cooperate:
 *  1. resources recorded by the specs (`e2e-cleanup.jsonl`, in creation order);
 *  2. a discovery sweep limited to this suite's name prefix and tag, for runs
 *     that crashed before recording (or before cleaning up in `finally`).
 *
 * Cleanup problems are reported, never thrown: a leaked demo resource must not
 * turn a green suite red, and LocalDeck never repairs LocalStack itself.
 */
export default async function globalTeardown(): Promise<void> {
  const problems: string[] = [];

  async function dispatch(
    service: string,
    operation: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await fetch(
      `${UI_ORIGIN}/api/services/${encodeURIComponent(service)}/${encodeURIComponent(operation)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input }),
      },
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${service}.${operation} answered ${response.status}: ${body.slice(0, 300)}`);
    }
    const body = (await response.json()) as { result: unknown };
    return body.result;
  }

  async function sweepBucket(bucket: string): Promise<void> {
    try {
      for (;;) {
        const listed = (await dispatch('s3', 'ListObjectsV2', {
          Bucket: bucket,
          MaxKeys: 1000,
        })) as { Contents?: { Key?: string }[] };
        const keys = (listed.Contents ?? [])
          .map((entry) => entry.Key)
          .filter((key): key is string => typeof key === 'string');
        if (keys.length === 0) break;
        await dispatch('s3', 'DeleteObjects', {
          Bucket: bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        });
      }
      await dispatch('s3', 'DeleteBucket', { Bucket: bucket });
      console.log(`[e2e] removed leftover bucket ${bucket}`);
    } catch (error) {
      if (/NoSuchBucket|not found/i.test(errorText(error))) return;
      problems.push(`bucket ${bucket}: ${errorText(error)}`);
    }
  }

  async function sweepCluster(name: string): Promise<void> {
    try {
      await dispatch('eks', 'DeleteCluster', { name });
      console.log(`[e2e] removed leftover EKS cluster ${name}`);
    } catch (error) {
      if (/ResourceNotFound|not found/i.test(errorText(error))) return;
      problems.push(`EKS cluster ${name}: ${errorText(error)}`);
    }
  }

  async function sweepInstances(instanceIds: string[]): Promise<void> {
    if (instanceIds.length === 0) return;
    try {
      // Tracked ids may already be terminated by the spec's own cleanup; only
      // the ones still alive are terminated again.
      const described = (await dispatch('ec2', 'DescribeInstances', {
        InstanceIds: instanceIds,
      })) as {
        Reservations?: { Instances?: { InstanceId?: string; State?: { Name?: string } }[] }[];
      };
      const alive = (described.Reservations ?? [])
        .flatMap((reservation) => reservation.Instances ?? [])
        .filter((instance) => instance.State?.Name !== 'terminated')
        .map((instance) => instance.InstanceId)
        .filter((id): id is string => typeof id === 'string');
      if (alive.length === 0) return;
      await dispatch('ec2', 'TerminateInstances', { InstanceIds: alive });
      console.log(`[e2e] terminated leftover EC2 instance(s) ${alive.join(', ')}`);
    } catch (error) {
      // An id LocalStack no longer knows is already gone, not a problem.
      if (/InvalidInstanceID|not found/i.test(errorText(error))) return;
      problems.push(`EC2 instance(s) ${instanceIds.join(', ')}: ${errorText(error)}`);
    }
  }

  /** Resources the specs recorded while creating them, newest first. */
  const tracked = readTrackedResources().reverse();
  const buckets = new Set(tracked.filter((r) => r.kind === 's3-bucket').map((r) => r.id));
  const clusters = new Set(tracked.filter((r) => r.kind === 'eks-cluster').map((r) => r.id));
  const instances = new Set(tracked.filter((r) => r.kind === 'ec2-instance').map((r) => r.id));

  // 1. Discovery sweep: only names with our prefix / our tag are touched, so
  //    the developer's other resources are never in scope. Each service is
  //    probed independently — an emulator without EKS must not skip the S3 and
  //    EC2 sweeps — and discovery failures are warnings, never test failures.
  try {
    const bucketList = (await dispatch('s3', 'ListBuckets', {})) as {
      Buckets?: { Name?: string }[];
    };
    for (const entry of bucketList.Buckets ?? []) {
      if (entry.Name?.startsWith(E2E_RESOURCE_PREFIX)) buckets.add(entry.Name);
    }
  } catch (error) {
    console.warn(`[e2e] S3 discovery sweep skipped: ${errorText(error)}`);
  }

  try {
    const clusterList = (await dispatch('eks', 'ListClusters', {})) as {
      clusters?: string[];
    };
    for (const name of clusterList.clusters ?? []) {
      if (name.startsWith(E2E_RESOURCE_PREFIX)) clusters.add(name);
    }
  } catch (error) {
    console.warn(`[e2e] EKS discovery sweep skipped: ${errorText(error)}`);
  }

  try {
    const instanceList = (await dispatch('ec2', 'DescribeInstances', {})) as {
      Reservations?: {
        Instances?: {
          InstanceId?: string;
          State?: { Name?: string };
          Tags?: { Key?: string; Value?: string }[];
        }[];
      }[];
    };
    for (const reservation of instanceList.Reservations ?? []) {
      for (const instance of reservation.Instances ?? []) {
        if (instance.InstanceId === undefined) continue;
        if (instance.State?.Name === 'terminated') continue;
        const tags = instance.Tags ?? [];
        const taggedForSuite = tags.some((tag) => tag.Key === E2E_TAG_KEY);
        const namedForSuite =
          tags.find((tag) => tag.Key === 'Name')?.Value?.startsWith(E2E_RESOURCE_PREFIX) === true;
        if (taggedForSuite || namedForSuite) instances.add(instance.InstanceId);
      }
    }
  } catch (error) {
    console.warn(`[e2e] EC2 discovery sweep skipped: ${errorText(error)}`);
  }

  // 2. Delete in dependency order: clusters first, then their instances, then
  //    storage (objects must be gone before their bucket).
  for (const cluster of clusters) await sweepCluster(cluster);
  await sweepInstances([...instances]);
  for (const bucket of buckets) await sweepBucket(bucket);

  if (problems.length > 0) {
    console.warn(
      '[e2e] the cleanup sweep could not remove every resource; check your LocalStack manually:',
    );
    for (const problem of problems) console.warn(`  - ${problem}`);
  } else if (tracked.length > 0 || buckets.size + clusters.size + instances.size > 0) {
    console.log('[e2e] cleanup sweep finished without leftovers');
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
