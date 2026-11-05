import {
  useEffect,
  useRef,
  type FocusEvent,
  type KeyboardEvent as KeyEvent,
  type ReactNode,
} from "react";

interface MenuProps {
  /** What the button is for; it usually shows only an icon or a face. */
  label: string;
  button: ReactNode;
  buttonClassName?: string;
  children: ReactNode;
}

/**
 * A menu that behaves the way people expect one to: a press anywhere else
 * closes it, so does Escape, so does Tab leaving it, and so does choosing
 * something in it. A bare <details> does none of that, and two of them open
 * at once sat on top of each other.
 */
export function Menu({ label, button, buttonClassName = "menu__button", children }: MenuProps) {
  const details = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const onPress = (event: Event) => {
      const menu = details.current;
      if (menu === null || !menu.open) return;
      if (event.target instanceof Node && menu.contains(event.target)) return;
      menu.open = false;
    };
    const onKey = (event: KeyboardEvent) => {
      const menu = details.current;
      if (event.key !== "Escape" || menu === null || !menu.open) return;
      menu.open = false;
      menu.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", onPress);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPress);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Choosing hides the item chosen, and the focus would fall to the page:
  // it goes back to the menu's button instead, which is also where a dialog
  // the item opened hands it back when it closes.
  const close = () => {
    const menu = details.current;
    if (menu === null) return;
    const hadFocus = menu.contains(document.activeElement);
    menu.open = false;
    if (hadFocus) menu.querySelector("summary")?.focus();
  };

  // Left open behind the focus, the list would cover the controls Tab goes on to.
  // Only Tab counts: Safari moves the focus off a menu item that is clicked,
  // and the menu closed under the click before it was chosen.
  const tabbing = useRef(false);
  const onKeyDown = (event: KeyEvent<HTMLDetailsElement>) => {
    tabbing.current = event.key === "Tab";
  };
  const onBlur = (event: FocusEvent<HTMLDetailsElement>) => {
    const menu = details.current;
    const next = event.relatedTarget;
    if (!tabbing.current) return;
    tabbing.current = false;
    if (menu !== null && next instanceof Node && !menu.contains(next)) menu.open = false;
  };

  return (
    <details className="menu" ref={details} onKeyDown={onKeyDown} onBlur={onBlur}>
      <summary className={buttonClassName} aria-label={label}>
        {button}
      </summary>
      <ul className="menu__list" onClick={close}>
        {children}
      </ul>
    </details>
  );
}
