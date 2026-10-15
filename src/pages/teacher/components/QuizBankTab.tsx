import React, { useMemo, useRef, useState } from "react";
import { getHttpsCallable } from "../../../lib/firebase";
import { useAuth } from "../../../contexts/AuthContext";
import { LoadingOverlay } from "../../../components/common/LoadingState";
import MatchingConnectionLines from "../../../components/common/MatchingConnectionLines";
import QuizPassage from "../../../components/common/QuizPassage";
import QuizVisualPassageEditor from "./QuizVisualPassageEditor";
import QuizTextField from "./QuizTextField";
import { getYearSemester } from "../../../lib/semesterScope";
import {
  QUIZ_CHOICE_OPTION_IMAGES_TOTAL_MAX_BYTES,
  QUIZ_CHOICE_OPTION_IMAGE_OPTIONS,
  QUIZ_MATCHING_IMAGE_OPTIONS,
  QUIZ_QUESTION_IMAGE_OPTIONS,
  getQuizImageDataUrlBytes,
  optimizeQuizImageDataUrl,
  optimizeQuizImageFile,
} from "../../../lib/quizImageCompression";
import {
  getAssessmentSemesterId,
  refreshPublishedQuizDefinitions,
} from "../../../lib/assessmentRelease";
import { executeAssessmentManagementCommand } from "../../../lib/assessmentLifecycle";
import type { QuizQuestionDraft } from "./QuizEditor";
import QuizLearningMetadataFields, {
  normalizeQuizLearningMetadata,
  validateQuizLearningMetadata,
  type QuizLearningMetadata,
} from "./QuizLearningMetadataFields";
import { useQuizDialog } from "./useQuizDialog";

import QuizAnalysisView from "./QuizAnalysisView";
import { useQuizAnalysisData } from "./useQuizAnalysisData";
export interface TreeUnit {
  id: string;
  title: string;
  children?: TreeUnit[];
}

export interface Question extends QuizLearningMetadata {
  contentRevision?: number;
  sourceRevision?: string;
  docId: string;
  id: number;
  category: string;
  unitId: string;
  subUnitId?: string | null;
  type: string;
  question: string;
  answer: string | number;
  image?: string | null;
  passage?: string | null;
  matchingPairs?: MatchingPair[];
  refBig?: string;
  refMid?: string;
  refSmall?: string;
  options?: string[];
  choiceOptionImages?: ChoiceOptionImage[];
  explanation?: string;
  hintEnabled?: boolean;
  hint?: string;
}

type ChoiceOptionImage = string | null;

interface MatchingPair {
  left: string;
  right: string;
  rightImage?: string | null;
}

interface QuestionCorrectionResult {
  scannedResultCount?: number;
  updatedResultCount?: number;
  improvedAnswerCount?: number;
  bonusAwardedCount?: number;
}

type QuestionType = "choice" | "ox" | "word" | "order" | "matching";
const supportsQuestionPassage = (type: string) =>
  type === "choice" || type === "word";
const ORDER_DELIMITER = "||";
const MATCHING_PAIR_DELIMITER = "=>";
const DEFAULT_CHOICE_OPTION_COUNT = 4;
const EXAM_PREP_CHOICE_OPTION_COUNT = 5;
const DEFAULT_ORDER_OPTION_COUNT = 4;
const isGeneratedImageChoiceLabel = (value: string, index: number) => {
  const match = value.trim().match(/^(\d+)\s*번\s*보기$/);
  return Boolean(match && Number(match[1]) === index + 1);
};
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
const normalizeQuestionType = (type: string): QuestionType =>
  type === "short" ? "word" : (type as QuestionType) || "choice";
const QuizBankTab: React.FC<{
  canEdit: boolean;
  onDeriveQuestion?: (question: QuizQuestionDraft) => void;
  focusedQuestionIds?: string[];
  onClearFocus?: () => void;
}> = ({ canEdit, onDeriveQuestion }) => {
  const { config } = useAuth();
  const {
    questions,
    setQuestions,
    treeData,
    students,
    records,
    snapshots,
    loading,
    errors,
    legacyLimited,
    reload,
  } = useQuizAnalysisData(config);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [editMetadata, setEditMetadata] = useState<QuizLearningMetadata>({});
  const pendingCorrectionsRef = useRef(new Set<string>());
  const [savingEdit, setSavingEdit] = useState(false);
  const [optimizingImageCount, setOptimizingImageCount] = useState(0);
  const optimizingImage = optimizingImageCount > 0;
  const savingEditRef = useRef(false);

  const [editCategory, setEditCategory] = useState("diagnostic");
  const [editType, setEditType] = useState<QuestionType>("choice");
  const [editQuestionText, setEditQuestionText] = useState("");
  const [editExplanationText, setEditExplanationText] = useState("");
  const [editImage, setEditImage] = useState<string | null>(null);
  const [editPassage, setEditPassage] = useState("");
  const [editChoiceOptions, setEditChoiceOptions] = useState<string[]>(
    createDefaultChoiceOptionItems(),
  );
  const [editChoiceOptionImages, setEditChoiceOptionImages] = useState<
    ChoiceOptionImage[]
  >(createDefaultChoiceOptionImages());
  const [editChoiceAnswerIndex, setEditChoiceAnswerIndex] = useState<
    number | null
  >(null);
  const [editOxAnswer, setEditOxAnswer] = useState<"O" | "X" | "">("");
  const [editWordAnswer, setEditWordAnswer] = useState("");
  const [editOrderItems, setEditOrderItems] = useState<string[]>(
    createDefaultOrderItems(),
  );
  const [editMatchingPairs, setEditMatchingPairs] = useState<MatchingPair[]>(
    createDefaultMatchingPairs(),
  );
  const [editHintEnabled, setEditHintEnabled] = useState(false);
  const [editHintText, setEditHintText] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
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
  const previewMatchingContainerRef = useRef<HTMLDivElement | null>(null);
  const previewMatchingLeftRefs = useRef<
    Record<string, HTMLButtonElement | null>
  >({});
  const previewMatchingRightRefs = useRef<
    Record<string, HTMLButtonElement | null>
  >({});
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const editorDialogRef = useRef<HTMLDivElement>(null);
  useQuizDialog(!!editingQuestion, editorDialogRef, () => closeEditModal());

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
      question.matchingPairs.length
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
  const shuffle = <T,>(input: T[]): T[] => {
    const list = [...input];
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };

  const getCategoryPillLabel = (category: string) =>
    ({ diagnostic: "진단평가", formative: "형성평가", exam_prep: "모의고사" })[
      category
    ] || "평가";
  const getQuestionPathText = (q: Question) => {
    const ids = [
      q.refBig,
      q.refMid || q.unitId,
      q.refSmall || q.subUnitId,
    ].filter(Boolean);
    const labels: string[] = [];
    const visit = (nodes: TreeUnit[]) =>
      nodes.forEach((node) => {
        if (ids.includes(node.id)) labels.push(node.title);
        if (node.children) visit(node.children);
      });
    visit(treeData);
    return labels.join(" > ") || "단원 미지정";
  };
  const addChoiceOption = () => {
    setEditChoiceOptions((prev) => [...prev, ""]);
    setEditChoiceOptionImages((prev) => [...prev, null]);
  };
  const removeChoiceOption = (index: number) => {
    if (editChoiceOptions.length <= 2) return;
    setEditChoiceOptions((prev) => prev.filter((_, i) => i !== index));
    setEditChoiceOptionImages((prev) => prev.filter((_, i) => i !== index));
    if (editChoiceAnswerIndex === index) setEditChoiceAnswerIndex(null);
    if (editChoiceAnswerIndex !== null && editChoiceAnswerIndex > index)
      setEditChoiceAnswerIndex(editChoiceAnswerIndex - 1);
  };

  const moveOrderItem = (index: number, direction: "up" | "down") => {
    setEditOrderItems((prev) => {
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeOrderItem = (index: number) => {
    if (editOrderItems.length <= 2) return;
    setEditOrderItems((prev) =>
      prev.filter((_, itemIndex) => itemIndex !== index),
    );
  };

  const addMatchingPair = () =>
    setEditMatchingPairs((prev) => [
      ...prev,
      { left: "", right: "", rightImage: null },
    ]);

  const removeMatchingPair = (index: number) => {
    if (editMatchingPairs.length <= 2) return;
    setEditMatchingPairs((prev) =>
      prev.filter((_, pairIndex) => pairIndex !== index),
    );
  };

  const openPreview = () => {
    const opening = !previewOpen;
    setPreviewOpen(opening);
    setPreviewChoiceAnswer("");
    setPreviewOxAnswer("");
    setPreviewWordAnswer("");
    setPreviewOrderAnswer([]);
    setPreviewMatchingAnswer({});
    setPreviewMatchingActiveLeft("");
    if (opening && editType === "order") {
      setPreviewOrderPool(shuffle(trimList(editOrderItems)));
    }
    if (opening && editType === "matching") {
      setPreviewMatchingOptions(shuffle(trimMatchingPairs(editMatchingPairs)));
    }
  };

  const handleEditTypeChange = (nextType: QuestionType) => {
    setEditType(nextType);
    setPreviewOpen(false);
    setPreviewChoiceAnswer("");
    setPreviewOxAnswer("");
    setPreviewWordAnswer("");
    setPreviewOrderAnswer([]);
    setPreviewMatchingAnswer({});
    setPreviewMatchingActiveLeft("");
    if (
      nextType === "choice" &&
      getChoiceOptionItems(editChoiceOptions, editChoiceOptionImages).length ===
        0
    ) {
      setEditChoiceOptions(createDefaultChoiceOptionItems(editCategory));
      setEditChoiceOptionImages(createDefaultChoiceOptionImages(editCategory));
    }
    if (nextType === "order" && trimList(editOrderItems).length === 0) {
      setEditOrderItems(createDefaultOrderItems());
    }
    if (
      nextType === "matching" &&
      trimMatchingPairs(editMatchingPairs).length === 0
    ) {
      setEditMatchingPairs(createDefaultMatchingPairs());
    }
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOptimizingImageCount((prev) => prev + 1);
    try {
      setEditImage(
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
        setEditChoiceOptionImages((prev) =>
          normalizeChoiceOptionImages(prev, editChoiceOptions.length).map(
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
        setEditMatchingPairs((prev) =>
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

  const openEditModal = (question: Question) => {
    if (!canEdit) return;
    const normalizedType = normalizeQuestionType(question.type);
    setEditingQuestion(question);
    setEditMetadata(question);
    setEditCategory(question.category || "diagnostic");
    setEditType(normalizedType);
    setEditQuestionText(question.question || "");
    setEditExplanationText(question.explanation || "");
    setEditImage(question.image || null);
    setEditPassage(
      supportsQuestionPassage(normalizedType) ? question.passage || "" : "",
    );
    setEditHintEnabled(!!(question.hintEnabled && question.hint));
    setEditHintText(question.hint || "");
    setPreviewOpen(false);
    setPreviewChoiceAnswer("");
    setPreviewOxAnswer("");
    setPreviewWordAnswer("");
    setPreviewOrderPool([]);
    setPreviewOrderAnswer([]);
    setPreviewMatchingOptions([]);
    setPreviewMatchingAnswer({});
    setPreviewMatchingActiveLeft("");

    if (normalizedType === "choice") {
      const options = (question.options || []).filter(Boolean);
      const normalizedOptions =
        options.length >= 2
          ? options
          : createDefaultChoiceOptionItems(question.category);
      setEditChoiceOptions(normalizedOptions);
      setEditChoiceOptionImages(
        normalizeChoiceOptionImages(
          question.choiceOptionImages,
          normalizedOptions.length,
        ),
      );
      const answerIndex = normalizedOptions.findIndex(
        (opt) => opt.trim() === String(question.answer).trim(),
      );
      setEditChoiceAnswerIndex(answerIndex >= 0 ? answerIndex : null);
      setEditOxAnswer("");
      setEditWordAnswer("");
      setEditOrderItems(createDefaultOrderItems());
      setEditMatchingPairs(createDefaultMatchingPairs());
      return;
    }

    if (normalizedType === "ox") {
      setEditChoiceOptions(createDefaultChoiceOptionItems(question.category));
      setEditChoiceOptionImages(
        createDefaultChoiceOptionImages(question.category),
      );
      setEditChoiceAnswerIndex(null);
      setEditOxAnswer(
        question.answer === "O" || question.answer === "X"
          ? question.answer
          : "",
      );
      setEditWordAnswer("");
      setEditOrderItems(createDefaultOrderItems());
      setEditMatchingPairs(createDefaultMatchingPairs());
      return;
    }

    if (normalizedType === "word") {
      setEditChoiceOptions(createDefaultChoiceOptionItems(question.category));
      setEditChoiceOptionImages(
        createDefaultChoiceOptionImages(question.category),
      );
      setEditChoiceAnswerIndex(null);
      setEditOxAnswer("");
      setEditWordAnswer(String(question.answer || ""));
      setEditOrderItems(createDefaultOrderItems());
      setEditMatchingPairs(createDefaultMatchingPairs());
      return;
    }

    if (normalizedType === "matching") {
      const pairs = parseMatchingAnswer(question);
      setEditChoiceOptions(createDefaultChoiceOptionItems(question.category));
      setEditChoiceOptionImages(
        createDefaultChoiceOptionImages(question.category),
      );
      setEditChoiceAnswerIndex(null);
      setEditOxAnswer("");
      setEditWordAnswer("");
      setEditOrderItems(createDefaultOrderItems());
      setEditMatchingPairs(
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
    setEditChoiceOptions(createDefaultChoiceOptionItems(question.category));
    setEditChoiceOptionImages(
      createDefaultChoiceOptionImages(question.category),
    );
    setEditChoiceAnswerIndex(null);
    setEditOxAnswer("");
    setEditWordAnswer("");
    setEditOrderItems(
      orderOptions.length >= 2 ? orderOptions : createDefaultOrderItems(),
    );
    setEditMatchingPairs(createDefaultMatchingPairs());
  };

  const buildCurrentEditSnapshot = () => {
    const choiceItems = getChoiceOptionItems(
      editChoiceOptions,
      editChoiceOptionImages,
    );
    const choiceOptions = choiceItems.map((item) => item.text);
    const choiceOptionImages = choiceItems.map((item) => item.image);
    const orderOptions = trimList(editOrderItems);
    const matchingOptions = trimMatchingPairs(editMatchingPairs);
    let answer = "";
    let options: string[] = [];

    if (editType === "choice") {
      answer =
        editChoiceAnswerIndex !== null
          ? choiceItems.find(
              (item) => item.sourceIndex === editChoiceAnswerIndex,
            )?.text || ""
          : "";
      options = choiceOptions;
    } else if (editType === "ox") {
      answer = editOxAnswer;
      options = ["O", "X"];
    } else if (editType === "word") {
      answer = editWordAnswer.trim();
      options = [];
    } else if (editType === "matching") {
      answer = encodeMatchingAnswer(matchingOptions);
      options = matchingOptions.map((pair) => pair.right);
    } else {
      answer = orderOptions.join(ORDER_DELIMITER);
      options = orderOptions;
    }

    return {
      category: editCategory || "diagnostic",
      type: editType,
      question: editQuestionText.trim(),
      explanation: editExplanationText.trim(),
      image: editImage || "",
      passage: supportsQuestionPassage(editType) ? editPassage.trim() : "",
      options,
      choiceOptionImages: editType === "choice" ? choiceOptionImages : [],
      answer,
      matchingPairs: editType === "matching" ? matchingOptions : [],
      hintEnabled: editHintEnabled,
      hint: editHintEnabled ? editHintText.trim() : "",
    };
  };

  const buildOriginalEditSnapshot = (question: Question) => {
    const normalizedType = normalizeQuestionType(question.type);
    let options: string[] = [];
    let choiceOptionImages: ChoiceOptionImage[] = [];
    let answer = "";

    if (normalizedType === "choice") {
      options = trimList(question.options || []);
      choiceOptionImages = normalizeChoiceOptionImages(
        question.choiceOptionImages,
        options.length,
      );
      answer = String(question.answer || "").trim();
    } else if (normalizedType === "ox") {
      options = ["O", "X"];
      answer =
        question.answer === "O" || question.answer === "X"
          ? question.answer
          : "";
    } else if (normalizedType === "word") {
      options = [];
      answer = String(question.answer || "").trim();
    } else if (normalizedType === "matching") {
      const matchingOptions = trimMatchingPairs(parseMatchingAnswer(question));
      options = matchingOptions.map((pair) => pair.right);
      answer = encodeMatchingAnswer(matchingOptions);
    } else {
      options = trimList(
        question.options && question.options.length > 0
          ? question.options
          : String(question.answer || "").split(ORDER_DELIMITER),
      );
      answer = options.join(ORDER_DELIMITER);
    }

    return {
      category: question.category || "diagnostic",
      type: normalizedType,
      question: (question.question || "").trim(),
      explanation: (question.explanation || "").trim(),
      image: question.image || "",
      passage: supportsQuestionPassage(normalizedType)
        ? String(question.passage || "").trim()
        : "",
      options,
      choiceOptionImages,
      answer,
      matchingPairs:
        normalizedType === "matching"
          ? trimMatchingPairs(parseMatchingAnswer(question))
          : [],
      hintEnabled: !!(question.hintEnabled && question.hint),
      hint:
        question.hintEnabled && question.hint
          ? String(question.hint).trim()
          : "",
    };
  };

  const hasUnsavedEditChanges = useMemo(() => {
    if (!editingQuestion) return false;
    const current = buildCurrentEditSnapshot();
    const original = buildOriginalEditSnapshot(editingQuestion);
    return (
      JSON.stringify(current) !== JSON.stringify(original) ||
      JSON.stringify(
        normalizeQuizLearningMetadata(editMetadata, current.options),
      ) !==
        JSON.stringify(
          normalizeQuizLearningMetadata(editingQuestion, original.options),
        )
    );
  }, [
    editingQuestion,
    editCategory,
    editType,
    editQuestionText,
    editExplanationText,
    editImage,
    editPassage,
    editChoiceOptions,
    editChoiceOptionImages,
    editChoiceAnswerIndex,
    editOxAnswer,
    editWordAnswer,
    editOrderItems,
    editMatchingPairs,
    editHintEnabled,
    editHintText,
    editMetadata,
  ]);

  const closeEditModal = (force = false) => {
    if (savingEdit || optimizingImage) return;
    if (!force && hasUnsavedEditChanges) {
      const confirmed = window.confirm(
        "수정 중인 내용이 있습니다. 정말로 닫으시겠습니까?",
      );
      if (!confirmed) return;
    }
    setEditingQuestion(null);
    setEditCategory("diagnostic");
    setEditType("choice");
    setEditQuestionText("");
    setEditExplanationText("");
    setEditImage(null);
    setEditPassage("");
    setEditChoiceOptions(createDefaultChoiceOptionItems());
    setEditChoiceOptionImages(createDefaultChoiceOptionImages());
    setEditChoiceAnswerIndex(null);
    setEditOxAnswer("");
    setEditWordAnswer("");
    setEditOrderItems(createDefaultOrderItems());
    setEditMatchingPairs(createDefaultMatchingPairs());
    setEditHintEnabled(false);
    setEditHintText("");
    setPreviewOpen(false);
    setPreviewChoiceAnswer("");
    setPreviewOxAnswer("");
    setPreviewWordAnswer("");
    setPreviewOrderPool([]);
    setPreviewOrderAnswer([]);
    setPreviewMatchingOptions([]);
    setPreviewMatchingAnswer({});
    setPreviewMatchingActiveLeft("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const saveEditedQuestion = async () => {
    if (!canEdit) return;
    if (!editingQuestion) return;
    if (savingEditRef.current) return;
    if (optimizingImage) {
      alert("이미지 용량을 줄이는 중입니다. 잠시 후 다시 저장해 주세요.");
      return;
    }
    if (!editQuestionText.trim()) {
      alert("문제 내용을 입력하세요.");
      return;
    }

    const choiceItems = getChoiceOptionItems(
      editChoiceOptions,
      editChoiceOptionImages,
    );
    const choiceOptions = choiceItems.map((item) => item.text);
    const choiceOptionImages = choiceItems.map((item) => item.image);
    const orderOptions = trimList(editOrderItems);
    const matchingOptions = trimMatchingPairs(editMatchingPairs);
    let answer = "";
    let options: string[] = [];

    if (editType === "choice") {
      if (choiceOptions.length < 2) {
        alert("객관식 보기는 최소 2개 이상 필요합니다.");
        return;
      }
      if (editChoiceAnswerIndex === null) {
        alert("객관식 정답 보기를 선택하세요.");
        return;
      }
      answer =
        choiceItems.find((item) => item.sourceIndex === editChoiceAnswerIndex)
          ?.text || "";
      if (!answer) {
        alert("정답으로 선택한 보기에 내용을 입력하세요.");
        return;
      }
      options = choiceOptions;
    } else if (editType === "ox") {
      if (!editOxAnswer) {
        alert("O/X 정답을 선택하세요.");
        return;
      }
      answer = editOxAnswer;
      options = ["O", "X"];
    } else if (editType === "word") {
      if (!editWordAnswer.trim()) {
        alert("단답형 정답을 입력하세요.");
        return;
      }
      answer = editWordAnswer.trim();
      options = [];
    } else if (editType === "matching") {
      if (matchingOptions.length < 2) {
        alert("단어 연결하기 항목은 최소 2쌍 이상 필요합니다.");
        return;
      }
      answer = encodeMatchingAnswer(matchingOptions);
      options = matchingOptions.map((pair) => pair.right);
    } else {
      if (orderOptions.length < 2) {
        alert("순서 나열형 항목은 최소 2개 이상 필요합니다.");
        return;
      }
      answer = orderOptions.join(ORDER_DELIMITER);
      options = orderOptions;
    }

    if (editHintEnabled && !editHintText.trim()) {
      alert("힌트 제공을 선택한 경우 힌트 내용을 입력하세요.");
      return;
    }

    const metadataError = validateQuizLearningMetadata(editMetadata, options);
    if (metadataError) {
      alert(metadataError);
      return;
    }
    savingEditRef.current = true;
    setSavingEdit(true);
    try {
      const optimizedImage = await optimizeQuizImageDataUrl(
        editImage,
        QUIZ_QUESTION_IMAGE_OPTIONS,
      );
      const optimizedChoiceOptionImages =
        editType === "choice"
          ? await optimizeChoiceOptionImages(choiceOptionImages)
          : [];
      const optimizedMatchingOptions =
        editType === "matching"
          ? await optimizeMatchingPairImages(matchingOptions)
          : [];
      const payload: Question = {
        ...editingQuestion,
        ...normalizeQuizLearningMetadata(editMetadata, options),
        category: editCategory || editingQuestion.category,
        type: editType || (editingQuestion.type as QuestionType),
        question: editQuestionText.trim(),
        answer,
        explanation: editExplanationText.trim(),
        image: optimizedImage,
        passage: supportsQuestionPassage(editType) ? editPassage.trim() : "",
        options,
        choiceOptionImages: optimizedChoiceOptionImages,
        matchingPairs: optimizedMatchingOptions,
        hintEnabled: editHintEnabled,
        hint: editHintEnabled ? editHintText.trim() : "",
      };
      const originalSnapshot = buildOriginalEditSnapshot(editingQuestion);
      const shouldRecalculateCorrections =
        pendingCorrectionsRef.current.has(editingQuestion.docId) ||
        originalSnapshot.type !== payload.type ||
        String(originalSnapshot.answer || "") !== String(payload.answer || "");
      if (String(payload.id) !== editingQuestion.docId) {
        alert(
          "문항 ID와 저장 ID가 일치하지 않아 저장할 수 없습니다. 문항 데이터 확인이 필요합니다.",
        );
        return;
      }
      if (shouldRecalculateCorrections)
        pendingCorrectionsRef.current.add(editingQuestion.docId);
      const persistedPayload = {
        id: payload.id,
        unitId: payload.unitId,
        subUnitId: payload.subUnitId || null,
        category: payload.category,
        type: payload.type,
        question: payload.question,
        answer: payload.answer,
        explanation: payload.explanation || "",
        image: payload.image || null,
        passage: payload.passage || "",
        options: payload.options || [],
        choiceOptionImages: payload.choiceOptionImages || [],
        matchingPairs: payload.matchingPairs || [],
        hintEnabled: !!payload.hintEnabled,
        hint: payload.hint || "",
        ...(payload.refBig ? { refBig: payload.refBig } : {}),
        ...(payload.refMid ? { refMid: payload.refMid } : {}),
        ...(payload.refSmall ? { refSmall: payload.refSmall } : {}),
        ...normalizeQuizLearningMetadata(payload, payload.options || []),
      };
      const saved = await executeAssessmentManagementCommand<{
        contentRevision: number;
      }>("upsertQuizQuestion", {
        semesterId: getAssessmentSemesterId(config),
        questionId: String(editingQuestion.docId),
        question: persistedPayload,
        expectedRevision: Number(editingQuestion.contentRevision || 0),
        reason: "문제 은행 문항 수정",
      });
      payload.contentRevision = saved.contentRevision;
      payload.sourceRevision = String(saved.contentRevision);
      setQuestions((prev) =>
        prev.map((question) =>
          question.docId === payload.docId ? payload : question,
        ),
      );
      setEditingQuestion(payload);
      try {
        await refreshPublishedQuizDefinitions(
          config,
          payload.unitId,
          payload.category,
        );
      } catch (error) {
        console.error(error);
        alert(
          "문항은 저장되었지만 공개 평가에 반영하지 못했습니다. 수정 저장을 다시 눌러 반영해 주세요.",
        );
        return;
      }
      if (shouldRecalculateCorrections) {
        try {
          const { year, semester } = getYearSemester(config);
          const recalculateCorrections = await getHttpsCallable<
            {
              year: string;
              semester: string;
              questionDocId: string;
              questionId: number;
            },
            QuestionCorrectionResult
          >("recalculateQuizResultsAfterQuestionCorrection");
          const correction = await recalculateCorrections({
            year,
            semester,
            questionDocId: String(editingQuestion.docId),
            questionId: Number(editingQuestion.id),
          });
          pendingCorrectionsRef.current.delete(editingQuestion.docId);
          if (Number(correction.data?.updatedResultCount || 0) > 0) {
            reload();
          }
        } catch (correctionError) {
          console.error(
            "Failed to recalculate quiz results after answer correction",
            correctionError,
          );
          alert(
            "문항은 저장되었지만 이전 방식의 응시 기록과 위스 보너스를 다시 계산하지 못했습니다. 수정 저장을 다시 눌러 주세요. 새 평가의 제출 기록은 유지됩니다.",
          );
          return;
        }
      }
      setQuestions((prev) =>
        prev.map((q) => (q.docId === editingQuestion.docId ? payload : q)),
      );
      closeEditModal(true);
    } catch (error: any) {
      console.error(error);
      const message =
        error instanceof Error && error.message ? `\n${error.message}` : "";
      alert(
        `문제 수정에 실패했습니다${error?.code ? ` (${error.code})` : ""}.${message}`,
      );
    } finally {
      savingEditRef.current = false;
      setSavingEdit(false);
    }
  };

  const editPreviewPassageText = editPassage.trim();
  const editPreviewChoiceItems = getChoiceOptionItems(
    editChoiceOptions,
    editChoiceOptionImages,
  );
  const hasEditPreviewChoiceSupportPanel =
    editType === "choice" && (!!editImage || !!editPreviewPassageText);
  const hasEditPreviewChoiceOptionImages =
    editType === "choice" && editPreviewChoiceItems.some((item) => item.image);

  return (
    <div className="quiz-authoring-surface">
      <QuizAnalysisView
        questions={questions}
        tree={treeData}
        students={students}
        records={records}
        snapshots={snapshots}
        loading={loading}
        errors={errors}
        legacyLimited={legacyLimited}
        semesterId={getAssessmentSemesterId(config)}
        canEdit={canEdit}
        onEdit={openEditModal}
        onDerive={onDeriveQuestion}
        onReload={reload}
      />
      {editingQuestion && (
        <div className="fixed inset-0 z-50" onClick={() => closeEditModal()}>
          <div className="absolute inset-0 bg-black/45" />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div
              ref={editorDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="문제 수정"
              tabIndex={-1}
              className="quiz-authoring-surface w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-gray-200 p-5"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-bold text-gray-800 text-lg flex items-center">
                    <i className="fas fa-pen text-blue-500 mr-2"></i>
                    문제 수정
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="px-2 py-1 rounded bg-gray-100 text-gray-700 font-bold">
                      {getQuestionPathText(editingQuestion)}
                    </span>
                    <span className="px-2 py-1 rounded bg-blue-100 text-blue-700 font-bold">
                      {getCategoryPillLabel(editCategory)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => closeEditModal()}
                  className="min-h-11 min-w-11 text-gray-500 hover:text-gray-700"
                  aria-label="문제 수정 닫기"
                >
                  <i className="fas fa-times text-lg"></i>
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <select
                    value={editType}
                    onChange={(e) =>
                      handleEditTypeChange(e.target.value as QuestionType)
                    }
                    className="border p-2 rounded text-sm bg-gray-50"
                  >
                    <option value="choice">객관식</option>
                    <option value="ox">O/X</option>
                    <option value="word">단답형</option>
                    <option value="order">순서 나열형</option>
                    <option value="matching">단어 연결하기</option>
                  </select>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    disabled
                    title="평가 유형 이동은 문제 등록 화면에서 처리해 주세요."
                    className="border p-2 rounded text-sm bg-gray-100 text-gray-500"
                  >
                    <option value="diagnostic">진단평가</option>
                    <option value="formative">형성평가</option>
                    <option value="exam_prep">모의고사</option>
                  </select>
                </div>

                <QuizTextField
                  lang="ko"
                  inputMode="text"
                  value={editQuestionText}
                  onChange={(e) => setEditQuestionText(e.target.value)}
                  placeholder="문제 내용"
                  className="w-full border p-2 rounded text-sm"
                />

                {supportsQuestionPassage(editType) && (
                  <QuizVisualPassageEditor
                    label={
                      editType === "word"
                        ? "단답형 본문 글상자"
                        : "읽기 자료 글상자"
                    }
                    value={editPassage}
                    onChange={setEditPassage}
                    allowBlank={editType === "word"}
                  />
                )}

                <label className="inline-flex items-center gap-2 text-xs font-bold text-gray-500 cursor-pointer hover:text-blue-600 bg-gray-100 px-3 py-1 rounded transition w-fit">
                  <i className="fas fa-image"></i> 이미지 첨부
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*"
                    ref={fileInputRef}
                    onChange={handleImageSelect}
                  />
                </label>
                {optimizingImage && (
                  <p className="text-xs font-bold text-blue-600">
                    이미지 용량을 줄이는 중...
                  </p>
                )}
                {editImage && (
                  <div className="relative border rounded p-2 bg-gray-50">
                    <img
                      src={editImage}
                      alt="문항 첨부 이미지"
                      className="mx-auto max-h-44 max-w-full rounded object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => setEditImage(null)}
                      className="absolute top-2 right-2 text-xs px-2 py-1 rounded bg-white border text-gray-500 hover:text-red-500"
                    >
                      제거
                    </button>
                  </div>
                )}

                {editType === "choice" && (
                  <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-gray-600">
                        객관식 보기
                      </p>
                      <button
                        type="button"
                        onClick={addChoiceOption}
                        className="text-xs font-bold text-blue-600 hover:text-blue-700"
                      >
                        <i className="fas fa-plus mr-1"></i>보기 추가
                      </button>
                    </div>
                    {editChoiceOptions.map((option, index) => {
                      const optionImage = editChoiceOptionImages[index];
                      return (
                        <div
                          key={`choice-option-${index}`}
                          className="flex items-start gap-2"
                        >
                          <span className="mt-1 w-7 h-7 rounded-full bg-gray-200 text-gray-700 text-xs font-bold flex items-center justify-center">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <QuizTextField
                              lang="ko"
                              inputMode="text"
                              value={option}
                              onChange={(e) =>
                                setEditChoiceOptions((prev) =>
                                  prev.map((opt, i) =>
                                    i === index ? e.target.value : opt,
                                  ),
                                )
                              }
                              placeholder={`${index + 1}번 보기`}
                              className="w-full border rounded p-2 text-sm bg-white"
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
                                    setEditChoiceOptionImages((prev) =>
                                      normalizeChoiceOptionImages(
                                        prev,
                                        editChoiceOptions.length,
                                      ).map((image, imageIndex) =>
                                        imageIndex === index ? null : image,
                                      ),
                                    )
                                  }
                                  className="text-xs font-bold text-gray-500 hover:text-red-500"
                                >
                                  이미지 제거
                                </button>
                              </div>
                            )}
                          </div>
                          <label
                            className="mt-1 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded border border-blue-100 bg-blue-50 text-blue-700 transition hover:bg-blue-100"
                            title={`${index + 1}번 보기 이미지 첨부`}
                          >
                            <i className="fas fa-image text-xs"></i>
                            <input
                              type="file"
                              className="hidden"
                              accept="image/*"
                              aria-label={`${index + 1}번 보기 이미지 첨부`}
                              onChange={(e) =>
                                handleChoiceOptionImageSelect(index, e)
                              }
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => setEditChoiceAnswerIndex(index)}
                            className={`mt-1 text-xs px-2 py-1 rounded border ${editChoiceAnswerIndex === index ? "border-blue-500 bg-blue-100 text-blue-700 font-bold" : "border-gray-300 text-gray-500"}`}
                          >
                            정답
                          </button>
                          <button
                            type="button"
                            onClick={() => removeChoiceOption(index)}
                            aria-label={`${index + 1}번 보기 삭제`}
                            className="mt-1 text-gray-400 hover:text-red-500 px-1"
                          >
                            <i className="fas fa-times"></i>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {editType === "ox" && (
                  <div className="grid grid-cols-2 gap-2">
                    {(["O", "X"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setEditOxAnswer(value)}
                        className={`py-3 rounded-lg border-2 font-bold transition ${editOxAnswer === value ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-500 hover:border-blue-300"}`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                )}

                {editType === "word" && (
                  <QuizTextField
                    lang="ko"
                    inputMode="text"
                    value={editWordAnswer}
                    onChange={(e) => setEditWordAnswer(e.target.value)}
                    placeholder="단답형 정답 입력"
                    className="w-full border rounded p-2 text-sm bg-white"
                  />
                )}

                {editType === "order" && (
                  <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-gray-600">
                        순서 항목 (위에서 아래 순서가 정답)
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setEditOrderItems((prev) => [...prev, ""])
                        }
                        className="text-xs font-bold text-blue-600 hover:text-blue-700"
                      >
                        <i className="fas fa-plus mr-1"></i>항목 추가
                      </button>
                    </div>
                    {editOrderItems.map((item, index) => (
                      <div
                        key={`order-item-${index}`}
                        className="flex items-center gap-2"
                      >
                        <span className="w-7 h-7 rounded-full bg-gray-200 text-gray-700 text-xs font-bold flex items-center justify-center">
                          {index + 1}
                        </span>
                        <QuizTextField
                          lang="ko"
                          inputMode="text"
                          value={item}
                          onChange={(e) =>
                            setEditOrderItems((prev) =>
                              prev.map((v, i) =>
                                i === index ? e.target.value : v,
                              ),
                            )
                          }
                          className="flex-1 border rounded p-2 text-sm bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => moveOrderItem(index, "up")}
                          aria-label={`${index + 1}번 항목 위로 이동`}
                          title="위로 이동"
                          className="text-gray-400 hover:text-blue-600 px-1"
                        >
                          <i className="fas fa-arrow-up"></i>
                        </button>
                        <button
                          type="button"
                          onClick={() => moveOrderItem(index, "down")}
                          aria-label={`${index + 1}번 항목 아래로 이동`}
                          title="아래로 이동"
                          className="text-gray-400 hover:text-blue-600 px-1"
                        >
                          <i className="fas fa-arrow-down"></i>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeOrderItem(index)}
                          disabled={editOrderItems.length <= 2}
                          aria-label={`${index + 1}번 항목 삭제`}
                          title={
                            editOrderItems.length <= 2
                              ? "순서 항목은 최소 2개 필요합니다."
                              : "항목 삭제"
                          }
                          className="px-1 text-gray-400 hover:text-red-500 disabled:cursor-not-allowed disabled:text-gray-300"
                        >
                          <i className="fas fa-times"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {editType === "matching" && (
                  <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-gray-600">
                        단어 연결 쌍 (왼쪽 단서와 오른쪽 정답)
                      </p>
                      <button
                        type="button"
                        onClick={addMatchingPair}
                        className="text-xs font-bold text-blue-600 hover:text-blue-700"
                      >
                        <i className="fas fa-plus mr-1"></i>쌍 추가
                      </button>
                    </div>
                    {editMatchingPairs.map((pair, index) => (
                      <div
                        key={`matching-pair-${index}`}
                        className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_28px] gap-2 rounded-lg border border-gray-200 bg-white p-2"
                      >
                        <span className="mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-700">
                          {index + 1}
                        </span>
                        <QuizTextField
                          lang="ko"
                          inputMode="text"
                          value={pair.left}
                          onChange={(e) =>
                            setEditMatchingPairs((prev) =>
                              prev.map((item, pairIndex) =>
                                pairIndex === index
                                  ? { ...item, left: e.target.value }
                                  : item,
                              ),
                            )
                          }
                          placeholder="왼쪽 단서"
                          className="min-w-0 rounded border p-2 text-sm"
                        />
                        <div className="min-w-0 space-y-2">
                          <QuizTextField
                            lang="ko"
                            inputMode="text"
                            value={pair.right}
                            onChange={(e) =>
                              setEditMatchingPairs((prev) =>
                                prev.map((item, pairIndex) =>
                                  pairIndex === index
                                    ? { ...item, right: e.target.value }
                                    : item,
                                ),
                              )
                            }
                            placeholder="오른쪽 단어"
                            className="w-full rounded border p-2 text-sm"
                          />
                          <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-blue-100 bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-100">
                            <i className="fas fa-image"></i> 우측 그림
                            <input
                              type="file"
                              className="hidden"
                              accept="image/*"
                              onChange={(e) =>
                                handleMatchingImageSelect(index, e)
                              }
                            />
                          </label>
                          {pair.rightImage && (
                            <div className="relative w-fit">
                              <img
                                src={pair.rightImage}
                                alt="오른쪽 보기 이미지"
                                className="h-16 max-w-[120px] rounded border border-gray-200 object-contain"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setEditMatchingPairs((prev) =>
                                    prev.map((item, pairIndex) =>
                                      pairIndex === index
                                        ? { ...item, rightImage: null }
                                        : item,
                                    ),
                                  )
                                }
                                className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border bg-white text-[10px] text-gray-500 hover:text-red-500"
                              >
                                <i className="fas fa-times"></i>
                              </button>
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeMatchingPair(index)}
                          className="mt-1 text-gray-400 hover:text-red-500"
                        >
                          <i className="fas fa-times"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <textarea
                  lang="ko"
                  inputMode="text"
                  value={editExplanationText}
                  onChange={(e) => setEditExplanationText(e.target.value)}
                  placeholder="해설 (선택)"
                  className="w-full border p-2 rounded text-sm min-h-[80px]"
                />

                <div className="border border-gray-200 rounded-lg p-3 bg-amber-50">
                  <label className="inline-flex items-center gap-2 text-sm font-bold text-amber-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editHintEnabled}
                      onChange={(e) => setEditHintEnabled(e.target.checked)}
                    />
                    힌트 제공
                  </label>
                  {editHintEnabled && (
                    <textarea
                      lang="ko"
                      inputMode="text"
                      placeholder="학생에게 보여줄 힌트를 입력하세요"
                      value={editHintText}
                      onChange={(e) => setEditHintText(e.target.value)}
                      className="mt-2 w-full border p-2 rounded text-sm h-16 resize-none bg-white"
                    />
                  )}
                </div>

                {previewOpen && (
                  <div className="border border-blue-200 rounded-xl p-4 bg-blue-50 space-y-3">
                    <div className="text-sm font-bold text-blue-800">
                      학생 화면 미리보기
                    </div>
                    <div className="bg-white rounded-lg border border-blue-100 p-4">
                      <h4 className="font-bold text-gray-800 mb-4">
                        {editQuestionText ||
                          "문제 문구를 입력하면 여기 표시됩니다."}
                      </h4>
                      {editType === "choice" ? (
                        <div
                          className={
                            hasEditPreviewChoiceSupportPanel
                              ? "grid min-h-0 gap-4 md:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.95fr)] md:items-start"
                              : "space-y-2"
                          }
                        >
                          {hasEditPreviewChoiceSupportPanel && (
                            <div className="flex min-h-0 flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50 p-2 text-center">
                              {editImage && (
                                <div
                                  className={`flex min-h-0 items-center justify-center ${
                                    editPreviewPassageText
                                      ? "shrink-0"
                                      : "flex-1"
                                  }`}
                                >
                                  <img
                                    src={editImage}
                                    alt="문항 첨부 이미지 미리보기"
                                    className={`mx-auto max-w-full rounded-lg border border-gray-100 object-contain ${
                                      editPreviewPassageText
                                        ? "max-h-[min(30vh,280px)]"
                                        : "max-h-[min(48vh,460px)]"
                                    }`}
                                  />
                                </div>
                              )}
                              {editPreviewPassageText && (
                                <QuizPassage
                                  value={editPreviewPassageText}
                                  surface="white"
                                  className="shrink-0 text-left"
                                />
                              )}
                            </div>
                          )}
                          <div
                            className={
                              hasEditPreviewChoiceOptionImages
                                ? "grid min-h-[16rem] grid-cols-3 auto-rows-fr gap-2"
                                : "space-y-2"
                            }
                          >
                            {editPreviewChoiceItems.map((item, index) => {
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
                                    hasEditPreviewChoiceOptionImages
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
                                  {hasEditPreviewChoiceOptionImages ? (
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
                        (editImage ||
                          (editType === "word" && editPreviewPassageText)) && (
                          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50 p-2 text-center">
                            {editImage && (
                              <img
                                src={editImage}
                                alt="문항 첨부 이미지 미리보기"
                                className="mx-auto max-h-48 max-w-full rounded-lg border border-gray-100 object-contain"
                              />
                            )}
                            {editType === "word" && editPreviewPassageText && (
                              <QuizPassage
                                value={editPreviewPassageText}
                                surface="white"
                                className="text-left"
                              />
                            )}
                          </div>
                        )
                      )}
                      {editType === "ox" && (
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
                      {editType === "word" && (
                        <QuizTextField
                          lang="ko"
                          inputMode="text"
                          value={previewWordAnswer}
                          onChange={(e) => setPreviewWordAnswer(e.target.value)}
                          placeholder="정답 입력 칸 미리보기"
                          className="w-full border-b-2 border-gray-300 p-2 text-center text-sm focus:border-blue-500 outline-none"
                        />
                      )}
                      {editType === "order" && (
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
                          <div className="rounded border border-dashed border-blue-300 bg-white p-3 min-h-[60px]">
                            {previewOrderAnswer.map((item, index) => (
                              <button
                                key={`preview-order-selected-${index}-${item}`}
                                type="button"
                                onClick={() =>
                                  setPreviewOrderAnswer((prev) =>
                                    prev.filter((_, i) => i !== index),
                                  )
                                }
                                className="px-2 py-1 rounded bg-blue-100 text-blue-700 text-xs font-bold mr-2 mb-2"
                              >
                                {index + 1}. {item}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {editType === "matching" &&
                        (() => {
                          const previewPairs =
                            trimMatchingPairs(editMatchingPairs);
                          const previewConnections = Object.entries(
                            previewMatchingAnswer,
                          )
                            .filter(([, right]) => right)
                            .map(([left, right]) => ({
                              id: `preview-${left}-${right}`,
                              leftKey: left,
                              rightKey: right,
                              active: previewMatchingActiveLeft === left,
                            }));

                          return (
                            <div
                              ref={previewMatchingContainerRef}
                              className="relative grid gap-3 md:grid-cols-2"
                            >
                              <div className="space-y-2">
                                {previewPairs.map((pair, index) => (
                                  <button
                                    key={`preview-matching-left-${pair.left}-${index}`}
                                    data-matching-left-key={pair.left}
                                    ref={(element) => {
                                      previewMatchingLeftRefs.current[
                                        pair.left
                                      ] = element;
                                    }}
                                    type="button"
                                    onClick={() =>
                                      setPreviewMatchingActiveLeft(pair.left)
                                    }
                                    className={`relative z-20 w-full rounded-lg border-2 p-3 text-left text-sm font-bold transition ${previewMatchingActiveLeft === pair.left ? "border-blue-500 bg-blue-50 text-blue-800" : "border-gray-200 bg-white hover:border-blue-300"}`}
                                  >
                                    {pair.left}
                                    {previewMatchingAnswer[pair.left] && (
                                      <span className="ml-2 text-xs text-blue-600">
                                        {previewMatchingAnswer[pair.left]}
                                      </span>
                                    )}
                                  </button>
                                ))}
                              </div>
                              <div className="space-y-2">
                                {previewMatchingOptions.map((pair, index) => {
                                  const used = Object.values(
                                    previewMatchingAnswer,
                                  ).includes(pair.right);
                                  return (
                                    <button
                                      key={`preview-matching-right-${pair.right}-${index}`}
                                      data-matching-right-key={pair.right}
                                      ref={(element) => {
                                        previewMatchingRightRefs.current[
                                          pair.right
                                        ] = element;
                                      }}
                                      type="button"
                                      onClick={() =>
                                        previewMatchingActiveLeft &&
                                        setPreviewMatchingAnswer((prev) => ({
                                          ...prev,
                                          [previewMatchingActiveLeft]:
                                            pair.right,
                                        }))
                                      }
                                      className={`relative z-20 flex w-full items-center gap-3 rounded-lg border-2 p-3 text-left text-sm font-bold transition ${used ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 bg-white hover:border-blue-300"}`}
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
                              <MatchingConnectionLines
                                containerRef={previewMatchingContainerRef}
                                leftRefs={previewMatchingLeftRefs}
                                rightRefs={previewMatchingRightRefs}
                                connections={previewConnections}
                              />
                            </div>
                          );
                        })()}
                    </div>
                  </div>
                )}

                <QuizLearningMetadataFields
                  value={editMetadata}
                  onChange={setEditMetadata}
                  options={
                    editType === "choice"
                      ? getChoiceOptionItems(
                          editChoiceOptions,
                          editChoiceOptionImages,
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
                <p className="text-sm text-amber-800">
                  수정한 문항은 이후 출제에 반영됩니다. 이미 제출된 새 평가
                  기록의 점수와 출제 당시 문항은 유지됩니다.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={openPreview}
                    className={`font-bold py-2 rounded transition border ${previewOpen ? "bg-white text-blue-700 border-blue-500" : "bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-700"}`}
                  >
                    {previewOpen ? "미리보기 닫기" : "미리보기"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveEditedQuestion()}
                    disabled={savingEdit || optimizingImage}
                    className="bg-blue-600 text-white font-bold py-2 rounded hover:bg-blue-700 transition disabled:bg-blue-300"
                  >
                    {optimizingImage
                      ? "이미지 줄이는 중..."
                      : savingEdit
                        ? "저장 중..."
                        : "수정 저장"}
                  </button>
                  <button
                    type="button"
                    onClick={() => closeEditModal()}
                    className="bg-gray-100 text-gray-700 font-bold py-2 rounded hover:bg-gray-200 transition"
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {savingEdit && (
        <LoadingOverlay
          message="문제를 저장하는 중입니다."
          detail="서버 저장이 끝날 때까지 잠시만 기다려 주세요."
        />
      )}
    </div>
  );
};

export default QuizBankTab;
