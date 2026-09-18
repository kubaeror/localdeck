import Tooltip from '@cloudscape-design/components/tooltip';
import { useRef, useState, type ReactElement, type ReactNode } from 'react';

export interface InfoTooltipProps {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Tooltip attached to inline content (for example the "not emulated" badge on
 * a disabled sidebar entry). Cloudscape's Tooltip is track-based, so this
 * wrapper owns the hover/focus state and hands it the trigger element.
 */
export function InfoTooltip({ content, children, className }: InfoTooltipProps): ReactElement {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <span
        ref={triggerRef}
        // Focusable so keyboard users can reach the explanation.
        tabIndex={0}
        className={className}
        aria-label={typeof content === 'string' ? content : undefined}
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
          content={content}
          getTrack={() => triggerRef.current}
          onEscape={() => {
            setIsOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
