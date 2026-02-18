export interface SystemConfig {
    year: string;
    semester: string;
    showQuiz: boolean;
    showScore: boolean;
    showLesson: boolean;
}

export interface InterfaceConfig {
    mainEmoji: string;
    mainSubtitle: string;
    ddayEnabled: boolean;
    ddayTitle: string;
    ddayDate: string;
    footerText?: string;
}

export interface UserData {
    uid: string;
    email: string;
    name?: string;
    profileIcon?: string;
    customNameConfirmed?: boolean;
    grade?: string;
    class?: string;
    number?: string;
    role: 'teacher' | 'student';
    privacyAgreed?: boolean;
    privacyAgreedAt?: any;
    consentAgreedItems?: string[];
}

export interface CalendarEvent {
    id: string;
    title: string;
    description?: string;
    start: string;
    end?: string;
    eventType: 'exam' | 'performance' | 'event' | 'diagnosis' | 'formative' | 'holiday';
    targetType: 'all' | 'common' | 'class';
    targetClass?: string;
    dDay?: number;
}
