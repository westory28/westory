export default function AtlasFilterReset({ onReset }: { onReset: () => void }) {
  return (
    <button
      type="button"
      className="atlas-filter-reset"
      aria-label="지도 필터 초기화"
      title="필터 초기화"
      onClick={onReset}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6" />
      </svg>
    </button>
  );
}
