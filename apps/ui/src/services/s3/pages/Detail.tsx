import type { ApiError } from '@localdeck/shared';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { ResourceDetailPage } from '../../../components/ResourceDetailPage';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { deleteBucket, listBuckets, type S3Bucket } from '../api';
import { toFriendlyS3Error } from '../errors';
import { ObjectsTab } from '../components/ObjectsTab';
import { PermissionsTab } from '../components/PermissionsTab';
import { PropertiesTab } from '../components/PropertiesTab';

/**
 * One bucket: the console's Objects / Properties / Permissions tabs. The page
 * resolves the bucket from ListBuckets so the overview can show its creation
 * date and a deleted bucket produces a clean error instead of broken tabs.
 */
export function DetailPage({ descriptor }: ServicePageProps): ReactElement {
  const { bucketName = '' } = useParams();
  const navigate = useNavigate();
  const flashbar = useFlashbar();

  const [bucket, setBucket] = useState<S3Bucket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    try {
      const result = await listBuckets();
      if (requestId.current !== id) return;
      const found = result.items.find((entry) => entry.name === bucketName) ?? null;
      setBucket(found);
      setError(
        found === null
          ? {
              code: 'NoSuchBucket',
              statusCode: 404,
              message: `The bucket "${bucketName}" does not exist in this LocalStack account.`,
            }
          : null,
      );
    } catch (caught) {
      if (requestId.current !== id) return;
      setError(toApiError(caught));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [bucketName]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bucket lookup for the route
    void load();
    return () => {
      // Invalidate an in-flight ListBuckets when the page unmounts.
      requestId.current += 1;
    };
  }, [load]);

  const confirmDelete = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteBucket(bucketName);
      flashbar.notify({ type: 'success', header: 'Bucket deleted', content: bucketName });
      setDeleteVisible(false);
      navigate(serviceConsolePath(descriptor.id));
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
        loading={loading}
        error={error}
        onRetry={() => {
          void load();
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
            content: <ObjectsTab key={bucketName} bucket={bucketName} />,
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
              />
            ),
          },
          {
            id: 'permissions',
            label: 'Permissions',
            content: <PermissionsTab key={bucketName} bucket={bucketName} />,
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
