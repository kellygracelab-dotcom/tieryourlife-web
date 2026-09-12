import "./Skeleton.css";

interface SkeletonProps {
  width?: string;
  height?: string;
  className?: string;
}

export function Skeleton({ width = "100%", height = "1em", className }: SkeletonProps) {
  return (
    <span
      className={className ? `skeleton ${className}` : "skeleton"}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
