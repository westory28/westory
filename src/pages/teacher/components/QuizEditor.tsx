import React, { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../../lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useAuth } from "../../../contexts/AuthContext";
import {
  getAssessmentSemesterId,
  refreshPublishedQuizDefinitions,
} from "../../../lib/assessmentRelease";
import { executeAssessmentManagementCommand } from "../../../lib/assessmentLifecycle";
import { LoadingOverlay } from "../../../components/common/LoadingState";
import QuizPassage from "../../../components/common/QuizPassage";
import QuizQuestionText from "../../../components/common/QuizQuestionText";
import {
  getSemesterCollectionPath,
  getYearSemester,
} from "../../../lib/semesterScope";
import {
  QUIZ_CHOICE_OPTION_IMAGES_TOTAL_MAX_BYTES,
  QUIZ_CHOICE_OPTION_IMAGE_OPTIONS,
  QUIZ_MATCHING_IMAGE_OPTIONS,
  QUIZ_QUESTION_IMAGE_OPTIONS,
  getQuizImageDataUrlBytes,
  optimizeQuizImageDataUrl,
  optimizeQuizImageFile,
} from "../../../lib/quizImageCompression";
import QuizVisualPassageEditor from "./QuizVisualPassageEditor";
import QuizTextField from "./QuizTextField";
import QuizLearningMetadataFields, {
  normalizeQuizLearningMetadata,
  validateQuizLearningMetadata,
  type QuizLearningMetadata,
} from "./QuizLearningMetadataFields";
import { useQuizDialog } from "./useQuizDialog";
import { hasQuizDerivationContentChange } from "./quizDerivation";
import "./QuizWorkspace.css";

interface TreeUnit {
  id: string;
  title: string;
  children?: TreeUnit[];
}

type QuestionType = "choice" | "ox" | "word" | "order" | "matching";

interface MatchingPair {
  left: string;
  right: string;
  rightImage?: string | null;
}

type ChoiceOptionImage = string | null;

export interface QuizQuestionDraft extends QuizLearningMetadata {
  contentRevision?: number;
  id: number;
  unitId: string;
  subUnitId?: string | null;
  category: string;
  type: QuestionType;
  question: string;
  options?: string[];
  choiceOptionImages?: ChoiceOptionImage[];
  answer: string;
  matchingPairs?: MatchingPair[];
  explanation?: string;
  image?: string | null;
  passage?: string | null;
  hintEnabled?: boolean;
  hint?: string;
  refBig?: string;
  refMid?: string;
  refSmall?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}
type Question = QuizQuestionDraft;

interface QuizEditorProps {
  node: { id: string; title: string };
  type: "special" | "normal";
  parentTitle?: string;
  treeData: TreeUnit[];
  canEdit: boolean;
  onOpenSettings: (category: string) => void;
  sourceQuestion?: QuizQuestionDraft | null;
}

interface CascadingFilter {
  big: string;
  mid: string;
  small: string;
}

const ORDER_DELIMITER = "||";
const MATCHING_PAIR_DELIMITER = "=>";
const UNASSIGNED_SUB_UNIT_FILTER = "__unassigned__";
const DEFAULT_CHOICE_OPTION_COUNT = 5;
const EXAM_PREP_CHOICE_OPTION_COUNT = 5;
const DEFAULT_ORDER_OPTION_COUNT = 4;
const getDefaultChoiceOptionCount = (category?: string) =>
  category === "exam_prep"
    ? EXAM_PREP_CHOICE_OPTION_COUNT
    : DEFAULT_CHOICE_OPTION_COUNT;
const createDefaultChoiceOptionItems = (category?: string) =>
  Array.from({ length: getDefaultChoiceOptionCount(category) }, () => "");
const createDefaultChoiceOptionImages = (category?: string) =>
  Array.from(
    { length: getDefaultChoiceOptionCount(category) },
    () => null as ChoiceOptionImage,
  );
const createDefaultOrderItems = () =>
  Array.from({ length: DEFAULT_ORDER_OPTION_COUNT }, () => "");
const createDefaultMatchingPairs = () =>
  Array.from({ length: 3 }, () => ({ left: "", right: "", rightImage: null }));
const TYPE_LABEL: Record<QuestionType, string> = {
  choice: "객관식",
  ox: "O/X",
  word: "단답형",
  order: "순서 나열형",
  matching: "단어 연결하기",
};
const supportsQuestionPassage = (questionType: QuestionType) =>
  questionType === "choice" || questionType === "word";
const isGeneratedImageChoiceLabel = (value: string, index: number) => {
  const match = value.trim().match(/^(\d+)\s*번\s*보기$/);
  return Boolean(match && Number(match[1]) === index + 1);
};

const EMPTY_CASCADING_FILTER: CascadingFilter = {
  big: "",
  mid: "",
  small: "",
};

const getTimestampMs = (value: unknown) => {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return value.getTime();
  const timestampLike = value as {
    toDate?: () => Date;
    seconds?: number;
    nanoseconds?: number;
  };
  if (typeof timestampLike.toDate === "function") {
    const date = timestampLike.toDate();
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }
  if (typeof timestampLike.seconds === "number") {
    return (
      timestampLike.seconds * 1000 +
      Math.floor((Number(timestampLike.nanoseconds) || 0) / 1_000_000)
    );
  }
  return 0;
};

const shuffle = <T,>(input: T[]): T[] => {
  const list = [...input];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

const QuizEditor: React.FC<QuizEditorProps> = ({
  node,
  type,
  parentTitle,
  treeData,
  canEdit,
  onOpenSettings,
  sourceQuestion,
}) => {
  const { config } = useAuth();
  const { year: questionYear, semester: questionSemester } =
    getYearSemester(config);
  const [questions, setQuestions] = useState<Question[]>([]);
  const pendingQuestionId = useRef<number | null>(null);
  const [category, setCategory] = useState<string>("diagnostic");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [questionSearch, setQuestionSearch] = useState("");
  const [normalSubUnitFilter, setNormalSubUnitFilter] = useState("");
  const [metadata, setMetadata] = useState<QuizLearningMetadata>({});
  const [derivationSource, setDerivationSource] = useState<Question | null>(
    null,
  );
  const [answerReviewed, setAnswerReviewed] = useState(false);
  const [formError, setFormError] = useState("");
  const formErrorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (formError) formErrorRef.current?.focus();
  }, [formError]);
  const [epFilter, setEpFilter] = useState<CascadingFilter>(
    EMPTY_CASCADING_FILTER,
  );
  const [epSource, setEpSource] = useState<CascadingFilter>(
    EMPTY_CASCADING_FILTER,
  );

  const [formType, setFormType] = useState<QuestionType>("choice");
  const [formText, setFormText] = useState("");
  const [formExp, setFormExp] = useState("");
  const [formImage, setFormImage] = useState<string | null>(null);
  const [formPassage, setFormPassage] = useState("");
  const [formSubUnit, setFormSubUnit] = useState("");
  const [choiceOptions, setChoiceOptions] = useState<string[]>(
    createDefaultChoiceOptionItems(type === "special" ? "exam_prep" : ""),
  );
  const [choiceOptionImages, setChoiceOptionImages] = useState<
    ChoiceOptionImage[]
  >(createDefaultChoiceOptionImages(type === "special" ? "exam_prep" : ""));
  const [choiceAnswerIndex, setChoiceAnswerIndex] = useState<number | null>(
    null,
  );
  const [oxAnswer, setOxAnswer] = useState<"O" | "X" | "">("");
  const [wordAnswer, setWordAnswer] = useState("");
  const [orderItems, setOrderItems] = useState<string[]>(
    createDefaultOrderItems(),
  );
  const [matchingPairs, setMatchingPairs] = useState<MatchingPair[]>(
    createDefaultMatchingPairs(),
  );
  const [hintEnabled, setHintEnabled] = useState(false);
  const [hintText, setHintText] = useState("");

  const [previewOpen, setPreviewOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (previewOpen) previewRef.current?.focus();
  }, [previewOpen]);
  const [previewChoiceAnswer, setPreviewChoiceAnswer] = useState("");
  const [previewOxAnswer, setPreviewOxAnswer] = useState("");
  const [previewWordAnswer, setPreviewWordAnswer] = useState("");
  const [previewOrderPool, setPreviewOrderPool] = useState<string[]>([]);
  const [previewOrderAnswer, setPreviewOrderAnswer] = useState<string[]>([]);
  const [previewMatchingOptions, setPreviewMatchingOptions] = useState<
    MatchingPair[]
  >([]);
  const [previewMatchingAnswer, setPreviewMatchingAnswer] = useState<
    Record<string, string>
  >({});
  const [previewMatchingActiveLeft, setPreviewMatchingActiveLeft] =
    useState("");
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(
    null,
  );
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [optimizingImageCount, setOptimizingImageCount] = useState(0);
  const optimizingImage = optimizingImageCount > 0;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const savingQuestionRef = useRef(false);
  const defaultExamPrepFocusKeyRef = useRef("");
  const composerDialogRef = useRef<HTMLDivElement>(null);
  useQuizDialog(isComposerOpen, composerDialogRef, () => closeComposer());

  useEffect(() => {
    if (type === "special") {
      setCategory("exam_prep");
    } else {
      setCategory("diagnostic");
    }
    setEpFilter(EMPTY_CASCADING_FILTER);
    setNormalSubUnitFilter("");
    setEpSource(EMPTY_CASCADING_FILTER);
    defaultExamPrepFocusKeyRef.current = "";
    void fetchQuestions();
  }, [questionYear, questionSemester, node.id, type]);

  const fetchQuestions = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const scopedRef = collection(
        db,
        getSemesterCollectionPath(config, "quiz_questions"),
      );
      const snap = await getDocs(
        query(scopedRef, where("unitId", "==", node.id)),
      );
      const list: Question[] = [];
      snap.forEach((d) => {
        list.push({
          id: parseInt(d.id, 10),
          ...(d.data() as Omit<Question, "id">),
        });
      });
      setQuestions(list);
    } catch (error) {
      setLoadError("문제를 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const allBigUnits = useMemo(() => treeData, [treeData]);
  const filterMidUnits = useMemo(
    () => allBigUnits.find((big) => big.id === epFilter.big)?.children || [],
    [allBigUnits, epFilter.big],
  );
  const filterSmallUnits = useMemo(
    () => filterMidUnits.find((mid) => mid.id === epFilter.mid)?.children || [],
    [filterMidUnits, epFilter.mid],
  );
  const sourceMidUnits = useMemo(
    () => allBigUnits.find((big) => big.id === epSource.big)?.children || [],
    [allBigUnits, epSource.big],
  );
  const sourceSmallUnits = useMemo(
    () => sourceMidUnits.find((mid) => mid.id === epSource.mid)?.children || [],
    [sourceMidUnits, epSource.mid],
  );
  const normalSubUnits = useMemo(
    () =>
      treeData
        .flatMap((big) => big.children || [])
        .find((mid) => mid.id === node.id)?.children || [],
    [treeData, node.id],
  );
  const normalSubUnitIds = useMemo(
    () => new Set(normalSubUnits.map((unit) => unit.id)),
    [normalSubUnits],
  );
  const findNodeTitle = (targetId?: string | null) => {
    if (!targetId) return "";
    for (const big of treeData) {
      if (big.id === targetId) return big.title;
      for (const mid of big.children || []) {
        if (mid.id === targetId) return mid.title;
        for (const small of mid.children || []) {
          if (small.id === targetId) return small.title;
        }
      }
    }
    return "";
  };
  const treeLookup = useMemo(() => {
    const bigIds = new Set<string>();
    const midToBig: Record<string, string> = {};
    const smallToMid: Record<string, string> = {};
    const smallToBig: Record<string, string> = {};

    treeData.forEach((big) => {
      bigIds.add(big.id);
      (big.children || []).forEach((mid) => {
        midToBig[mid.id] = big.id;
        (mid.children || []).forEach((small) => {
          smallToMid[small.id] = mid.id;
          smallToBig[small.id] = big.id;
        });
      });
    });

    return { bigIds, midToBig, smallToMid, smallToBig };
  }, [treeData]);

  const normalizeCascadingFilter = (value: CascadingFilter) => {
    const small = value.small || "";
    const mid = value.mid || (small ? treeLookup.smallToMid[small] || "" : "");
    const big =
      value.big ||
      (small ? treeLookup.smallToBig[small] || "" : "") ||
      (mid ? treeLookup.midToBig[mid] || "" : "");

    if (big && !treeLookup.bigIds.has(big)) return EMPTY_CASCADING_FILTER;
    if (mid && treeLookup.midToBig[mid] !== big) {
      return big ? { big, mid: "", small: "" } : EMPTY_CASCADING_FILTER;
    }
    if (small && (treeLookup.smallToMid[small] !== mid || !mid)) {
      return { big, mid, small: "" };
    }

    return { big, mid, small };
  };

  const recentExamPrepFocus = useMemo(() => {
    if (type !== "special") return EMPTY_CASCADING_FILTER;
    const latest = questions
      .filter((question) => question.category === "exam_prep")
      .slice()
      .sort((a, b) => {
        const aMs = getTimestampMs(a.createdAt) || Number(a.id) || 0;
        const bMs = getTimestampMs(b.createdAt) || Number(b.id) || 0;
        return bMs - aMs;
      })[0];

    if (!latest) return EMPTY_CASCADING_FILTER;
    return normalizeCascadingFilter({
      big: latest.refBig || "",
      mid: latest.refMid || "",
      small: latest.refSmall || "",
    });
  }, [questions, treeLookup, type]);

  const recentNormalSubUnit = useMemo(() => {
    if (type === "special") return "";
    const validSubUnitIds = new Set(normalSubUnits.map((unit) => unit.id));
    const latest = questions
      .filter(
        (question) =>
          question.category === category &&
          question.subUnitId &&
          validSubUnitIds.has(question.subUnitId),
      )
      .slice()
      .sort((a, b) => {
        const aMs = getTimestampMs(a.createdAt) || Number(a.id) || 0;
        const bMs = getTimestampMs(b.createdAt) || Number(b.id) || 0;
        return bMs - aMs;
      })[0];

    return latest?.subUnitId || "";
  }, [category, normalSubUnits, questions, type]);

  useEffect(() => {
    if (type !== "special") return;
    const nextKey = [
      node.id,
      recentExamPrepFocus.big,
      recentExamPrepFocus.mid,
      recentExamPrepFocus.small,
    ].join("|");
    if (defaultExamPrepFocusKeyRef.current === nextKey) return;
    defaultExamPrepFocusKeyRef.current = nextKey;
    setEpFilter(recentExamPrepFocus);
    setEpSource(recentExamPrepFocus);
  }, [
    node.id,
    recentExamPrepFocus.big,
    recentExamPrepFocus.mid,
    recentExamPrepFocus.small,
    type,
  ]);

  const getQuestionSubUnitLabel = (question: Question) => {
    if (type === "special") {
      const sourceId =
        question.refSmall ||
        question.refMid ||
        question.refBig ||
        question.subUnitId ||
        "";
      return findNodeTitle(sourceId) || "소단원 전체";
    }
    return findNodeTitle(question.subUnitId || "") || "소단원 미지정";
  };

  const searchedQuestions = useMemo(() => {
    const search = questionSearch.trim().toLowerCase();
    if (!search) return questions;
    return questions.filter((question) =>
      [
        question.question,
        question.explanation,
        question.passage,
        ...(question.concepts || []),
      ]
        .join(" ")
        .toLowerCase()
        .includes(search),
    );
  }, [questions, questionSearch]);
  const subUnitQuestionCounts = useMemo(
    () =>
      searchedQuestions.reduce<Record<string, number>>((counts, question) => {
        if (question.category !== category) return counts;
        const id =
          question.subUnitId && normalSubUnitIds.has(question.subUnitId)
            ? question.subUnitId
            : UNASSIGNED_SUB_UNIT_FILTER;
        counts[id] = (counts[id] || 0) + 1;
        return counts;
      }, {}),
    [searchedQuestions, category, normalSubUnitIds],
  );
  const totalSubUnitQuestionCount = Object.values(subUnitQuestionCounts).reduce(
    (total, count) => total + count,
    0,
  );
  const hasUnassignedQuestions = questions.some(
    (question) => !normalSubUnitIds.has(question.subUnitId || ""),
  );
  const matchesNormalSubUnit = (question: Question) => {
    if (!normalSubUnitFilter) return true;
    return normalSubUnitFilter === UNASSIGNED_SUB_UNIT_FILTER
      ? !normalSubUnitIds.has(question.subUnitId || "")
      : question.subUnitId === normalSubUnitFilter;
  };
  const filteredQuestions = useMemo(() => {
    const list = searchedQuestions.filter((q) => {
      if (q.category !== category) return false;
      if (type !== "special") return matchesNormalSubUnit(q);
      if (epFilter.big && q.refBig !== epFilter.big) return false;
      if (epFilter.mid && q.refMid !== epFilter.mid) return false;
      if (epFilter.small && q.refSmall !== epFilter.small) return false;
      return true;
    });
    return list.sort((a, b) => a.id - b.id);
  }, [
    category,
    epFilter.big,
    epFilter.mid,
    epFilter.small,
    searchedQuestions,
    type,
    normalSubUnitFilter,
    normalSubUnitIds,
  ]);
  const categoryQuestionCounts = useMemo(
    () =>
      questions.reduce<Record<string, number>>((counts, question) => {
        if (type !== "special" && !matchesNormalSubUnit(question))
          return counts;
        counts[question.category] = (counts[question.category] || 0) + 1;
        return counts;
      }, {}),
    [questions, type, normalSubUnitFilter, normalSubUnitIds],
  );

  const trimList = (values: string[]) =>
    values.map((v) => v.trim()).filter(Boolean);
  const normalizeChoiceOptionImages = (
    images: ChoiceOptionImage[] | undefined,
    targetLength: number,
  ) =>
    Array.from({ length: targetLength }, (_, index) => images?.[index] || null);
  const getChoiceOptionItems = (
    options: string[],
    images: ChoiceOptionImage[],
  ) =>
    options
      .map((value, index) => ({
        text: value.trim() || (images[index] ? `${index + 1}번 보기` : ""),
        image: images[index] || null,
        sourceIndex: index,
      }))
      .filter((item) => item.text);
  const trimMatchingPairs = (values: MatchingPair[]) =>
    values
      .map((pair) => ({
        left: pair.left.trim(),
        right: pair.right.trim(),
        rightImage: pair.rightImage || null,
      }))
      .filter((pair) => pair.left && pair.right);
  const encodeMatchingAnswer = (values: MatchingPair[]) =>
    trimMatchingPairs(values)
      .map((pair) => `${pair.left}${MATCHING_PAIR_DELIMITER}${pair.right}`)
      .join(ORDER_DELIMITER);
  const parseMatchingAnswer = (question: Question): MatchingPair[] => {
    if (
      Array.isArray(question.matchingPairs) &&
      question.matchingPairs.length > 0
    ) {
      return question.matchingPairs.map((pair) => ({
        left: String(pair.left || ""),
        right: String(pair.right || ""),
        rightImage: pair.rightImage || null,
      }));
    }
    return String(question.answer || "")
      .split(ORDER_DELIMITER)
      .map((item) => {
        const [left = "", right = ""] = item.split(MATCHING_PAIR_DELIMITER);
        return { left, right, rightImage: null };
      })
      .filter((pair) => pair.left || pair.right);
  };
  const resetPreview = () => {
    setPreviewChoiceAnswer("");
    setPreviewOxAnswer("");
    setPreviewWordAnswer("");
    setPreviewOrderAnswer([]);
    setPreviewMatchingAnswer({});
    setPreviewMatchingActiveLeft("");
  };

  const resetForm = () => {
    setFormError("");
    setMetadata({});
    setDerivationSource(null);
    setAnswerReviewed(false);
    pendingQuestionId.current = null;
    const defaultCategory = type === "special" ? "exam_prep" : category;
    setEditingQuestionId(null);
    setFormText("");
    setFormExp("");
    setFormImage(null);
    setFormPassage("");
    setChoiceOptions(createDefaultChoiceOptionItems(defaultCategory));
    setChoiceOptionImages(createDefaultChoiceOptionImages(defaultCategory));
    setChoiceAnswerIndex(null);
    setOxAnswer("");
    setWordAnswer("");
    setOrderItems(createDefaultOrderItems());
    setMatchingPairs(createDefaultMatchingPairs());
    setHintEnabled(false);
    setHintText("");
    setPreviewOpen(false);
    resetPreview();
    if (type !== "special") {
      setFormSubUnit(
        normalSubUnitIds.has(normalSubUnitFilter)
          ? normalSubUnitFilter
          : normalSubUnitFilter === UNASSIGNED_SUB_UNIT_FILTER
            ? ""
            : recentNormalSubUnit,
      );
    } else setEpSource(recentExamPrepFocus);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOptimizingImageCount((prev) => prev + 1);
    try {
      setFormImage(
        await optimizeQuizImageFile(file, QUIZ_QUESTION_IMAGE_OPTIONS),
      );
    } catch (error) {
      console.error("Quiz image optimization failed", error);
      alert(
        error instanceof Error
          ? error.message
          : "이미지 용량을 줄이지 못했습니다.",
      );
    } finally {
      setOptimizingImageCount((prev) => Math.max(0, prev - 1));
      e.currentTarget.value = "";
    }
  };

  const handleChoiceOptionImageSelect = (
    index: number,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOptimizingImageCount((prev) => prev + 1);
    optimizeQuizImageFile(file, QUIZ_CHOICE_OPTION_IMAGE_OPTIONS)
      .then((image) => {
        setChoiceOptionImages((prev) =>
          normalizeChoiceOptionImages(prev, choiceOptions.length).map(
            (current, imageIndex) => (imageIndex === index ? image : current),
          ),
        );
      })
      .catch((error) => {
        console.error("Quiz choice option image optimization failed", error);
        alert(
          error instanceof Error
            ? error.message
            : "이미지 용량을 줄이지 못했습니다.",
        );
      })
      .finally(() => {
        setOptimizingImageCount((prev) => Math.max(0, prev - 1));
        e.currentTarget.value = "";
      });
  };

  const handleMatchingImageSelect = (
    index: number,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOptimizingImageCount((prev) => prev + 1);
    optimizeQuizImageFile(file, QUIZ_MATCHING_IMAGE_OPTIONS)
      .then((rightImage) => {
        setMatchingPairs((prev) =>
          prev.map((pair, pairIndex) =>
            pairIndex === index ? { ...pair, rightImage } : pair,
          ),
        );
      })
      .catch((error) => {
        console.error("Quiz matching image optimization failed", error);
        alert(
          error instanceof Error
            ? error.message
            : "이미지 용량을 줄이지 못했습니다.",
        );
      })
      .finally(() => {
        setOptimizingImageCount((prev) => Math.max(0, prev - 1));
        e.currentTarget.value = "";
      });
  };

  const optimizeMatchingPairImages = async (pairs: MatchingPair[]) =>
    Promise.all(
      pairs.map(async (pair) => ({
        ...pair,
        rightImage: await optimizeQuizImageDataUrl(
          pair.rightImage,
          QUIZ_MATCHING_IMAGE_OPTIONS,
        ),
      })),
    );

  const optimizeChoiceOptionImages = async (images: ChoiceOptionImage[]) => {
    const optimized = await Promise.all(
      images.map((image) =>
        optimizeQuizImageDataUrl(image, QUIZ_CHOICE_OPTION_IMAGE_OPTIONS),
      ),
    );
    const totalBytes = optimized.reduce(
      (sum, image) => sum + getQuizImageDataUrlBytes(image),
      0,
    );
    if (totalBytes > QUIZ_CHOICE_OPTION_IMAGES_TOTAL_MAX_BYTES) {
      throw new Error(
        "객관식 보기 이미지 전체 용량이 큽니다. 일부 이미지를 제거하거나 더 단순한 이미지를 사용해 주세요.",
      );
    }
    return optimized;
  };

  const handleTypeChange = (nextType: QuestionType) => {
    setFormType(nextType);
    setPreviewOpen(false);
    resetPreview();
    if (
      nextType === "choice" &&
      getChoiceOptionItems(choiceOptions, choiceOptionImages).length === 0
    ) {
      const defaultCategory = type === "special" ? "exam_prep" : category;
      setChoiceOptions(createDefaultChoiceOptionItems(defaultCategory));
      setChoiceOptionImages(createDefaultChoiceOptionImages(defaultCategory));
    }
    if (nextType === "order" && trimList(orderItems).length === 0) {
      setOrderItems(createDefaultOrderItems());
    }
    if (
      nextType === "matching" &&
      trimMatchingPairs(matchingPairs).length === 0
    ) {
      setMatchingPairs(createDefaultMatchingPairs());
    }
  };

  const handleVerticalFocus = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!e.altKey) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const current = e.currentTarget as HTMLElement;
    const fields = Array.from(
      document.querySelectorAll<HTMLElement>(".quiz-compose-field"),
    ).filter((el) => el.offsetParent !== null && !el.hasAttribute("disabled"));
    const currentIndex = fields.indexOf(current);
    if (currentIndex < 0) return;
    const nextIndex =
      e.key === "ArrowDown" ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex < 0 || nextIndex >= fields.length) return;
    e.preventDefault();
    fields[nextIndex].focus();
  };

  const openCreateComposer = () => {
    resetForm();
    setIsComposerOpen(true);
  };

  const closeComposer = () => {
    if (optimizingImage || savingQuestion) return;
    setIsComposerOpen(false);
    resetForm();
  };

  const startEdit = (question: Question) => {
    setMetadata(question);
    setDerivationSource(null);
    setEditingQuestionId(question.id);
    setIsComposerOpen(true);
    setFormType(question.type);
    setFormText(question.question || "");
    setFormExp(question.explanation || "");
    setFormImage(question.image || null);
    setFormPassage(
      supportsQuestionPassage(question.type) ? question.passage || "" : "",
    );
    setPreviewOpen(false);
    resetPreview();
    setHintEnabled(!!(question.hintEnabled && question.hint));
    setHintText(question.hint || "");

    if (type === "normal") {
      setFormSubUnit(question.subUnitId || "");
    } else {
      setEpSource({
        big: question.refBig || "",
        mid: question.refMid || "",
        small: question.refSmall || "",
      });
    }

    if (question.type === "choice") {
      const options = (question.options || []).filter(Boolean);
      const normalizedOptions =
        options.length >= 2
          ? options
          : createDefaultChoiceOptionItems(question.category || category);
      setChoiceOptions(normalizedOptions);
      setChoiceOptionImages(
        normalizeChoiceOptionImages(
          question.choiceOptionImages,
          normalizedOptions.length,
        ),
      );
      const answerIndex = normalizedOptions.findIndex(
        (opt) => opt.trim() === String(question.answer).trim(),
      );
      setChoiceAnswerIndex(answerIndex >= 0 ? answerIndex : null);
      setOxAnswer("");
      setWordAnswer("");
      setOrderItems(createDefaultOrderItems());
      setMatchingPairs(createDefaultMatchingPairs());
      return;
    }

    if (question.type === "ox") {
      setChoiceOptions(
        createDefaultChoiceOptionItems(question.category || category),
      );
      setChoiceOptionImages(
        createDefaultChoiceOptionImages(question.category || category),
      );
      setChoiceAnswerIndex(null);
      setOxAnswer(
        question.answer === "O" || question.answer === "X"
          ? question.answer
          : "",
      );
      setWordAnswer("");
      setOrderItems(createDefaultOrderItems());
      setMatchingPairs(createDefaultMatchingPairs());
      return;
    }

    if (question.type === "word") {
      setChoiceOptions(
        createDefaultChoiceOptionItems(question.category || category),
      );
      setChoiceOptionImages(
        createDefaultChoiceOptionImages(question.category || category),
      );
      setChoiceAnswerIndex(null);
      setOxAnswer("");
      setWordAnswer(String(question.answer || ""));
      setOrderItems(createDefaultOrderItems());
      setMatchingPairs(createDefaultMatchingPairs());
      return;
    }

    if (question.type === "matching") {
      const pairs = parseMatchingAnswer(question);
      setChoiceOptions(
        createDefaultChoiceOptionItems(question.category || category),
      );
      setChoiceOptionImages(
        createDefaultChoiceOptionImages(question.category || category),
      );
      setChoiceAnswerIndex(null);
      setOxAnswer("");
      setWordAnswer("");
      setOrderItems(createDefaultOrderItems());
      setMatchingPairs(
        pairs.length >= 2 ? pairs : createDefaultMatchingPairs(),
      );
      return;
    }

    const orderOptions =
      question.options && question.options.length > 0
        ? question.options
        : String(question.answer || "")
            .split(ORDER_DELIMITER)
            .filter(Boolean);
    setChoiceOptions(
      createDefaultChoiceOptionItems(question.category || category),
    );
    setChoiceOptionImages(
      createDefaultChoiceOptionImages(question.category || category),
    );
    setChoiceAnswerIndex(null);
    setOxAnswer("");
    setWordAnswer("");
    setOrderItems(
      orderOptions.length >= 2 ? orderOptions : createDefaultOrderItems(),
    );
    setMatchingPairs(createDefaultMatchingPairs());
  };

  const startDerivedQuestion = (question: Question) => {
    startEdit(question);
    pendingQuestionId.current = null;
    setEditingQuestionId(null);
    setCategory(question.category);
    setDerivationSource(question);
    setAnswerReviewed(false);
    setMetadata({
      ...question,
      familyId: question.familyId || String(question.id),
      derivedFromQuestionId: String(question.id),
    });
  };

  useEffect(() => {
    if (sourceQuestion && canEdit) startDerivedQuestion(sourceQuestion);
  }, [sourceQuestion]);

  const addChoiceOption = () => {
    setChoiceOptions((prev) => [...prev, ""]);
    setChoiceOptionImages((prev) => [...prev, null]);
  };
  const removeChoiceOption = (index: number) => {
    if (choiceOptions.length <= 2) return;
    setChoiceOptions((prev) => prev.filter((_, i) => i !== index));
    setChoiceOptionImages((prev) => prev.filter((_, i) => i !== index));
    if (choiceAnswerIndex === index) setChoiceAnswerIndex(null);
    if (choiceAnswerIndex !== null && choiceAnswerIndex > index)
      setChoiceAnswerIndex(choiceAnswerIndex - 1);
  };
  const moveOrderItem = (index: number, direction: "up" | "down") => {
    setOrderItems((prev) => {
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const removeOrderItem = (index: number) => {
    if (orderItems.length <= 2) return;
    setOrderItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };
  const addMatchingPair = () =>
    setMatchingPairs((prev) => [
      ...prev,
      { left: "", right: "", rightImage: null },
    ]);
  const removeMatchingPair = (index: number) => {
    if (matchingPairs.length <= 2) return;
    setMatchingPairs((prev) =>
      prev.filter((_, pairIndex) => pairIndex !== index),
    );
  };

  const openPreview = () => {
    const opening = !previewOpen;
    setPreviewOpen(opening);
    resetPreview();
    if (opening && formType === "order")
      setPreviewOrderPool(shuffle(trimList(orderItems)));
    if (opening && formType === "matching")
      setPreviewMatchingOptions(shuffle(trimMatchingPairs(matchingPairs)));
  };

  const buildQuestionPayload = (): {
    answer: string;
    options: string[];
    choiceOptionImages?: ChoiceOptionImage[];
    matchingPairs?: MatchingPair[];
  } | null => {
    if (!formText.trim()) {
      alert("문제 내용을 입력하세요.");
      return null;
    }
    if (hintEnabled && !hintText.trim()) {
      alert("힌트 제공을 선택한 경우 힌트 내용을 입력하세요.");
      return null;
    }
    if (formType === "choice") {
      const optionItems = getChoiceOptionItems(
        choiceOptions,
        choiceOptionImages,
      );
      const options = optionItems.map((item) => item.text);
      const optionImages = optionItems.map((item) => item.image);
      if (options.length < 2)
        return (alert("객관식 보기는 최소 2개 이상 필요합니다."), null);
      if (choiceAnswerIndex === null)
        return (alert("객관식 정답 보기를 선택하세요."), null);
      const answer =
        optionItems.find((item) => item.sourceIndex === choiceAnswerIndex)
          ?.text || "";
      if (!answer)
        return (alert("정답으로 선택한 보기에 내용을 입력하세요."), null);
      return { answer, options, choiceOptionImages: optionImages };
    }
    if (formType === "ox") {
      if (!oxAnswer) return (alert("O/X 정답을 선택하세요."), null);
      return { answer: oxAnswer, options: ["O", "X"] };
    }
    if (formType === "word") {
      if (!wordAnswer.trim()) return (alert("단답형 정답을 입력하세요."), null);
      return { answer: wordAnswer.trim(), options: [] };
    }
    if (formType === "matching") {
      const pairs = trimMatchingPairs(matchingPairs);
      if (pairs.length < 2)
        return (alert("단어 연결하기 항목은 최소 2쌍 이상 필요합니다."), null);
      return {
        answer: encodeMatchingAnswer(pairs),
        options: pairs.map((pair) => pair.right),
        matchingPairs: pairs,
      };
    }
    const options = trimList(orderItems);
    if (options.length < 2)
      return (alert("순서 나열형 항목은 최소 2개 이상 필요합니다."), null);
    return { answer: options.join(ORDER_DELIMITER), options };
  };

  const handleAdd = async () => {
    if (!canEdit) return;
    if (savingQuestionRef.current) return;
    setFormError("");
    if (optimizingImage) {
      alert("이미지 용량을 줄이는 중입니다. 잠시 후 다시 저장해 주세요.");
      return;
    }
    const payload = buildQuestionPayload();
    if (!payload) return;
    const metadataError = validateQuizLearningMetadata(
      metadata,
      payload.options,
    );
    if (metadataError) {
      setFormError(metadataError);
      return;
    }
    if (derivationSource && !answerReviewed) {
      setFormError("파생 문항의 정답과 해설을 확인해 주세요.");
      return;
    }
    if (
      derivationSource &&
      !hasQuizDerivationContentChange(derivationSource, {
        type: formType,
        question: formText,
        passage: formPassage,
        image: formImage,
        ...payload,
      })
    ) {
      setFormError(
        "발문·자료·보기 중 하나 이상을 바꾸어 새로운 문항을 만들어 주세요.",
      );
      return;
    }
    const targetId =
      editingQuestionId ?? pendingQuestionId.current ?? Date.now();
    pendingQuestionId.current = targetId;
    savingQuestionRef.current = true;
    setSavingQuestion(true);
    try {
      const optimizedImage = await optimizeQuizImageDataUrl(
        formImage,
        QUIZ_QUESTION_IMAGE_OPTIONS,
      );
      const optimizedChoiceOptionImages =
        formType === "choice"
          ? await optimizeChoiceOptionImages(payload.choiceOptionImages || [])
          : [];
      const optimizedMatchingPairs =
        formType === "matching"
          ? await optimizeMatchingPairImages(payload.matchingPairs || [])
          : [];
      const existingQuestion = questions.find((q) => q.id === targetId);
      const nowMs = Date.now();
      const newQuestion: Question = {
        ...normalizeQuizLearningMetadata(
          { ...metadata, familyId: metadata.familyId || String(targetId) },
          payload.options,
        ),
        id: targetId,
        unitId: node.id,
        subUnitId:
          type === "special"
            ? epSource.small || epSource.mid || epSource.big || null
            : formSubUnit || null,
        category,
        type: formType,
        question: formText.trim(),
        answer: payload.answer,
        options: payload.options,
        choiceOptionImages: optimizedChoiceOptionImages,
        matchingPairs: optimizedMatchingPairs,
        explanation: formExp.trim(),
        image: optimizedImage,
        passage: supportsQuestionPassage(formType) ? formPassage.trim() : "",
        hintEnabled,
        hint: hintEnabled ? hintText.trim() : "",
        createdAt: existingQuestion?.createdAt || nowMs,
        updatedAt: nowMs,
        ...(type === "special" && epSource.big ? { refBig: epSource.big } : {}),
        ...(type === "special" && epSource.mid ? { refMid: epSource.mid } : {}),
        ...(type === "special" && epSource.small
          ? { refSmall: epSource.small }
          : {}),
      };
      const questionData = { ...newQuestion };
      delete questionData.createdAt;
      delete questionData.updatedAt;
      const saved = await executeAssessmentManagementCommand<{
        contentRevision: number;
      }>("upsertQuizQuestion", {
        semesterId: getAssessmentSemesterId(config),
        questionId: String(targetId),
        question: questionData,
        expectedRevision: Number(existingQuestion?.contentRevision || 0),
        reason: "교사 문항 저장",
      });
      newQuestion.contentRevision = saved.contentRevision;
      setQuestions((prev) =>
        editingQuestionId
          ? prev.map((q) => (q.id === targetId ? newQuestion : q))
          : [...prev, newQuestion],
      );
      setEditingQuestionId(targetId);
      try {
        await refreshPublishedQuizDefinitions(config, node.id, category);
      } catch (error) {
        console.error(
          "Saved question could not refresh published definitions",
          error,
        );
        setFormError(
          "문항은 저장되었지만 공개 평가에 반영하지 못했습니다. 저장을 다시 눌러 반영해 주세요.",
        );
        return;
      }
      pendingQuestionId.current = null;
      resetForm();
      setIsComposerOpen(false);
    } catch (error: any) {
      console.error("Add question failed", error);
      const code = error?.code ? ` (${error.code})` : "";
      const message =
        error instanceof Error && error.message ? `\n${error.message}` : "";
      setFormError(`문제 등록에 실패했습니다${code}.${message}`);
    } finally {
      savingQuestionRef.current = false;
      setSavingQuestion(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!canEdit) return;
    if (!window.confirm("이 문제를 삭제하시겠습니까?")) return;
    try {
      await executeAssessmentManagementCommand("deleteQuizQuestion", {
        semesterId: getAssessmentSemesterId(config),
        questionId: String(id),
        expectedRevision: Number(
          questions.find((question) => question.id === id)?.contentRevision ||
            0,
        ),
        reason: "교사 문항 삭제",
      });
      setQuestions((prev) => prev.filter((q) => q.id !== id));
      await refreshPublishedQuizDefinitions(config, node.id, category);
    } catch (error) {
      console.error("Delete question failed", error);
      alert("현재 학기 문제를 삭제하지 못했습니다.");
    }
  };

  const formatAnswer = (question: Question) => {
    if (question.type === "order")
      return question.answer.split(ORDER_DELIMITER).join(" -> ");
    if (question.type === "matching") {
      const pairs = parseMatchingAnswer(question);
      return pairs.map((pair) => `${pair.left} - ${pair.right}`).join(", ");
    }
    return question.answer;
  };

  const categoryLabel =
    category === "diagnostic"
      ? "진단평가"
      : category === "formative"
        ? "형성평가"
        : "모의고사";
  const previewPassageText = formPassage.trim();
  const previewChoiceItems = getChoiceOptionItems(
    choiceOptions,
    choiceOptionImages,
  );
  const hasPreviewChoiceSupportPanel =
    formType === "choice" && (!!formImage || !!previewPassageText);
  const hasPreviewChoiceOptionImages =
    formType === "choice" && previewChoiceItems.some((item) => item.image);

  return (
    <div className="quiz-authoring-surface quiz-registration-workspace flex h-full min-h-0 flex-col">
      <div className="quiz-editor-toolbar quiz-registration-heading">
        <div className="quiz-registration-context">
          {type !== "special" && (
            <div className="text-sm text-gray-500 mb-1">{parentTitle}</div>
          )}
          <div className="quiz-registration-title-row">
            <div className="quiz-registration-title">
              <h2 className="text-xl font-bold text-gray-800">
                {type === "special" ? "모의고사" : node.title}
              </h2>
              {canEdit && (
                <button
                  onClick={() => onOpenSettings(category)}
                  className="min-h-11 min-w-11 text-gray-500 hover:text-blue-600 transition p-2"
                  title="평가 설정"
                  aria-label="평가 설정"
                >
                  <i className="fas fa-cog"></i>
                </button>
              )}
            </div>
            {type !== "special" && (
              <label className="quiz-registration-subunit-filter">
                <span>소단원</span>
                <select
                  aria-label="소단원 필터"
                  value={normalSubUnitFilter}
                  onChange={(event) =>
                    setNormalSubUnitFilter(event.target.value)
                  }
                  title={
                    normalSubUnits.find(
                      (unit) => unit.id === normalSubUnitFilter,
                    )?.title ||
                    (normalSubUnitFilter === UNASSIGNED_SUB_UNIT_FILTER
                      ? "소단원 미지정"
                      : "전체 소단원")
                  }
                >
                  <option value="">
                    전체 소단원 (
                    {totalSubUnitQuestionCount.toLocaleString("ko-KR")}문항)
                  </option>
                  {normalSubUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.title} (
                      {(subUnitQuestionCounts[unit.id] || 0).toLocaleString(
                        "ko-KR",
                      )}
                      문항)
                    </option>
                  ))}
                  {(hasUnassignedQuestions ||
                    normalSubUnitFilter === UNASSIGNED_SUB_UNIT_FILTER) && (
                    <option value={UNASSIGNED_SUB_UNIT_FILTER}>
                      소단원 미지정 (
                      {(
                        subUnitQuestionCounts[UNASSIGNED_SUB_UNIT_FILTER] || 0
                      ).toLocaleString("ko-KR")}
                      문항)
                    </option>
                  )}
                </select>
              </label>
            )}
          </div>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={openCreateComposer}
            className="quiz-authoring-primary"
          >
            <i className="fas fa-plus"></i>
            <span>문제 등록</span>
          </button>
        )}
      </div>

      {type !== "special" && (
        <div className="flex border-b border-gray-200 px-4 pt-2">
          {["diagnostic", "formative"].map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`flex items-center gap-2 py-2 px-4 font-bold text-sm border-b-2 transition ${category === cat ? "border-blue-500 text-blue-600" : "border-transparent text-gray-400 hover:text-gray-600"}`}
            >
              {cat === "diagnostic" ? "진단평가" : "형성평가"}
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  category === cat
                    ? "bg-blue-50 text-blue-700"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {(categoryQuestionCounts[cat] || 0).toLocaleString("ko-KR")}
                문제
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="quiz-editor-toolbar border-b border-gray-200 px-4 py-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm font-bold text-gray-700">
          검색
          <input
            type="search"
            value={questionSearch}
            onChange={(event) => setQuestionSearch(event.target.value)}
            placeholder="문제·자료·해설·개념"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 font-normal"
          />
        </label>
        <span className="text-sm text-gray-500">
          {filteredQuestions.length}문항
        </span>
      </div>
      {loadError && (
        <div role="alert" className="p-4 text-sm text-red-700">
          {loadError}
          <button
            type="button"
            onClick={() => void fetchQuestions()}
            className="ml-2 min-h-11 font-bold underline"
          >
            다시 불러오기
          </button>
        </div>
      )}

      {type === "special" && (
        <div className="bg-blue-50 border-b border-blue-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold text-blue-800 mr-1">단원 필터</span>
            <select
              value={epFilter.big}
              onChange={(e) =>
                setEpFilter({ big: e.target.value, mid: "", small: "" })
              }
              className="w-32 rounded border border-blue-200 bg-white py-1 pl-2 pr-8 text-xs sm:w-36"
            >
              <option value="">대단원 전체</option>
              {allBigUnits.map((big) => (
                <option key={big.id} value={big.id}>
                  {big.title}
                </option>
              ))}
            </select>
            <select
              value={epFilter.mid}
              onChange={(e) =>
                setEpFilter((prev) => ({
                  ...prev,
                  mid: e.target.value,
                  small: "",
                }))
              }
              className="w-32 rounded border border-blue-200 bg-white py-1 pl-2 pr-8 text-xs sm:w-36"
            >
              <option value="">중단원 전체</option>
              {filterMidUnits.map((mid) => (
                <option key={mid.id} value={mid.id}>
                  {mid.title}
                </option>
              ))}
            </select>
            <select
              value={epFilter.small}
              onChange={(e) =>
                setEpFilter((prev) => ({ ...prev, small: e.target.value }))
              }
              className="w-32 rounded border border-blue-200 bg-white py-1 pl-2 pr-8 text-xs sm:w-36"
            >
              <option value="">소단원 전체</option>
              {filterSmallUnits.map((small) => (
                <option key={small.id} value={small.id}>
                  {small.title}
                </option>
              ))}
            </select>
            <span className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-bold text-blue-700">
              {filteredQuestions.length.toLocaleString("ko-KR")}문제
            </span>
            <button
              onClick={() => setEpFilter({ big: "", mid: "", small: "" })}
              className="ml-auto text-xs text-blue-400 hover:text-blue-600"
              title="필터 초기화"
            >
              <i className="fas fa-sync-alt"></i>
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden p-6 bg-gray-50">
        <div className="h-full min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
            {loading ? (
              <div className="text-center p-10 text-gray-400">
                문제를 불러오는 중...
              </div>
            ) : filteredQuestions.length === 0 ? (
              <div className="text-center p-10 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
                {questionSearch.trim() || normalSubUnitFilter
                  ? "조건에 맞는 문제가 없습니다."
                  : "등록된 문제가 없습니다."}
              </div>
            ) : (
              filteredQuestions.map((q, idx) => {
                const choicePreviewOptions =
                  q.type === "choice" ? trimList(q.options || []) : [];
                const choicePreviewImages = normalizeChoiceOptionImages(
                  q.choiceOptionImages,
                  choicePreviewOptions.length,
                );
                const hasChoicePreview = choicePreviewOptions.length > 0;
                const answerText = String(q.answer || "").trim();
                const explanationText = String(q.explanation || "").trim();
                const passageText = String(q.passage || "").trim();
                const hasChoiceSupportPanel =
                  q.type === "choice" && (!!q.image || !!passageText);
                const hasChoiceOptionImages = choicePreviewImages.some(Boolean);

                return (
                  <div
                    key={q.id}
                    className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm"
                  >
                    <div className="flex justify-between items-start mb-1.5">
                      <span className="bg-gray-100 text-gray-600 text-[10px] font-bold px-2 py-1 rounded">
                        Q{idx + 1} | {TYPE_LABEL[q.type] || q.type} |{" "}
                        {getQuestionSubUnitLabel(q)}
                      </span>
                      {canEdit && (
                        <div className="quiz-question-actions">
                          <button
                            type="button"
                            onClick={() => startDerivedQuestion(q)}
                            className="text-blue-700 hover:bg-blue-50"
                            aria-label={`${idx + 1}번 문항으로 파생 문항 만들기`}
                          >
                            <i
                              className="far fa-copy mr-1"
                              aria-hidden="true"
                            />
                            파생
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(q)}
                            className="text-gray-300 hover:text-blue-500"
                            title="문제 수정"
                            aria-label={`${idx + 1}번 문제 수정`}
                          >
                            <i className="fas fa-pen"></i>
                          </button>
                          <button
                            onClick={() => void handleDelete(q.id)}
                            className="text-gray-300 hover:text-red-500"
                            title="문제 삭제"
                            aria-label={`${idx + 1}번 문제 삭제`}
                          >
                            <i className="fas fa-trash"></i>
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="font-bold text-gray-800 mb-2 text-[13px] leading-5">
                      <QuizQuestionText value={q.question} />
                    </p>
                    {q.type === "choice" &&
                      (hasChoiceSupportPanel || hasChoicePreview) && (
                        <div
                          className={
                            hasChoiceSupportPanel && hasChoicePreview
                              ? "mb-2 grid min-h-0 gap-2 md:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.95fr)] md:items-start"
                              : "mb-2 space-y-2"
                          }
                        >
                          {hasChoiceSupportPanel && (
                            <div className="flex min-h-0 flex-col gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2 text-center">
                              {q.image && (
                                <div
                                  className={`flex min-h-0 items-center justify-center ${
                                    passageText ? "shrink-0" : "flex-1"
                                  }`}
                                >
                                  <img
                                    src={q.image}
                                    alt="문항 첨부 이미지"
                                    className={`mx-auto max-w-full rounded-lg border border-gray-100 object-contain ${
                                      passageText
                                        ? "max-h-[min(26vh,240px)]"
                                        : "max-h-[min(42vh,360px)]"
                                    }`}
                                  />
                                </div>
                              )}
                              {passageText && (
                                <QuizPassage
                                  value={passageText}
                                  surface="white"
                                  size="compact"
                                  className="shrink-0 text-left"
                                />
                              )}
                            </div>
                          )}
                          {hasChoicePreview && (
                            <div
                              className={
                                hasChoiceOptionImages
                                  ? "grid min-h-[12rem] grid-cols-2 auto-rows-fr gap-2 sm:grid-cols-3 md:grid-cols-2 xl:grid-cols-3"
                                  : "space-y-1.5"
                              }
                            >
                              {choicePreviewOptions.map(
                                (option, optionIndex) => {
                                  const isCorrectOption =
                                    option.trim() === answerText;
                                  const optionImage =
                                    choicePreviewImages[optionIndex];
                                  return (
                                    <div
                                      key={`${q.id}-option-${optionIndex}`}
                                      className={
                                        hasChoiceOptionImages
                                          ? `group flex h-full min-h-0 flex-col rounded-lg border-2 bg-white p-1.5 text-left ${
                                              isCorrectOption
                                                ? "border-blue-500 bg-blue-50 text-blue-800 shadow-sm"
                                                : "border-gray-200"
                                            }`
                                          : `flex min-w-0 items-start gap-1.5 rounded-lg border-2 px-2.5 py-1.5 text-left text-[13px] leading-5 md:text-sm md:leading-5 ${
                                              isCorrectOption
                                                ? "border-blue-500 bg-blue-50 font-bold text-blue-800"
                                                : "border-gray-200 bg-white font-bold text-gray-700"
                                            }`
                                      }
                                    >
                                      {hasChoiceOptionImages ? (
                                        <>
                                          <div
                                            className={`relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden rounded-lg border ${
                                              optionImage
                                                ? "border-gray-100 bg-white"
                                                : "border-dashed border-gray-200 bg-gray-50 px-2"
                                            }`}
                                          >
                                            <span
                                              className={`absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full text-xs font-black shadow-sm ${
                                                isCorrectOption
                                                  ? "bg-blue-600 text-white"
                                                  : "bg-white/95 text-gray-600 ring-1 ring-gray-200"
                                              }`}
                                            >
                                              {optionIndex + 1}
                                            </span>
                                            {optionImage ? (
                                              <img
                                                src={optionImage}
                                                alt={`${optionIndex + 1}번 보기 이미지`}
                                                className="max-h-full max-w-full object-contain"
                                              />
                                            ) : (
                                              <span className="break-keep text-center text-sm font-bold text-gray-700">
                                                {option}
                                              </span>
                                            )}
                                          </div>
                                          {optionImage && option && (
                                            <div className="mt-1.5 line-clamp-2 min-h-[2rem] w-full break-keep text-center text-xs font-bold leading-4">
                                              {option}
                                            </div>
                                          )}
                                        </>
                                      ) : (
                                        <>
                                          <span
                                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                                              isCorrectOption
                                                ? "bg-blue-600 font-black text-white"
                                                : "bg-gray-100 text-gray-600"
                                            }`}
                                          >
                                            {optionIndex + 1}
                                          </span>
                                          <span className="min-w-0 flex-1 break-keep">
                                            {option}
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  );
                                },
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    {q.type !== "choice" && (passageText || q.image) && (
                      <div
                        className={
                          q.image && passageText
                            ? "mb-2 grid gap-2 md:grid-cols-[minmax(150px,220px)_minmax(0,1fr)] md:items-start"
                            : "mb-2 space-y-2"
                        }
                      >
                        {q.image && (
                          <div className="flex justify-center rounded border border-gray-200 bg-gray-50 p-1.5">
                            <img
                              src={q.image}
                              alt="문항 첨부 이미지"
                              className="max-h-36 max-w-full object-contain"
                            />
                          </div>
                        )}
                        {passageText && (
                          <QuizPassage
                            value={passageText}
                            surface="white"
                            size="compact"
                            className="text-left"
                          />
                        )}
                      </div>
                    )}
                    {q.type === "choice" ? (
                      <p className="text-xs font-bold text-slate-500">
                        <span className="text-slate-700">해설: </span>
                        {explanationText || "등록된 해설이 없습니다."}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500">
                        <span className="mr-2 font-bold text-blue-600">
                          정답: {formatAnswer(q)}
                        </span>
                        {q.options && q.options.length > 0
                          ? `(${q.options.join(", ")})`
                          : ""}
                      </p>
                    )}
                    {!!(q.hintEnabled && q.hint) && (
                      <p className="text-xs text-amber-600 font-bold mt-1">
                        <i className="fas fa-lightbulb mr-1"></i>힌트 제공
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {isComposerOpen && (
          <div className="fixed inset-0 z-50">
            <button
              type="button"
              className="absolute inset-0 bg-black/45"
              onClick={closeComposer}
              aria-label="문제 등록 팝업 닫기"
            />
            <div
              className="absolute inset-0 flex items-center justify-center p-4"
              onClick={(event) => {
                if (event.target === event.currentTarget) closeComposer();
              }}
            >
              <div
                ref={composerDialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={
                  editingQuestionId
                    ? "문제 수정"
                    : derivationSource
                      ? "파생 문항 만들기"
                      : "새 문제 등록"
                }
                tabIndex={-1}
                className="quiz-authoring-surface quiz-composer-dialog"
              >
                <div className="quiz-composer-header">
                  <div>
                    <h3 className="font-bold text-gray-800 text-lg">
                      {editingQuestionId
                        ? "문제 수정"
                        : derivationSource
                          ? "파생 문항 만들기"
                          : "새 문제 등록"}
                    </h3>
                    <div className="quiz-composer-context">
                      <span>{categoryLabel}</span>
                      <span>{node.title}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={closeComposer}
                    className="min-h-11 min-w-11 text-gray-500 hover:text-gray-700"
                    aria-label="문제 편집 닫기"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>

                <div className="quiz-composer-body">
                  <section
                    className="quiz-composer-section"
                    aria-label="문항과 자료"
                  >
                    <div className="quiz-composer-fields">
                      <label className="quiz-composer-field">
                        <span>문항 유형</span>
                        <select
                          value={formType}
                          aria-label="문항 유형"
                          onChange={(e) =>
                            handleTypeChange(e.target.value as QuestionType)
                          }
                          onKeyDown={handleVerticalFocus}
                          className="quiz-compose-field border p-2 rounded text-sm bg-gray-50"
                        >
                          <option value="choice">객관식</option>
                          <option value="ox">O/X</option>
                          <option value="word">단답형</option>
                          <option value="order">순서 나열형</option>
                          <option value="matching">단어 연결하기</option>
                        </select>
                      </label>
                      {type === "normal" && (
                        <label className="quiz-composer-field">
                          <span>소단원</span>
                          <select
                            value={formSubUnit}
                            aria-label="소단원"
                            onChange={(e) => setFormSubUnit(e.target.value)}
                            onKeyDown={handleVerticalFocus}
                            className="quiz-compose-field border p-2 rounded text-sm bg-gray-50"
                          >
                            <option value="">소단원 전체</option>
                            {normalSubUnits.map((sub) => (
                              <option key={sub.id} value={sub.id}>
                                {sub.title}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>

                    {type === "special" && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <label className="quiz-composer-field">
                          <span>대단원</span>
                          <select
                            value={epSource.big}
                            onChange={(e) =>
                              setEpSource({
                                big: e.target.value,
                                mid: "",
                                small: "",
                              })
                            }
                            onKeyDown={handleVerticalFocus}
                            className="quiz-compose-field border border-blue-200 rounded p-1.5 text-xs bg-white"
                          >
                            <option value="">대단원 선택</option>
                            {allBigUnits.map((big) => (
                              <option key={big.id} value={big.id}>
                                {big.title}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="quiz-composer-field">
                          <span>중단원</span>
                          <select
                            value={epSource.mid}
                            onChange={(e) =>
                              setEpSource((prev) => ({
                                ...prev,
                                mid: e.target.value,
                                small: "",
                              }))
                            }
                            onKeyDown={handleVerticalFocus}
                            className="quiz-compose-field border border-blue-200 rounded p-1.5 text-xs bg-white"
                          >
                            <option value="">중단원 선택</option>
                            {sourceMidUnits.map((mid) => (
                              <option key={mid.id} value={mid.id}>
                                {mid.title}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="quiz-composer-field">
                          <span>소단원</span>
                          <select
                            value={epSource.small}
                            onChange={(e) =>
                              setEpSource((prev) => ({
                                ...prev,
                                small: e.target.value,
                              }))
                            }
                            onKeyDown={handleVerticalFocus}
                            className="quiz-compose-field border border-blue-200 rounded p-1.5 text-xs bg-white"
                          >
                            <option value="">소단원 선택</option>
                            {sourceSmallUnits.map((small) => (
                              <option key={small.id} value={small.id}>
                                {small.title}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}

                    <label className="quiz-composer-field">
                      <span>발문</span>
                      <QuizTextField
                        lang="ko"
                        inputMode="text"
                        aria-label="발문"
                        value={formText}
                        onChange={(e) => setFormText(e.target.value)}
                        onKeyDown={handleVerticalFocus}
                        className="quiz-compose-field w-full border p-2 rounded text-sm"
                      />
                    </label>

                    {supportsQuestionPassage(formType) && (
                      <QuizVisualPassageEditor
                        label={
                          formType === "word"
                            ? "단답형 본문 글상자"
                            : "읽기 자료 글상자"
                        }
                        value={formPassage}
                        onChange={setFormPassage}
                        allowBlank={formType === "word"}
                      />
                    )}

                    <label className="quiz-attachment-button">
                      이미지 첨부
                      <input
                        type="file"
                        className="sr-only"
                        accept="image/*"
                        aria-label="문항 이미지 첨부"
                        ref={fileInputRef}
                        onChange={handleImageSelect}
                      />
                    </label>
                    {optimizingImage && (
                      <p className="text-xs font-bold text-blue-600">
                        이미지 용량을 줄이는 중...
                      </p>
                    )}
                    {formImage && (
                      <div className="relative border rounded p-2 bg-gray-50">
                        <img
                          src={formImage}
                          alt="문항 첨부 이미지"
                          className="max-h-44 mx-auto rounded"
                        />
                        <button
                          type="button"
                          onClick={() => setFormImage(null)}
                          className="quiz-authoring-button absolute top-2 right-2"
                        >
                          제거
                        </button>
                      </div>
                    )}
                  </section>

                  <section
                    className="quiz-composer-section"
                    aria-label="보기와 정답"
                  >
                    {formType === "choice" && (
                      <div className="quiz-answer-editor">
                        <div className="quiz-composer-section-heading">
                          <h4>보기와 정답</h4>
                          <button
                            type="button"
                            onClick={addChoiceOption}
                            className="quiz-authoring-button"
                          >
                            보기 추가
                          </button>
                        </div>
                        {choiceOptions.map((option, index) => {
                          const optionImage = choiceOptionImages[index];
                          return (
                            <div
                              key={`choice-option-${index}`}
                              className="quiz-choice-row"
                            >
                              <button
                                type="button"
                                onClick={() => setChoiceAnswerIndex(index)}
                                aria-label={`${index + 1}번 보기 정답 선택`}
                                aria-pressed={choiceAnswerIndex === index}
                                className="quiz-choice-answer"
                              >
                                {index + 1}
                                {choiceAnswerIndex === index && (
                                  <span>정답</span>
                                )}
                              </button>
                              <div className="quiz-choice-content">
                                <QuizTextField
                                  lang="ko"
                                  inputMode="text"
                                  value={option}
                                  onChange={(e) =>
                                    setChoiceOptions((prev) =>
                                      prev.map((opt, i) =>
                                        i === index ? e.target.value : opt,
                                      ),
                                    )
                                  }
                                  onKeyDown={handleVerticalFocus}
                                  aria-label={`${index + 1}번 보기`}
                                  className="quiz-compose-field w-full border rounded p-2 text-sm bg-white"
                                />
                                {optionImage && (
                                  <div className="mt-2 flex min-w-0 items-center gap-2 rounded-md border border-gray-200 bg-white p-2">
                                    <img
                                      src={optionImage}
                                      alt={`${index + 1}번 보기 이미지`}
                                      className="h-16 w-20 shrink-0 rounded border border-gray-100 object-contain"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setChoiceOptionImages((prev) =>
                                          normalizeChoiceOptionImages(
                                            prev,
                                            choiceOptions.length,
                                          ).map((image, imageIndex) =>
                                            imageIndex === index ? null : image,
                                          ),
                                        )
                                      }
                                      className="quiz-authoring-button"
                                    >
                                      이미지 제거
                                    </button>
                                  </div>
                                )}
                              </div>
                              <div className="quiz-choice-actions">
                                <label
                                  className="quiz-attachment-button"
                                  title={`${index + 1}번 보기 이미지 첨부`}
                                >
                                  이미지
                                  <input
                                    type="file"
                                    className="sr-only"
                                    accept="image/*"
                                    aria-label={`${index + 1}번 보기 이미지 첨부`}
                                    onChange={(e) =>
                                      handleChoiceOptionImageSelect(index, e)
                                    }
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => removeChoiceOption(index)}
                                  aria-label={`${index + 1}번 보기 삭제`}
                                  disabled={choiceOptions.length <= 2}
                                  className="quiz-authoring-button quiz-authoring-danger"
                                >
                                  삭제
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {formType === "ox" && (
                      <div>
                        <h4 className="quiz-composer-label">정답</h4>
                        <div className="grid grid-cols-2 gap-2">
                          {(["O", "X"] as const).map((value) => (
                            <button
                              key={value}
                              type="button"
                              aria-pressed={oxAnswer === value}
                              aria-label={`${value} 정답 선택`}
                              onClick={() => setOxAnswer(value)}
                              onKeyDown={handleVerticalFocus}
                              className={`quiz-compose-field py-3 rounded-lg border-2 font-bold transition ${oxAnswer === value ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-500 hover:border-blue-300"}`}
                            >
                              {value}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {formType === "word" && (
                      <label className="quiz-composer-field">
                        <span>정답</span>
                        <QuizTextField
                          lang="ko"
                          inputMode="text"
                          value={wordAnswer}
                          onChange={(e) => setWordAnswer(e.target.value)}
                          onKeyDown={handleVerticalFocus}
                          aria-label="단답형 정답"
                          className="quiz-compose-field w-full border rounded p-2 text-sm bg-white"
                        />
                      </label>
                    )}

                    {formType === "order" && (
                      <div className="quiz-answer-editor">
                        <div className="quiz-composer-section-heading">
                          <h4>순서 항목 (위에서 아래 순서가 정답)</h4>
                          <button
                            type="button"
                            onClick={() =>
                              setOrderItems((prev) => [...prev, ""])
                            }
                            className="quiz-authoring-button"
                          >
                            항목 추가
                          </button>
                        </div>
                        {orderItems.map((item, index) => (
                          <div
                            key={`order-item-${index}`}
                            className="quiz-order-row"
                          >
                            <span className="w-7 h-7 rounded-full bg-gray-200 text-gray-700 text-xs font-bold flex items-center justify-center">
                              {index + 1}
                            </span>
                            <QuizTextField
                              lang="ko"
                              inputMode="text"
                              value={item}
                              aria-label={`${index + 1}번 순서 항목`}
                              onChange={(e) =>
                                setOrderItems((prev) =>
                                  prev.map((v, i) =>
                                    i === index ? e.target.value : v,
                                  ),
                                )
                              }
                              onKeyDown={handleVerticalFocus}
                              className="quiz-compose-field flex-1 border rounded p-2 text-sm bg-white"
                            />
                            <div className="quiz-order-actions">
                              <button
                                type="button"
                                onClick={() => moveOrderItem(index, "up")}
                                aria-label={`${index + 1}번 항목 위로 이동`}
                                title="위로 이동"
                                disabled={index === 0}
                                className="quiz-authoring-button"
                              >
                                <span aria-hidden="true">↑</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => moveOrderItem(index, "down")}
                                aria-label={`${index + 1}번 항목 아래로 이동`}
                                title="아래로 이동"
                                disabled={index === orderItems.length - 1}
                                className="quiz-authoring-button"
                              >
                                <span aria-hidden="true">↓</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => removeOrderItem(index)}
                                disabled={orderItems.length <= 2}
                                aria-label={`${index + 1}번 항목 삭제`}
                                title={
                                  orderItems.length <= 2
                                    ? "순서 항목은 최소 2개 필요합니다."
                                    : "항목 삭제"
                                }
                                className="quiz-authoring-button quiz-authoring-danger"
                              >
                                삭제
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {formType === "matching" && (
                      <div className="quiz-answer-editor">
                        <div className="quiz-composer-section-heading">
                          <h4>단어 연결 쌍 (왼쪽 단서와 오른쪽 정답)</h4>
                          <button
                            type="button"
                            onClick={addMatchingPair}
                            className="quiz-authoring-button"
                          >
                            쌍 추가
                          </button>
                        </div>
                        {matchingPairs.map((pair, index) => (
                          <div
                            key={`matching-pair-${index}`}
                            className="quiz-matching-row"
                          >
                            <span className="mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-700">
                              {index + 1}
                            </span>
                            <QuizTextField
                              lang="ko"
                              inputMode="text"
                              value={pair.left}
                              aria-label={`${index + 1}번 왼쪽 단서`}
                              onChange={(e) =>
                                setMatchingPairs((prev) =>
                                  prev.map((item, pairIndex) =>
                                    pairIndex === index
                                      ? { ...item, left: e.target.value }
                                      : item,
                                  ),
                                )
                              }
                              onKeyDown={handleVerticalFocus}
                              placeholder="왼쪽 단서"
                              className="quiz-compose-field min-w-0 rounded border p-2 text-sm"
                            />
                            <div className="min-w-0 space-y-2">
                              <QuizTextField
                                lang="ko"
                                inputMode="text"
                                value={pair.right}
                                aria-label={`${index + 1}번 오른쪽 정답`}
                                onChange={(e) =>
                                  setMatchingPairs((prev) =>
                                    prev.map((item, pairIndex) =>
                                      pairIndex === index
                                        ? { ...item, right: e.target.value }
                                        : item,
                                    ),
                                  )
                                }
                                onKeyDown={handleVerticalFocus}
                                placeholder="오른쪽 단어"
                                className="quiz-compose-field w-full rounded border p-2 text-sm"
                              />
                              <label className="quiz-attachment-button">
                                오른쪽 이미지
                                <input
                                  type="file"
                                  className="sr-only"
                                  accept="image/*"
                                  aria-label={`${index + 1}번 오른쪽 이미지 첨부`}
                                  onChange={(e) =>
                                    handleMatchingImageSelect(index, e)
                                  }
                                />
                              </label>
                              {pair.rightImage && (
                                <div className="flex flex-wrap items-center gap-2">
                                  <img
                                    src={pair.rightImage}
                                    alt="오른쪽 보기 이미지"
                                    className="h-16 max-w-[120px] rounded border border-gray-200 object-contain"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setMatchingPairs((prev) =>
                                        prev.map((item, pairIndex) =>
                                          pairIndex === index
                                            ? { ...item, rightImage: null }
                                            : item,
                                        ),
                                      )
                                    }
                                    aria-label={`${index + 1}번 오른쪽 이미지 제거`}
                                    className="quiz-authoring-button quiz-authoring-danger"
                                  >
                                    이미지 제거
                                  </button>
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => removeMatchingPair(index)}
                              disabled={matchingPairs.length <= 2}
                              aria-label={`${index + 1}번 연결 쌍 삭제`}
                              className="quiz-authoring-button quiz-authoring-danger"
                            >
                              삭제
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section
                    className="quiz-composer-section"
                    aria-label="해설과 힌트"
                  >
                    <label className="quiz-composer-field">
                      <span>해설</span>
                      <textarea
                        lang="ko"
                        inputMode="text"
                        aria-label="해설"
                        value={formExp}
                        onChange={(e) => setFormExp(e.target.value)}
                        onKeyDown={handleVerticalFocus}
                        className="quiz-compose-field w-full border p-2 rounded text-sm h-16 resize-none"
                      />
                    </label>

                    <div className="quiz-hint-field">
                      <label className="inline-flex min-h-11 items-center gap-2 text-sm font-bold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={hintEnabled}
                          onChange={(e) => setHintEnabled(e.target.checked)}
                        />
                        힌트 제공
                      </label>
                      {hintEnabled && (
                        <textarea
                          lang="ko"
                          inputMode="text"
                          aria-label="힌트"
                          value={hintText}
                          onChange={(e) => setHintText(e.target.value)}
                          onKeyDown={handleVerticalFocus}
                          className="quiz-compose-field mt-2 w-full border p-2 rounded text-sm h-16 resize-none bg-white"
                        />
                      )}
                    </div>
                  </section>

                  {previewOpen && (
                    <div
                      ref={previewRef}
                      tabIndex={-1}
                      role="region"
                      aria-label="학생 화면 미리보기"
                      className="quiz-composer-section quiz-composer-preview"
                    >
                      <div className="quiz-composer-label">
                        학생 화면 미리보기
                      </div>
                      <div className="bg-white rounded-lg border border-blue-100 p-4">
                        <h4 className="font-bold text-gray-800 mb-4">
                          <QuizQuestionText value={formText} />
                        </h4>
                        {formType === "choice" ? (
                          <div
                            className={
                              hasPreviewChoiceSupportPanel
                                ? "grid min-h-0 gap-4 md:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.95fr)] md:items-start"
                                : "space-y-2"
                            }
                          >
                            {hasPreviewChoiceSupportPanel && (
                              <div className="flex min-h-0 flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50 p-2 text-center">
                                {formImage && (
                                  <div
                                    className={`flex min-h-0 items-center justify-center ${
                                      previewPassageText ? "shrink-0" : "flex-1"
                                    }`}
                                  >
                                    <img
                                      src={formImage}
                                      alt="문항 첨부 이미지 미리보기"
                                      className={`mx-auto max-w-full rounded-lg border border-gray-100 object-contain ${
                                        previewPassageText
                                          ? "max-h-[min(30vh,280px)]"
                                          : "max-h-[min(48vh,460px)]"
                                      }`}
                                    />
                                  </div>
                                )}
                                {previewPassageText && (
                                  <QuizPassage
                                    value={previewPassageText}
                                    surface="white"
                                    className="shrink-0 text-left"
                                  />
                                )}
                              </div>
                            )}
                            <div
                              className={
                                hasPreviewChoiceOptionImages
                                  ? "grid min-h-[16rem] grid-cols-3 auto-rows-fr gap-2"
                                  : "space-y-2"
                              }
                            >
                              {previewChoiceItems.map((item, index) => {
                                const visibleOptionText =
                                  item.image &&
                                  isGeneratedImageChoiceLabel(item.text, index)
                                    ? ""
                                    : item.text;
                                const selected =
                                  previewChoiceAnswer === item.text;
                                return (
                                  <button
                                    key={`preview-choice-${index}`}
                                    type="button"
                                    onClick={() =>
                                      setPreviewChoiceAnswer(item.text)
                                    }
                                    className={
                                      hasPreviewChoiceOptionImages
                                        ? `group flex h-full min-h-0 flex-col rounded-xl border-2 bg-white p-2 text-left transition ${
                                            selected
                                              ? "border-blue-500 bg-blue-50 text-blue-800 shadow-sm"
                                              : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                                          }`
                                        : `flex w-full items-start gap-2 rounded-lg border-2 p-3 text-left transition ${
                                            selected
                                              ? "border-blue-500 bg-blue-50 font-bold text-blue-800"
                                              : "border-gray-200 hover:border-blue-300"
                                          }`
                                    }
                                  >
                                    {hasPreviewChoiceOptionImages ? (
                                      <>
                                        <div
                                          className={`relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden rounded-lg border ${
                                            item.image
                                              ? "border-gray-100 bg-white"
                                              : "border-dashed border-gray-200 bg-gray-50 px-2"
                                          }`}
                                        >
                                          <span
                                            className={`absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full text-sm font-black shadow-sm ${
                                              selected
                                                ? "bg-blue-600 text-white"
                                                : "bg-white/95 text-gray-600 ring-1 ring-gray-200"
                                            }`}
                                          >
                                            {index + 1}
                                          </span>
                                          {item.image ? (
                                            <img
                                              src={item.image}
                                              alt={`${index + 1}번 보기`}
                                              className="max-h-full max-w-full object-contain"
                                            />
                                          ) : (
                                            <span className="break-keep text-center text-sm font-bold text-gray-700">
                                              {visibleOptionText}
                                            </span>
                                          )}
                                        </div>
                                        {visibleOptionText && item.image && (
                                          <div className="mt-2 line-clamp-2 min-h-[2.5rem] w-full break-keep text-center text-sm font-bold leading-5">
                                            {visibleOptionText}
                                          </div>
                                        )}
                                      </>
                                    ) : (
                                      <>
                                        <span
                                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                                            selected
                                              ? "bg-blue-600 text-white"
                                              : "bg-gray-200 text-gray-500"
                                          }`}
                                        >
                                          {index + 1}
                                        </span>
                                        {item.image && (
                                          <img
                                            src={item.image}
                                            alt={`${index + 1}번 보기 이미지 미리보기`}
                                            className="h-20 w-24 shrink-0 rounded border border-gray-100 bg-white object-contain"
                                          />
                                        )}
                                        <span className="min-w-0 break-words">
                                          {visibleOptionText}
                                        </span>
                                      </>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          (formImage ||
                            (formType === "word" && previewPassageText)) && (
                            <div className="mb-4 flex flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50 p-2 text-center">
                              {formImage && (
                                <img
                                  src={formImage}
                                  alt="문항 첨부 이미지 미리보기"
                                  className="mx-auto max-h-48 max-w-full rounded-lg border border-gray-100 object-contain"
                                />
                              )}
                              {formType === "word" && previewPassageText && (
                                <QuizPassage
                                  value={previewPassageText}
                                  surface="white"
                                  className="text-left"
                                />
                              )}
                            </div>
                          )
                        )}
                        {formType === "ox" && (
                          <div className="grid grid-cols-2 gap-2">
                            {(["O", "X"] as const).map((opt) => (
                              <button
                                key={`preview-ox-${opt}`}
                                type="button"
                                onClick={() => setPreviewOxAnswer(opt)}
                                className={`border-2 rounded-lg py-3 font-bold transition ${previewOxAnswer === opt ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 hover:border-blue-300"}`}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        )}
                        {formType === "word" && (
                          <QuizTextField
                            lang="ko"
                            inputMode="text"
                            value={previewWordAnswer}
                            onChange={(e) =>
                              setPreviewWordAnswer(e.target.value)
                            }
                            placeholder="정답 입력 칸 미리보기"
                            className="w-full border-b-2 border-gray-300 p-2 text-center text-sm focus:border-blue-500 outline-none"
                          />
                        )}
                        {formType === "order" && (
                          <div className="space-y-2">
                            <div className="flex flex-wrap gap-2">
                              {previewOrderPool.map((item) => (
                                <button
                                  key={`preview-order-pool-${item}`}
                                  type="button"
                                  onClick={() =>
                                    !previewOrderAnswer.includes(item) &&
                                    setPreviewOrderAnswer((prev) => [
                                      ...prev,
                                      item,
                                    ])
                                  }
                                  className={`px-3 py-2 rounded border-2 text-sm transition ${previewOrderAnswer.includes(item) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 hover:border-blue-300"}`}
                                >
                                  {item}
                                </button>
                              ))}
                            </div>
                            <div className="min-h-[96px] rounded border border-dashed border-blue-300 bg-white p-3">
                              <div className="flex flex-col items-start gap-1">
                                {previewOrderAnswer.map((item, index, list) => (
                                  <React.Fragment
                                    key={`preview-order-selected-${index}-${item}`}
                                  >
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPreviewOrderAnswer((prev) =>
                                          prev.filter((_, i) => i !== index),
                                        )
                                      }
                                      className="inline-flex max-w-full items-start gap-2 rounded bg-blue-100 px-3 py-2 text-left text-xs font-bold text-blue-700"
                                    >
                                      <span className="shrink-0">
                                        {index + 1}.
                                      </span>
                                      <span className="min-w-0 break-words">
                                        {item}
                                      </span>
                                    </button>
                                    {index < list.length - 1 && (
                                      <span
                                        aria-hidden="true"
                                        className="ml-5 text-sm font-bold leading-none text-blue-500"
                                      >
                                        ↓
                                      </span>
                                    )}
                                  </React.Fragment>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                        {formType === "matching" && (
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-2">
                              {trimMatchingPairs(matchingPairs).map(
                                (pair, index) => (
                                  <button
                                    key={`preview-matching-left-${pair.left}-${index}`}
                                    type="button"
                                    onClick={() =>
                                      setPreviewMatchingActiveLeft(pair.left)
                                    }
                                    className={`w-full rounded-lg border-2 p-3 text-left text-sm font-bold transition ${previewMatchingActiveLeft === pair.left ? "border-blue-500 bg-blue-50 text-blue-800" : "border-gray-200 hover:border-blue-300"}`}
                                  >
                                    {pair.left}
                                    {previewMatchingAnswer[pair.left] && (
                                      <span className="ml-2 text-xs text-blue-600">
                                        → {previewMatchingAnswer[pair.left]}
                                      </span>
                                    )}
                                  </button>
                                ),
                              )}
                            </div>
                            <div className="space-y-2">
                              {previewMatchingOptions.map((pair, index) => {
                                const used = Object.values(
                                  previewMatchingAnswer,
                                ).includes(pair.right);
                                return (
                                  <button
                                    key={`preview-matching-right-${pair.right}-${index}`}
                                    type="button"
                                    onClick={() =>
                                      previewMatchingActiveLeft &&
                                      setPreviewMatchingAnswer((prev) => ({
                                        ...prev,
                                        [previewMatchingActiveLeft]: pair.right,
                                      }))
                                    }
                                    className={`flex w-full items-center gap-3 rounded-lg border-2 p-3 text-left text-sm font-bold transition ${used ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 hover:border-blue-300"}`}
                                  >
                                    {pair.rightImage && (
                                      <img
                                        src={pair.rightImage}
                                        alt=""
                                        className="h-12 w-12 rounded border border-gray-100 object-contain"
                                      />
                                    )}
                                    <span>{pair.right}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="quiz-composer-section quiz-composer-metadata">
                    <QuizLearningMetadataFields
                      value={metadata}
                      onChange={setMetadata}
                      options={
                        formType === "choice"
                          ? getChoiceOptionItems(
                              choiceOptions,
                              choiceOptionImages,
                            ).map((item) => item.text)
                          : []
                      }
                      units={treeData.flatMap((big) =>
                        (big.children || []).flatMap((mid) =>
                          (mid.children || []).map((small) => ({
                            id: small.id,
                            title: `${mid.title} · ${small.title}`,
                          })),
                        ),
                      )}
                    />
                  </div>
                  {derivationSource && (
                    <label className="flex min-h-11 items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={answerReviewed}
                        onChange={(event) =>
                          setAnswerReviewed(event.target.checked)
                        }
                      />
                      <span>
                        원본에서 바꾼 발문·자료·보기와 정답·해설의 일치를
                        확인했습니다.
                      </span>
                    </label>
                  )}
                  {formError && (
                    <p
                      ref={formErrorRef}
                      tabIndex={-1}
                      role="alert"
                      className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700"
                    >
                      {formError}
                    </p>
                  )}
                </div>
                <div className="quiz-composer-footer">
                  <button
                    type="button"
                    onClick={openPreview}
                    aria-expanded={previewOpen}
                    className="quiz-authoring-button"
                  >
                    {previewOpen ? "미리보기 닫기" : "미리보기"}
                  </button>
                  <div className="quiz-composer-footer-actions">
                    <button
                      type="button"
                      onClick={closeComposer}
                      disabled={savingQuestion}
                      className="quiz-authoring-button"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleAdd()}
                      disabled={savingQuestion || optimizingImage}
                      className="quiz-authoring-primary"
                    >
                      {optimizingImage
                        ? "이미지 줄이는 중..."
                        : savingQuestion
                          ? "저장 중..."
                          : editingQuestionId
                            ? "수정 저장"
                            : "등록"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {savingQuestion && (
          <LoadingOverlay
            message={
              editingQuestionId
                ? "문제를 저장하는 중입니다."
                : "문제를 등록하는 중입니다."
            }
            detail="서버 저장이 끝날 때까지 잠시만 기다려 주세요."
          />
        )}
      </div>
    </div>
  );
};

export default QuizEditor;
