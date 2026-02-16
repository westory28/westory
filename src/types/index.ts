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
    start: string;
    end?: string;
    eventType: 'exam' | 'performance' | 'event';
    targetType: 'all' | 'class';
    targetClass?: string;
    dDay?: number;
}
