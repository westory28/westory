import React, { useMemo, useState } from "react";
import QuizVisualPassageEditor from "../../src/pages/teacher/components/QuizVisualPassageEditor";
import QuizPassage from "../../src/components/common/QuizPassage";
import {
  createQuizVisualFragment,
  importQuizVisualHtml,
  parseQuizVisualDocument,
  readQuizVisualDom,
  serializeQuizVisualDocument,
} from "../../src/pages/teacher/components/quizVisualDocument";

const sample =
  "{{box:(가)}} 왕은 {{u:불교를 수용}}하고 왕권을 강화하였다.\n{{bullet}}사찰과 탑을 세웠다.\n{{bullet}}통치 이념을 정비하였다.\n그 왕의 이름은 {{blank:소수림왕}}이다.";
const runDomChecks = () => {
  const results: string[] = [];
  const check = (name: string, actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(
        `${name}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`,
      );
    results.push(name);
  };
  for (const value of [
    sample,
    "",
    "앞\n\n뒤\n",
    "{{bullet}}\n다음 줄",
    "{{blank:}} {{box:}}",
    "{{box:(가)}}{{box:(나)}}와 {{blank:가}}{{blank:나}}",
    "<img src=x onerror=alert(1)> 안전한 문자열",
  ]) {
    const host = document.createElement("div");
    host.appendChild(createQuizVisualFragment(parseQuizVisualDocument(value)));
    check(
      "DOM round trip",
      serializeQuizVisualDocument(readQuizVisualDom(host)),
      value,
    );
  }
  const input =
    '<p onclick="alert(1)">불교 <u>수용</u><img src="https://example.invalid/should-not-load" onerror="alert(1)"></p><script>alert(1)</script><style>body{display:none}</style><iframe srcdoc="<script>alert(1)</script>"></iframe><svg onload="alert(1)"><text>SVG</text></svg><p><a href="javascript:alert(1)">통치</a></p>';
  const imported = importQuizVisualHtml(input);
  check(
    "XSS/URL elements are discarded",
    serializeQuizVisualDocument(imported),
    "불교 {{u:수용}}\n통치",
  );
  const host = document.createElement("div");
  host.appendChild(createQuizVisualFragment(imported));
  check(
    "Only safe editor DOM is constructed",
    host.querySelectorAll(
      "script,style,img,iframe,svg,a,[onclick],[onerror],[src],[href]",
    ).length,
    0,
  );
  check(
    "HTML bullets and underline",
    serializeQuizVisualDocument(
      importQuizVisualHtml(
        "<ul><li>첫 <u>자료</u></li><li>둘째 자료</li></ul>",
      ),
    ),
    "{{bullet}}첫 {{u:자료}}\n{{bullet}}둘째 자료",
  );
  check(
    "HTML box without styles/attributes",
    serializeQuizVisualDocument(
      importQuizVisualHtml(
        '<p><span style="border:1px solid black;background:url(https://example.invalid/x)" data-unsafe="x">(나)</span></p>',
      ),
    ),
    "{{box:(나)}}",
  );
  check(
    "Empty paragraphs",
    serializeQuizVisualDocument(
      importQuizVisualHtml("<p>앞</p><p><br></p><p>뒤</p>"),
    ),
    "앞\n\n뒤",
  );
  check(
    "Adjacent HTML boxes",
    serializeQuizVisualDocument(
      importQuizVisualHtml(
        '<span style="border:1px solid">가</span><span style="border:1px solid">나</span>',
      ),
    ),
    "{{box:가}}{{box:나}}",
  );
  check(
    "Adjacent blank DOM",
    serializeQuizVisualDocument(
      importQuizVisualHtml(
        '<span data-quiz-mark="blank">가</span><span data-quiz-mark="blank">나</span>',
      ),
    ),
    "{{blank:가}}{{blank:나}}",
  );
  return results.length;
};
export default function QuizVisualEditorFixture() {
  const [value, setValue] = useState(sample);
  const [saved, setSaved] = useState("");
  const [revision, setRevision] = useState(0);
  const checks = useMemo(() => {
    try {
      return `PASS ${runDomChecks()} DOM / paste safety checks`;
    } catch (error) {
      return `FAIL ${String(error)}`;
    }
  }, []);
  return (
    <main className="quiz-authoring-surface mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-2xl font-bold">지문 시각 편집 검증</h1>
      <p role="status">{checks}</p>
      <QuizVisualPassageEditor
        key={revision}
        value={value}
        onChange={setValue}
        label="검증 지문"
        allowBlank
      />
      <div className="flex gap-2">
        <button
          className="min-h-11 rounded border p-2"
          onClick={() => setSaved(value)}
        >
          로컬 저장
        </button>
        <button
          className="min-h-11 rounded border p-2"
          disabled={!saved}
          onClick={() => {
            setValue(saved);
            setRevision((v) => v + 1);
          }}
        >
          저장본 다시 열기
        </button>
        <button
          className="min-h-11 rounded border p-2"
          onClick={() => {
            setValue(sample);
            setRevision((v) => v + 1);
          }}
        >
          기존 문항 불러오기
        </button>
      </div>
      <h2 className="font-bold">학생 미리보기</h2>
      <QuizPassage value={value} />
      <details>
        <summary>검증용 저장 형식</summary>
        <pre aria-label="저장 형식" className="whitespace-pre-wrap break-all">
          {value}
        </pre>
        <output aria-label="로컬 저장 결과">{saved}</output>
      </details>
    </main>
  );
}
