import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { InfoTooltip } from './InfoTooltip';

describe('InfoTooltip', () => {
  afterEach(() => {
    cleanup();
  });

  it('associates the open tooltip with the trigger through aria-describedby', () => {
    render(
      <InfoTooltip content="Not emulated locally">
        <span>EC2</span>
      </InfoTooltip>,
    );

    const trigger = screen.getByLabelText('Not emulated locally');
    expect(trigger.getAttribute('aria-describedby')).toBeNull();

    fireEvent.focus(trigger);

    const describedBy = trigger.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const tooltip = document.getElementById(describedBy ?? '');
    expect(tooltip?.textContent).toBe('Not emulated locally');

    fireEvent.blur(trigger);
    expect(trigger.getAttribute('aria-describedby')).toBeNull();
  });

  it('keeps the trigger out of the tab order while the tooltip stays reachable on hover', () => {
    render(
      <InfoTooltip content="Not emulated locally">
        <span>EC2</span>
      </InfoTooltip>,
    );

    const trigger = screen.getByLabelText('Not emulated locally');
    // Every greyed-out sidebar badge is wrapped in this component; a focusable
    // trigger would add one tab stop per badge.
    expect(trigger.getAttribute('tabindex')).toBe('-1');

    fireEvent.pointerOver(trigger);
    const describedBy = trigger.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe('Not emulated locally');

    // Escape still closes the tooltip.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(trigger.getAttribute('aria-describedby')).toBeNull();
  });
});
