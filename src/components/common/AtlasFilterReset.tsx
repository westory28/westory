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
        <path d="M4 4h16l-6 7v6l-4 3v-9L4 4Z" />
        <path d="m17 15 5 5m0-5-5 5" />
      </svg>
    </button>
  );
}
