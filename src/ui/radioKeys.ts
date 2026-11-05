import type { KeyboardEvent } from "react";

const STEPS: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

/**
 * The keys between the radios of a group, for its onKeyDown, as the ARIA radio
 * pattern has them: the arrows go to the next or the previous one and round
 * at either end (right and left the other way round when the page reads right
 * to left), Home and End to either end. Each moves the focus and chooses,
 * unless `choose` is false: where choosing does more than mark the choice
 * (it closes the picker, or reloads the page) the focus moves, and Space or
 * Enter chooses.
 */
export function onRadioKeys(event: KeyboardEvent<HTMLElement>, choose = true): void {
  const radios = [...event.currentTarget.querySelectorAll<HTMLElement>("[role='radio']")];
  const active = document.activeElement;
  const at = active instanceof HTMLElement ? radios.indexOf(active) : -1;
  if (at === -1) return;
  const step = STEPS[event.key];
  let next: number;
  if (step !== undefined) {
    const sideways = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const backwards = sideways && getComputedStyle(event.currentTarget).direction === "rtl";
    next = (at + (backwards ? -step : step) + radios.length) % radios.length;
  } else if (event.key === "Home") {
    next = 0;
  } else if (event.key === "End") {
    next = radios.length - 1;
  } else {
    return;
  }
  event.preventDefault();
  const radio = radios[next];
  if (radio === undefined) return;
  // Tab leaves from the radio the arrows reached, not from the chosen one
  // behind it, and comes back to it.
  for (const one of radios) one.tabIndex = one === radio ? 0 : -1;
  radio.focus();
  if (choose) radio.click();
}

/**
 * The one radio of a group that Tab reaches: the chosen one, or the first
 * while none is chosen. The arrows reach the others.
 */
export const radioTabIndex = (checked: boolean, first: boolean, noneChecked: boolean): number =>
  checked || (first && noneChecked) ? 0 : -1;
