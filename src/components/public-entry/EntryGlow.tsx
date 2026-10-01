/** A soft local light replaces the cross-page travelling line. */
export default function EntryGlow({
  variant = "wrap",
}: {
  variant?: "hero" | "wide" | "wrap" | "left" | "finish";
}) {
  return (
    <span
      className="entry-section-glow"
      data-glow-variant={variant}
      aria-hidden="true"
    />
  );
}
