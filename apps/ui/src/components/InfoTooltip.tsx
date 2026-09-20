import Tooltip from '@cloudscape-design/components/tooltip';
import { useId, useRef, useState, type ReactElement, type ReactNode } from 'react';

export interface InfoTooltipProps {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Tooltip attached to inline content (for example the "not emulated" badge on
 * a disabled sidebar entry). Cloudscape's Tooltip is track-based, so this
 * wrapper owns the hover/focus state and hands it the trigger element.
 *
 * While the tooltip is open the trigger carries `aria-describedby` pointing at
 * the tooltip content, so assistive technology reads the explanation too.
 */
export function InfoTooltip({ content, children, className }: InfoTooltipProps): ReactElement {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const tooltipId = useId();

  return (
    <>
      <span
        ref={triggerRef}
        // Not in the tab order: sidebar badges can number in the hundreds and
        // would each add a focus stop. The explanation stays reachable on
        // hover, and the badge text/aria-label carry the same information.
        tabIndex={-1}
        className={className}
        aria-label={typeof content === 'string' ? content : undefined}
        aria-describedby={isOpen ? tooltipId : undefined}
        onPointerEnter={() => {
          setIsOpen(true);
        }}
        onPointerLeave={() => {
          setIsOpen(false);
        }}
        onFocus={(event) => {
          if (event.target === event.currentTarget) setIsOpen(true);
        }}
        onBlur={(event) => {
          if (event.target === event.currentTarget) setIsOpen(false);
        }}
      >
        {children}
      </span>
      {isOpen ? (
        <Tooltip
          content={<span id={tooltipId}>{content}</span>}
          getTrack={() => triggerRef.current}
          onEscape={() => {
            setIsOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
