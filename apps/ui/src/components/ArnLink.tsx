import Box from '@cloudscape-design/components/box';
import Link from '@cloudscape-design/components/link';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseArn, serviceForArn } from '../lib/arns';
import { serviceConsolePath } from '../services/paths';
import { InfoTooltip } from './InfoTooltip';

export interface ArnLinkProps {
  /** The ARN to render. */
  arn: string;
  /** Link text; defaults to the resource part of the ARN. */
  label?: string;
}

/**
 * Renders an ARN as a link into the LocalDeck console when the ARN's service
 * has a console (the fallback is the raw, copyable ARN).
 */
export function ArnLink({ arn, label }: ArnLinkProps): ReactElement {
  const navigate = useNavigate();
  const parsed = parseArn(arn);

  if (parsed === null) {
    return (
      <InfoTooltip content="This value is not a recognizable ARN.">
        <Box variant="code">{arn}</Box>
      </InfoTooltip>
    );
  }

  const service = serviceForArn(parsed);
  if (service === undefined) {
    return (
      <InfoTooltip content={`LocalDeck has no ${parsed.service} console yet.`}>
        <Box variant="code">{arn}</Box>
      </InfoTooltip>
    );
  }

  const text = label ?? parsed.resource;

  return (
    <Link
      href={serviceConsolePath(service.id)}
      ariaLabel={`Open the ${service.displayName} console for ${text}`}
      onFollow={(event) => {
        event.preventDefault();
        void navigate(serviceConsolePath(service.id));
      }}
    >
      {text}
    </Link>
  );
}
