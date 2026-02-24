
type SpinnerProps = {
  /** Tailwind text color controls spinner color via `currentColor` (e.g. "text-white") */
  className?: string;
  /** Size in px (matches your 80 by default) */
  size?: number;
};

export function Spinner({ className = "", size = 38 }: SpinnerProps) {
  // 12 segments
  const segments = Array.from({ length: 12 });

  return (
    <div
      className={[
        "relative inline-block",
        // color comes from currentColor (Tailwind text-* classes)
        className,
      ].join(" ")}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    >
      {segments.map((_, i) => (
        <div
          key={i}
          className="absolute inset-0"
          style={{
            transform: `rotate(${i * 30}deg)`,
            transformOrigin: "50% 50%",
            animation: "lds-spinner 1.2s linear infinite",
            animationDelay: `${-1.1 + i * 0.1}s`,
          }}
        >
          {/* This is the `:after` bar */}
          <span
            className="absolute block"
            style={{
              top: `${(3.2 / 80) * size}px`,
              left: `${(36.8 / 80) * size}px`,
              width: `${(6.4 / 80) * size}px`,
              height: `${(17.6 / 80) * size}px`,
              borderRadius: "20%",
              background: "currentColor",
            }}
          />
        </div>
      ))}

      {/* Keyframes (scoped to this component) */}
      <style>{`
        @keyframes lds-spinner {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}