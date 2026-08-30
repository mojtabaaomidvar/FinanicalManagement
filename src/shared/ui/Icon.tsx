/* آیکون SVG — استفاده از sprite داخل index.html */

export function Icon({
  name,
  size = 22,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      viewBox="0 0 24 24"
    >
      <use href={`#${name}`} />
    </svg>
  );
}
