import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    query,
} from 'firebase/firestore';
import { db } from './firebase';
import { getSemesterCollectionPath, getSemesterDocPath } from './semesterScope';

export type SemesterReadinessStatus = 'ready' | 'partial' | 'danger';

type ReadinessItemKey =
    | 'curriculumTree'
    | 'assessmentSettings'
    | 'finalExam'
    | 'gradingPlans'
    | 'calendar'
    | 'notices'
    | 'pointProducts'
    | 'quizQuestions'
    | 'historyClassrooms'
    | 'mapResources';

export interface SemesterReadinessItem {
    key: ReadinessItemKey;
    label: string;
    ready: boolean;
    advisory?: boolean;
}

export interface SemesterReadinessResult {
    status: SemesterReadinessStatus;
    requiredItems: SemesterReadinessItem[];
    advisoryItems: SemesterReadinessItem[];
    missingRequiredCount: number;
}

const hasKeys = (value: unknown) =>
    !!value && typeof value === 'object' && Object.keys(value as Record<string, unknown>).length > 0;

const hasShellReadyFlag = (value: unknown) =>
    !!value
    && typeof value === 'object'
    && (value as { shellReady?: unknown }).shellReady === true;

const hasCollectionContent = async (path: string) => {
    const snap = await getDocs(query(collection(db, path), limit(1)));
    return !snap.empty;
};

const hasFinalExamContent = (value: unknown) => {
    if (!value || typeof value !== 'object') return false;

    const data = value as {
        objective?: unknown;
        subjective?: unknown;
    };

    const hasObjective = Array.isArray(data.objective) && data.objective.length > 0;
    const hasSubjective = Array.isArray(data.subjective)
        && data.subjective.some((item) => (
            item
            && typeof item === 'object'
            && Array.isArray((item as { subItems?: unknown[] }).subItems)
            && ((item as { subItems?: unknown[] }).subItems?.length || 0) > 0
        ));

    return hasObjective || hasSubjective;
};

export const loadSemesterReadiness = async (year: string, semester: string): Promise<SemesterReadinessResult> => {
    const config = { year, semester };

    const [
        curriculumSnap,
        assessmentSnap,
        finalExamSnap,
        gradingPlansMetaSnap,
        calendarMetaSnap,
        noticesMetaSnap,
        gradingPlansReady,
        calendarReady,
        noticesReady,
        pointProductsReady,
        quizQuestionsReady,
        historyClassroomsReady,
        mapResourcesReady,
    ] = await Promise.all([
        getDoc(doc(db, getSemesterDocPath(config, 'curriculum', 'tree'))),
        getDoc(doc(db, getSemesterDocPath(config, 'assessment_config', 'settings'))),
        getDoc(doc(db, getSemesterDocPath(config, 'exam_config', 'final_exam'))),
        getDoc(doc(db, getSemesterDocPath(config, 'grading_plans_meta', 'current'))),
        getDoc(doc(db, getSemesterDocPath(config, 'calendar_meta', 'current'))),
        getDoc(doc(db, getSemesterDocPath(config, 'notices_meta', 'current'))),
        hasCollectionContent(getSemesterCollectionPath(config, 'grading_plans')),
        hasCollectionContent(getSemesterCollectionPath(config, 'calendar')),
        hasCollectionContent(getSemesterCollectionPath(config, 'notices')),
        hasCollectionContent(getSemesterCollectionPath(config, 'point_products')),
        hasCollectionContent(getSemesterCollectionPath(config, 'quiz_questions')),
        hasCollectionContent(getSemesterCollectionPath(config, 'history_classrooms')),
        hasCollectionContent(getSemesterCollectionPath(config, 'map_resources')),
    ]);

    const requiredItems: SemesterReadinessItem[] = [
        {
            key: 'curriculumTree',
            label: '\uad50\uc721\uacfc\uc815 \ud2b8\ub9ac',
            ready: curriculumSnap.exists()
                && Array.isArray(curriculumSnap.data().tree)
                && curriculumSnap.data().tree.length > 0,
        },
        {
            key: 'assessmentSettings',
            label: '\ud3c9\uac00 \uc124\uc815',
            ready: assessmentSnap.exists() && hasKeys(assessmentSnap.data()),
        },
        {
            key: 'finalExam',
            label: '\uc2dc\ud5d8 \uad6c\uc131',
            ready: finalExamSnap.exists()
                && (hasFinalExamContent(finalExamSnap.data()) || hasShellReadyFlag(finalExamSnap.data())),
        },
        {
            key: 'gradingPlans',
            label: '\ucc44\uc810 \uacc4\ud68d',
            ready: gradingPlansReady || gradingPlansMetaSnap.exists(),
        },
        {
            key: 'calendar',
            label: '\ud559\uc0ac \uc77c\uc815',
            ready: calendarReady || calendarMetaSnap.exists(),
        },
        {
            key: 'notices',
            label: '\uacf5\uc9c0',
            ready: noticesReady || noticesMetaSnap.exists(),
        },
        {
            key: 'pointProducts',
            label: '\ud3ec\uc778\ud2b8 \uc0c1\ud488',
            ready: pointProductsReady,
        },
    ];

    const advisoryItems: SemesterReadinessItem[] = [
        {
            key: 'quizQuestions',
            label: '\ubb38\uc81c\uc740\ud589',
            ready: quizQuestionsReady,
            advisory: true,
        },
        {
            key: 'historyClassrooms',
            label: '\ud788\uc2a4\ud1a0\ub9ac \ud074\ub798\uc2a4\ub8f8',
            ready: historyClassroomsReady,
            advisory: true,
        },
        {
            key: 'mapResources',
            label: '\uc9c0\ub3c4 \uc790\ub8cc',
            ready: mapResourcesReady,
            advisory: true,
        },
    ];

    const criticalAcademicMissing = requiredItems.some((item) => (
        ['curriculumTree', 'assessmentSettings', 'finalExam'] as ReadinessItemKey[]
    ).includes(item.key) && !item.ready);
    const missingRequiredCount = requiredItems.filter((item) => !item.ready).length;
    const allRequiredReady = missingRequiredCount === 0;

    let status: SemesterReadinessStatus = 'partial';
    if (allRequiredReady) {
        status = 'ready';
    } else if (criticalAcademicMissing || missingRequiredCount >= 3) {
        status = 'danger';
    }

    return {
        status,
        requiredItems,
        advisoryItems,
        missingRequiredCount,
    };
};
