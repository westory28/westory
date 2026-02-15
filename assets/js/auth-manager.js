

// Menu Configurations
const MENUS = {
    student: [
        {
            name: "학습", url: "student/lesson/note.html", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
            children: [
                { name: "수업 자료", url: "student/lesson/note.html" } // Main entry
            ]
        },
        {
            name: "평가", url: "student/quiz.html", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
        },
        {
            name: "성적", url: "student/score.html", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
            children: [
                { name: "나의 성적표", url: "student/score.html" },
                { name: "정기 시험 답안", url: "student/mark-exam.html" }
            ]
        }
    ],
    teacher: [
        { name: "수업 자료 관리", url: "teacher/manage_lesson.html", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" },
        {
            name: "평가 관리", url: "teacher/manage_quiz.html", icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
            children: [
                { name: "문제 등록", url: "teacher/manage_quiz.html" },
                { name: "제출 현황", url: "teacher/manage_quiz.html?tab=log" },
                { name: "전체 문제 은행", url: "teacher/manage_quiz.html?tab=bank" }
            ]
        },
        {
            name: "점수 관리", url: "teacher/manage_exam.html", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
            children: [
                { name: "성적 산출 기준", url: "teacher/manage_exam.html" },
                { name: "정기 시험 답안", url: "teacher/manage_exam.html?tab=omr" }
            ]
        },
        { name: "학생 명단 관리", url: "teacher/student-list.html", icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" }
    ]
};

const TEACHER_EMAIL = "westoria28@gmail.com";

// --- Global Config State ---
window.currentConfig = {
    year: '2025',
    semester: '2',
    showQuiz: true,
    showScore: true,
    showLesson: true
};

// --- Dynamic Collection Helper ---
window.getCollection = function (collectionName) {
    const globalCollections = ['users', 'site_settings', 'metadata'];
    if (globalCollections.includes(collectionName)) {
        return window.db.collection(collectionName);
    }
    // All collections use semesters path (curriculum, notices, quiz, etc.)
    return window.db.collection('years')
        .doc(window.currentConfig.year)
        .collection('semesters')
        .doc(window.currentConfig.semester)
        .collection(collectionName);
};

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.userType = null;
        this.userData = null;
        this.rootPrefix = this.calculateRootPrefix();
    }

    calculateRootPrefix() {
        const path = window.location.pathname;
        if (path.includes('/student/lesson/')) return '../../';
        if (path.includes('/student/assessment/') || path.includes('/student/score/')) return '../../';
        if (path.includes('/student/') || path.includes('/teacher/')) return '../';
        return './';
    }

    init(type, requireAuth = true) {
        this.userType = type;

        this.loadGlobalConfig().then(() => {
            window.auth.onAuthStateChanged((user) => {
                if (user) {
                    this.currentUser = user;

                    this.loadHeader();
                    this.loadFooter();
                    this.initSessionTimer();
                    this.updateUserInfo(user.displayName || (type === 'teacher' ? '선생님' : '학생'));

                    if (type === 'teacher') {
                        if (user.email !== TEACHER_EMAIL) {
                            alert("교사 전용 페이지입니다. 학생 대시보드로 이동합니다.");
                            window.location.href = this.rootPrefix + 'student/dashboard.html';
                            return;
                        }
                        this.initDDayBanner(true); // Teacher sees common + all class events if needed, usually just common or nothing. Let's show common.
                    }

                    this.fetchAdditionalUserData(user, type);
                    document.dispatchEvent(new CustomEvent('auth-ready', { detail: user }));
                } else {
                    if (requireAuth) window.location.href = this.rootPrefix + 'index.html';
                }
            });
        });
    }

    async loadGlobalConfig() {
        try {
            const doc = await window.db.collection('site_settings').doc('config').get();
            if (doc.exists) {
                const data = doc.data();
                window.currentConfig = { ...window.currentConfig, ...data };
            }
        } catch (e) {
            console.warn("Config load failed, using default", e);
        }
    }

    async fetchAdditionalUserData(user, type) {
        try {
            const doc = await window.db.collection('users').doc(user.uid).get();
            if (doc.exists) {
                const data = doc.data();
                this.userData = data; // Store for D-Day logic
                if (data.name) this.updateUserInfo(data.name);
                if (type === 'student') {
                    if (!data.privacyAgreed) this.showPrivacyModal(user.uid);
                    this.initDDayBanner(false); // Student D-Day Init
                }
            }
        } catch (e) { console.error("DB Error:", e); }
    }

    async initDDayBanner(isTeacher) {
        const bannerContainer = document.getElementById('dday-container');
        if (!bannerContainer) return;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().split('T')[0];

        try {
            // Fetch future events
            const calPath = `years/${window.currentConfig.year}/calendar`;
            const snapshot = await window.db.collection(calPath)
                .where('start', '>=', todayStr)
                .orderBy('start')
                .limit(10)
                .get();

            if (snapshot.empty) return;

            let closestEvent = null;
            let minDiff = Infinity;

            const myClassStr = (this.userData && this.userData.grade && this.userData.class)
                ? `${this.userData.grade}-${this.userData.class}`
                : null;

            snapshot.forEach(doc => {
                const ev = doc.data();

                // Filter Logic
                if (!isTeacher) {
                    if (ev.targetType === 'class' && ev.targetClass !== myClassStr) return; // Skip other classes
                }

                // Check Type & Days
                const eventDate = new Date(ev.start);
                const diffTime = eventDate - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                let isCandidate = false;

                // Exam: Show from D-30
                if (ev.eventType === 'exam' && diffDays <= 30) isCandidate = true;
                // Performance: Show from D-7
                if (ev.eventType === 'performance' && diffDays <= 7) isCandidate = true;

                if (isCandidate && diffDays < minDiff) {
                    minDiff = diffDays;
                    closestEvent = { ...ev, dDay: diffDays };
                }
            });

            if (closestEvent) {
                const colorClass = closestEvent.eventType === 'exam' ? 'bg-red-100 text-red-700 border-red-200' : 'bg-amber-100 text-amber-700 border-amber-200';
                const dText = closestEvent.dDay === 0 ? "D-Day" : `D-${closestEvent.dDay}`;
                const targetUrl = isTeacher ? 'teacher/settings.html?tab=schedule' : 'student/calendar.html';

                bannerContainer.innerHTML = `
                    <div onclick="location.href='${this.rootPrefix}${targetUrl}'" 
                         class="cursor-pointer flex items-center gap-2 px-3 py-1 rounded-full border ${colorClass} text-xs font-bold shadow-sm hover:opacity-80 transition animate-pulse">
                        <span>${closestEvent.title}</span>
                        <span class="bg-white px-1.5 rounded-md shadow-sm">${dText}</span>
                    </div>
                `;
            }

        } catch (e) { console.error("D-Day Error", e); }
    }

    async showPrivacyModal(uid) {
        // Fetch custom privacy text
        let privacyContent = `
            <p class="font-bold mb-2">[수집 및 이용 목적]</p>
            <p>1. 학습 기록 관리 및 성적 산출</p>
            <p>2. 맞춤형 학습 콘텐츠 제공</p>
            <p>3. 교사의 학생 지도 및 상담 자료 활용</p>
            <br>
            <p class="font-bold mb-2">[수집 항목]</p>
            <p>이름, 이메일, 학년, 반, 번호, 퀴즈 응시 내역</p>
            <br>
            <p class="font-bold mb-2">[보유 기간]</p>
            <p>회원 탈퇴 시 또는 졸업 시까지</p>
        `;

        try {
            const doc = await window.db.collection('site_settings').doc('privacy').get();
            if (doc.exists && doc.data().text) {
                privacyContent = doc.data().text;
            }
        } catch (e) { console.warn("Failed to load custom privacy text", e); }

        const modalHtml = `
            <div id="global-privacy-modal" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-70 backdrop-blur-sm">
                <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg p-8 mx-4">
                    <div class="text-center mb-6">
                        <div class="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">🛡️</div>
                        <h2 class="text-2xl font-bold text-gray-900">개인정보 활용 동의</h2>
                        <p class="text-gray-500 text-sm mt-2">서비스 이용을 위해 최초 1회 동의가 필요합니다.</p>
                    </div>
                    <div class="bg-gray-50 p-4 rounded-lg text-sm text-gray-600 h-60 overflow-y-auto mb-6 border border-gray-200 leading-relaxed custom-scroll">
                        ${privacyContent}
                    </div>
                    <div class="flex items-center justify-center gap-2 mb-6 cursor-pointer" onclick="document.getElementById('privacy-check').click()">
                        <input type="checkbox" id="privacy-check" class="w-5 h-5 text-blue-600 rounded focus:ring-blue-500">
                        <label for="privacy-check" class="font-bold text-gray-700 cursor-pointer select-none">위 내용에 동의합니다 (필수)</label>
                    </div>
                    <button id="btn-privacy-confirm" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition disabled:bg-gray-300 disabled:cursor-not-allowed" disabled>
                        동의하고 시작하기
                    </button>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const checkbox = document.getElementById('privacy-check');
        const btn = document.getElementById('btn-privacy-confirm');
        checkbox.addEventListener('change', (e) => { btn.disabled = !e.target.checked; });
        btn.addEventListener('click', async () => {
            try {
                await window.db.collection('users').doc(uid).update({ privacyAgreed: true });
                document.getElementById('global-privacy-modal').remove();
            } catch (e) { alert("오류 발생"); }
        });
    }

    loadHeader() {
        const existingHeader = document.querySelector('header');
        if (existingHeader) existingHeader.remove();

        const menuItems = MENUS[this.userType] || [];
        const resolve = (url) => this.rootPrefix + url;
        const currentPath = window.location.pathname;
        const isActive = (url) => currentPath.endsWith(url.split('/').pop().split('?')[0]);
        const isDashboard = currentPath.includes('dashboard.html');

        let navHtml = '';
        let mobileNavHtml = '';
        let mobileToggleBtn = '';

        // Always render navigation (User Request: Show on all pages including dashboard)
        // Hidden on mobile via style.css (.desktop-nav class)
        navHtml = `<nav class="desktop-nav items-center h-full ml-6">
            ${menuItems.map(item => {
            const active = isActive(item.url) ? 'active' : '';
            if (item.children) {
                const childrenHtml = item.children.map(child => `
                        <a href="${resolve(child.url)}" class="block px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-b border-gray-50 last:border-0 whitespace-nowrap">
                            ${child.name}
                        </a>
                    `).join('');

                return `
                        <div class="relative group h-full flex items-center">
                            <a href="${resolve(item.url)}" class="nav-link ${active} flex items-center gap-1">
                                ${item.name} <i class="fas fa-chevron-down text-[10px] ml-1 opacity-50 group-hover:opacity-100 transition"></i>
                            </a>
                            <div class="absolute top-full left-0 w-48 pt-3 invisible opacity-0 group-hover:visible group-hover:opacity-100 transition duration-200 transform translate-y-2 group-hover:translate-y-0 z-[100]">
                                <div class="bg-white border border-gray-200 shadow-xl rounded-xl overflow-hidden">
                                    ${childrenHtml}
                                </div>
                            </div>
                        </div>
                    `;
            }
            return `<a href="${resolve(item.url)}" class="nav-link ${active}">${item.name}</a>`;
        }).join('')}
        </nav>`;
        mobileNavHtml = `<div id="mobile-menu" class="border-t border-gray-100">
            ${menuItems.map(item => {
            let html = `<a href="${resolve(item.url)}" class="mobile-link ${isActive(item.url) ? 'active' : ''}">
                    <svg class="mobile-icon" viewBox="0 0 24 24"><path d="${item.icon}"></path></svg>
                    ${item.name}
                </a>`;

            if (item.children && item.children.length > 0) {
                html += `<div class="bg-gray-50 border-b border-gray-100 pb-2">
                        ${item.children.map(child => `
                            <a href="${resolve(child.url)}" class="block pl-12 pr-4 py-2 text-sm text-gray-500 hover:text-blue-600 hover:bg-gray-100 rounded-r-full mr-2">
                                <i class="fas fa-angle-right mr-2 text-xs opacity-50"></i>${child.name}
                            </a>
                        `).join('')}
                    </div>`;
            }
            return html;
        }).join('')}
        </div>`;
        mobileToggleBtn = `<button id="mobile-menu-toggle" class="mobile-menu-btn"><i class="fas fa-bars"></i></button>`;

        const dashboardLink = this.userType === 'teacher' ? resolve('teacher/dashboard.html') : resolve('student/dashboard.html');
        // Changed: Settings icon now links to page, not modal
        let settingsIcon = this.userType === 'teacher' ? `<a href="${resolve('teacher/settings.html')}" class="text-gray-400 hover:text-blue-600 cursor-pointer transition p-1 mr-2" title="관리자 설정"><i class="fas fa-cog fa-lg"></i></a>` : '';
        const semInfo = `<span class="hidden md:inline-block text-xs font-mono bg-gray-100 text-gray-500 px-2 py-1 rounded mr-2 border border-gray-200">${window.currentConfig.year}-${window.currentConfig.semester}</span>`;

        // Student MyPage Link
        let myPageLink = '';
        if (this.userType === 'student') {
            myPageLink = `
                <a href="${resolve('student/mypage.html')}" class="text-gray-400 hover:text-blue-600 transition p-1 mr-2" title="마이페이지로 이동">
                    <i class="fas fa-user-circle fa-lg"></i>
                </a>
            `;
        }

        const headerHtml = `
            <header class="z-[60]">
                <div class="header-container">
                    <div class="flex items-center gap-4">
                        <a href="${dashboardLink}" class="logo-text"><span class="logo-we">We</span><span class="logo-story">story</span></a>
                        ${navHtml}
                    </div>
                    <div class="flex items-center gap-3">
                        <div id="dday-container" class="hidden md:block"></div> <!-- D-Day Banner Area (Hidden on Mobile) -->
                        ${semInfo}
                        ${settingsIcon}
                        <div class="flex items-center gap-2 group cursor-pointer" ${this.userType === 'student' ? `onclick="location.href='${resolve('student/mypage.html')}'"` : ''}>
                            <!-- Header greeting hidden on small mobile, shown on md+ via .user-greeting class -->
                            <span id="header-greeting" class="user-greeting text-sm font-bold text-stone-700 whitespace-nowrap group-hover:text-blue-600 transition"></span>
                            ${myPageLink}
                        </div>
                        
                        <!-- Timer -->
                        <div class="flex items-center gap-1 md:gap-2 px-3 py-1 bg-stone-100 rounded-full border border-stone-200 ml-2">
                            <i class="fas fa-stopwatch text-stone-400 text-xs"></i>
                            <span id="session-timer-display" class="font-mono font-bold text-stone-600 text-sm w-[42px] text-center">60:00</span>
                            <button id="btn-extend-session" class="ml-1 text-stone-400 hover:text-blue-600 transition p-1" title="시간 초기화"><i class="fas fa-redo-alt text-xs"></i></button>
                        </div>

                        <button id="logout-btn" class="text-stone-400 hover:text-stone-800 text-sm font-bold whitespace-nowrap ml-2">로그아웃</button>
                        ${mobileToggleBtn}
                    </div>
                </div>
                ${mobileNavHtml}
            </header>
        `;

        document.body.insertAdjacentHTML('afterbegin', headerHtml);

        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
        document.getElementById('btn-extend-session').addEventListener('click', () => this.extendSession());

        // Mobile Menu Logic
        const mobileBtn = document.getElementById('mobile-menu-toggle');
        const mobileMenu = document.getElementById('mobile-menu');
        if (mobileBtn && mobileMenu) {
            mobileBtn.addEventListener('click', (e) => { e.stopPropagation(); mobileMenu.classList.toggle('open'); });
            document.addEventListener('click', (e) => {
                if (mobileMenu.classList.contains('open') && !mobileMenu.contains(e.target) && !mobileBtn.contains(e.target)) {
                    mobileMenu.classList.remove('open');
                }
            });
        }
    }

    loadFooter() {
        const existingFooter = document.querySelector('footer');
        if (existingFooter) existingFooter.remove();
        const footerHtml = `<footer class="bg-white border-t border-stone-200 py-4 mt-auto"><div class="container mx-auto text-center"><p class="text-stone-400 text-xs font-bold font-mono">Copyright © 용신중학교 역사교사 방재석. All rights reserved.</p></div></footer>`;
        document.body.insertAdjacentHTML('beforeend', footerHtml);
    }

    updateUserInfo(name) {
        const greetingEl = document.getElementById('header-greeting');
        if (greetingEl && name) {
            const suffix = (this.userType === 'teacher') ? ' 교사' : ' 학생';
            greetingEl.textContent = name + suffix;
        }

        const welcomeEl = document.getElementById('welcome-text');
        if (welcomeEl && name) {
            welcomeEl.innerText = `${name}님, 환영합니다!`;
        }
    }

    initSessionTimer() {
        let expiry = localStorage.getItem('sessionExpiry');
        if (!expiry) { this.extendSession(); } else { this.startTimerInterval(); }
    }

    extendSession() {
        const now = Date.now();
        const expiry = now + (60 * 60 * 1000);
        localStorage.setItem('sessionExpiry', expiry);
        this.startTimerInterval();
        const display = document.getElementById('session-timer-display');
        if (display) { display.textContent = "60:00"; display.classList.remove('text-red-500'); }
    }

    startTimerInterval() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        const display = document.getElementById('session-timer-display');
        this.updateTimerDisplay(display);
        this.timerInterval = setInterval(() => { this.updateTimerDisplay(display); }, 1000);
    }

    updateTimerDisplay(display) {
        if (!display) return;
        const expiry = parseInt(localStorage.getItem('sessionExpiry') || '0');
        const now = Date.now();
        const diff = expiry - now;
        if (diff <= 0) {
            clearInterval(this.timerInterval);
            alert("세션이 만료되어 자동 로그아웃됩니다.");
            this.logout();
        } else {
            const m = Math.floor(diff / 60000);
            const s = Math.floor((diff % 60000) / 1000);
            display.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            if (m < 5) display.classList.add('text-red-500');
            else display.classList.remove('text-red-500');
        }
    }

    logout() {
        localStorage.removeItem('sessionExpiry');
        window.auth.signOut().then(() => { window.location.href = this.rootPrefix + 'index.html'; });
    }
}

window.AuthManager = new AuthManager();
