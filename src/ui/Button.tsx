import type { ReactNode } from "react";
import { Icon } from "./Icon";
import "./Button.css";

type Variant = "filled" | "tonal" | "text";

interface CommonProps {
  variant?: Variant;
  icon?: string;
  children: ReactNode;
  className?: string;
}

interface LinkProps extends CommonProps {
  href: string;
  external?: boolean;
}

interface ClickProps extends CommonProps {
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}

export type ButtonProps = LinkProps | ClickProps;

const classesOf = (variant: Variant, className?: string) =>
  ["btn", `btn--${variant}`, className].filter(Boolean).join(" ");

export function Button(props: ButtonProps) {
  const { variant = "text", icon, children, className } = props;
  const content = (
    <>
      {icon !== undefined && <Icon name={icon} className="btn__icon" />}
      <span>{children}</span>
    </>
  );

  if ("href" in props) {
    const external = props.external ?? /^https?:/.test(props.href);
    return (
      <a
        className={classesOf(variant, className)}
        href={props.href}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener" : undefined}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      className={classesOf(variant, className)}
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {content}
    </button>
  );
}
