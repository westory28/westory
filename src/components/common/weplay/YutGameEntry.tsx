import { lazy, Suspense, useState } from "react";
import { useSearchParams } from "react-router-dom";
import WeplayStudioIntro from "./WeplayStudioIntro";

const YutGame = lazy(() => import("./yut/YutGame"));

export default function YutGameEntry({
  portal,
}: {
  portal: "student" | "teacher";
}) {
  const [introduced, setIntroduced] = useState(false);
  const [params, setParams] = useSearchParams();
  if (!introduced) {
    return <WeplayStudioIntro onComplete={() => setIntroduced(true)} />;
  }
  return (
    <Suspense fallback={<p role="status">윷판을 준비하고 있습니다.</p>}>
      <YutGame
        portal={portal}
        preview={portal === "teacher" && params.get("view") === "preview"}
        onBack={() => setParams({})}
      />
    </Suspense>
  );
}
