import riverDataUrl from "../../data/atlas/rivers-supplement.json?url";
import riverSourcesUrl from "../../data/atlas/rivers-supplement.sources.json?url";

const riverDownloads = {
  data: {
    url: riverDataUrl,
    filename: "westory-rivers.geojson",
    label: "하천 가공 데이터 · GeoJSON",
  },
  sources: {
    url: riverSourcesUrl,
    filename: "westory-river-sources.json",
    label: "하천 출처·가공 기록 · JSON",
  },
} as const;

export function AtlasRiverCreditLink({
  kind,
}: {
  kind: keyof typeof riverDownloads;
}) {
  const download = riverDownloads[kind];
  return (
    <a href={download.url} download={download.filename}>
      {download.label}
    </a>
  );
}

/** URL imports publish both ODbL-derived data and provenance with the app. */
export const atlasRiverCreditItems = [
  <AtlasRiverCreditLink kind="data" key="river-data" />,
  <AtlasRiverCreditLink kind="sources" key="river-sources" />,
];
