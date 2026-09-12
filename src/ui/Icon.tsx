interface IconProps {
  name: string;
  label?: string;
  className?: string;
}

export function Icon({ name, label, className }: IconProps) {
  const classes = className ? `ms ${className}` : "ms";
  if (label === undefined) {
    return (
      <span className={classes} aria-hidden="true">
        {name}
      </span>
    );
  }
  return (
    <span className={classes} role="img" aria-label={label}>
      {name}
    </span>
  );
}
