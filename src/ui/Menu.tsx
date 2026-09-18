import { useEffect, useRef, type ReactNode } from "react";

interface MenuProps {
  /** What the button is for; it usually shows only an icon or a face. */
  label: string;
  button: ReactNode;
  buttonClassName?: string;
  children: ReactNode;
}

/**
 * A menu that behaves the way people expect one to: a press anywhere else
 * closes it, so does Escape, and so does choosing something in it. A bare
 * <details> does none of that, and two of them open at once sat on top of
 * each other.
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

  const close = () => {
    if (details.current !== null) details.current.open = false;
  };

  return (
    <details className="menu" ref={details}>
      <summary className={buttonClassName} aria-label={label}>
        {button}
      </summary>
      <ul className="menu__list" onClick={close}>
        {children}
      </ul>
    </details>
  );
}
