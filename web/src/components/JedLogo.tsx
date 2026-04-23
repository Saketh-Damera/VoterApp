import Link from "next/link";

type Props = {
  size?: "sm" | "md" | "lg";
  href?: string;
};

export default function JedLogo({ size = "md", href = "/" }: Props) {
  const sizeClass =
    size === "lg" ? "text-5xl" : size === "md" ? "text-3xl" : "text-xl";

  const content = (
    <span className={`inline-flex items-baseline ${sizeClass} leading-none select-none`}>
      <span
        className="text-[var(--color-primary)]"
        style={{ fontFamily: "var(--font-logo-j)", fontStyle: "italic", fontWeight: 900 }}
      >
        J
      </span>
      <span
        className="text-[var(--color-accent)] mx-[0.05em]"
        style={{ fontFamily: "var(--font-logo-e)", letterSpacing: "-0.02em" }}
      >
        E
      </span>
      <span
        className="text-[var(--color-ink)]"
        style={{ fontFamily: "var(--font-logo-d)", letterSpacing: "-0.04em" }}
      >
        D
      </span>
    </span>
  );

  if (!href) return content;
  return (
    <Link href={href} className="inline-block" aria-label="JED home">
      {content}
    </Link>
  );
}
