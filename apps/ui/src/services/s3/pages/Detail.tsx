import type { ApiError, AwsTag, S3PublicAccessBlock } from '@localdeck/shared';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import { useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { ResourceDetailPage } from '../../../components/ResourceDetailPage';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { deleteBucket } from '../api';
import { toFriendlyS3Error } from '../errors';
import { useBuckets } from '../useBuckets';
import { ObjectsTab } from '../components/ObjectsTab';
import { PermissionsTab } from '../components/PermissionsTab';
import { PropertiesTab } from '../components/PropertiesTab';

/** A draft value plus the bucket it was edited on. */
interface ScopedDraft<T> {
  bucket: string;
  value: T;
}

function activeDraft<T>(draft: ScopedDraft<T> | null, bucket: string): T | undefined {
  return draft?.bucket === bucket ? draft.value : undefined;
}

/**
 * One bucket: the console's Objects / Properties / Permissions tabs. The page
 * resolves the bucket from one `ListBuckets` call (shared with the Objects tab
 * through `useBuckets`) and keeps unsaved tab drafts across tab switches.
 */
export function DetailPage({ descriptor }: ServicePageProps): ReactElement {
  const { bucketName = '' } = useParams();
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const {
    buckets,
    loading: bucketsLoading,
    error: bucketsError,
    reload: reloadBuckets,
  } = useBuckets();

  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Unsaved drafts, tagged with the bucket so navigating to another bucket
  // never shows stale edits. The tabs unmount on switch; this state does not.
  const [versioningDraft, setVersioningDraft] = useState<ScopedDraft<boolean> | null>(null);
  const [tagsDraft, setTagsDraft] = useState<ScopedDraft<readonly AwsTag[]> | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<ScopedDraft<S3PublicAccessBlock> | null>(null);
  const [policyDraft, setPolicyDraft] = useState<ScopedDraft<string> | null>(null);

  const bucket = buckets.find((entry) => entry.name === bucketName) ?? null;

  const notFoundError: ApiError | null =
    !bucketsLoading && bucketsError === null && bucket === null
      ? {
          code: 'NoSuchBucket',
          statusCode: 404,
          message: `The bucket "${bucketName}" does not exist in this LocalStack account.`,
        }
      : null;
  const error = bucketsError ?? notFoundError;

  const confirmDelete = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteBucket(bucketName);
      flashbar.notify({ type: 'success', header: 'Bucket deleted', content: bucketName });
      setDeleteVisible(false);
      void navigate(serviceConsolePath(descriptor.id));
    } catch (caught) {
      setDeleteError(toFriendlyS3Error(caught).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <ResourceDetailPage
        title={bucketName}
        description={descriptor.summary}
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'Buckets', href: serviceConsolePath(descriptor.id) },
          { text: bucketName },
        ]}
        loading={bucketsLoading}
        error={error}
        onRetry={() => {
          void reloadBuckets();
        }}
        headerActions={
          <ButtonDropdown
            ariaLabel="Bucket actions"
            items={[
              { id: 'copy-arn', text: 'Copy ARN' },
              { id: 'copy-url', text: 'Copy S3 URI' },
              { id: 'delete', text: 'Delete bucket' },
            ]}
            onItemClick={({ detail }) => {
              if (detail.id === 'copy-arn') {
                void navigator.clipboard?.writeText(`arn:aws:s3:::${bucketName}`);
              }
              if (detail.id === 'copy-url') {
                void navigator.clipboard?.writeText(`s3://${bucketName}`);
              }
              if (detail.id === 'delete') {
                setDeleteError(null);
                setDeleteVisible(true);
              }
            }}
          >
            Bucket actions
          </ButtonDropdown>
        }
        tabs={[
          {
            id: 'objects',
            label: 'Objects',
            content: (
              <ObjectsTab
                key={bucketName}
                bucket={bucketName}
                buckets={buckets}
                bucketsLoading={bucketsLoading}
                bucketsError={bucketsError}
                onRefreshBuckets={() => {
                  void reloadBuckets();
                }}
              />
            ),
          },
          {
            id: 'properties',
            label: 'Properties',
            content: (
              <PropertiesTab
                key={bucketName}
                bucket={bucketName}
                {...(bucket?.creationDate === undefined
                  ? {}
                  : { creationDate: bucket.creationDate })}
                versioningDraft={activeDraft(versioningDraft, bucketName)}
                onVersioningDraftChange={(enabled) => {
                  setVersioningDraft(
                    enabled === undefined ? null : { bucket: bucketName, value: enabled },
                  );
                }}
                tagsDraft={activeDraft(tagsDraft, bucketName)}
                onTagsDraftChange={(tags) => {
                  setTagsDraft(tags === undefined ? null : { bucket: bucketName, value: tags });
                }}
              />
            ),
          },
          {
            id: 'permissions',
            label: 'Permissions',
            content: (
              <PermissionsTab
                key={bucketName}
                bucket={bucketName}
                settingsDraft={activeDraft(settingsDraft, bucketName)}
                onSettingsDraftChange={(settings) => {
                  setSettingsDraft(
                    settings === undefined ? null : { bucket: bucketName, value: settings },
                  );
                }}
                policyDraft={activeDraft(policyDraft, bucketName)}
                onPolicyDraftChange={(policy) => {
                  setPolicyDraft(
                    policy === undefined ? null : { bucket: bucketName, value: policy },
                  );
                }}
              />
            ),
          },
        ]}
      />

      {deleteVisible ? (
        <DeleteConfirmModal
          visible
          title="Delete bucket"
          subjects={[bucketName]}
          description="Objects in the bucket must be deleted before the bucket can be deleted. This action cannot be undone."
          submitLabel="Delete bucket"
          loading={deleting}
          {...(deleteError === null ? {} : { errorText: deleteError })}
          onDismiss={() => {
            if (deleting) return;
            setDeleteVisible(false);
            setDeleteError(null);
          }}
          onConfirm={() => {
            void confirmDelete();
          }}
        />
      ) : null}
    </>
  );
}

export default DetailPage;
