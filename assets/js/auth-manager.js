
// Menu Configurations
const MENUS = {
    student: [
        { name: "수업 자료", url: "student/lesson/note.html", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" },
        { name: "평가", url: "student/quiz.html", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
        { name: "점수", url: "student/score.html", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" }
    ],
    teacher: [
        { name: "수업 자료 관리", url: "teacher/manage_lesson.html", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" },
        { name: "평가 관리", url: "teacher/manage_quiz.html", icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" },
        { name: "점수 관리", url: "teacher/manage_exam.html", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
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
window.getCollection = function(collectionName) {
    const globalCollections = ['users', 'site_settings', 'metadata'];
    if (globalCollections.includes(collectionName)) {
        return window.db.collection(collectionName);
    }
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
                    this.updateUserInfo(user.displayName || (type==='teacher'?'선생님':'학생'));

                    if (type === 'teacher') {
                        if (user.email !== TEACHER_EMAIL) {
                            alert("교사 전용 페이지입니다. 학생 대시보드로 이동합니다.");
                            window.location.href = this.rootPrefix + 'student/dashboard.html';
                            return;
                        }
                        this.injectSettingsModal(); 
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
                if (data.name) this.updateUserInfo(data.name);
                if (type === 'student' && !data.privacyAgreed) this.showPrivacyModal(user.uid);
            }
        } catch (e) { console.error("DB Error:", e); }
    }

    showPrivacyModal(uid) {
        // (Previously defined privacy modal code remains the same)
        const modalHtml = `
            <div id="global-privacy-modal" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-70 backdrop-blur-sm">
                <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg p-8 mx-4">
                    <div class="text-center mb-6">
                        <div class="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">🛡️</div>
                        <h2 class="text-2xl font-bold text-gray-900">개인정보 활용 동의</h2>
                        <p class="text-gray-500 text-sm mt-2">서비스 이용을 위해 최초 1회 동의가 필요합니다.</p>
                    </div>
                    <div class="bg-gray-50 p-4 rounded-lg text-sm text-gray-600 h-40 overflow-y-auto mb-6 border border-gray-200 leading-relaxed">
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
        const isActive = (url) => currentPath.endsWith(url.split('/').pop());
        const isDashboard = currentPath.includes('dashboard.html');

        let navHtml = '';
        let mobileNavHtml = '';
        let mobileToggleBtn = '';

        if (!isDashboard) {
            navHtml = `<nav class="desktop-nav flex items-center h-full ml-6">${menuItems.map(item => `<a href="${resolve(item.url)}" class="nav-link ${isActive(item.url) ? 'active' : ''}">${item.name}</a>`).join('')}</nav>`;
            mobileNavHtml = `<div id="mobile-menu">${menuItems.map(item => `<a href="${resolve(item.url)}" class="mobile-link ${isActive(item.url) ? 'active' : ''}"><svg class="mobile-icon" viewBox="0 0 24 24"><path d="${item.icon}"></path></svg>${item.name}</a>`).join('')}</div>`;
            mobileToggleBtn = `<button id="mobile-menu-toggle" class="mobile-menu-btn"><i class="fas fa-bars"></i></button>`;
        }

        const dashboardLink = this.userType === 'teacher' ? resolve('teacher/dashboard.html') : resolve('student/dashboard.html');
        let settingsIcon = this.userType === 'teacher' ? `<span id="header-settings-btn" class="text-gray-400 hover:text-blue-600 cursor-pointer transition p-1 mr-2" title="설정"><i class="fas fa-cog fa-lg"></i></span>` : '';
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
            <header>
                <div class="header-container">
                    <div class="flex items-center gap-4">
                        <a href="${dashboardLink}" class="logo-text"><span class="logo-we">We</span><span class="logo-story">story</span></a>
                        ${navHtml}
                    </div>
                    <div class="flex items-center gap-3">
                        ${semInfo}
                        ${settingsIcon}
                        <div class="flex items-center gap-2 group cursor-pointer" ${this.userType === 'student' ? `onclick="location.href='${resolve('student/mypage.html')}'"` : ''}>
                            <span id="header-greeting" class="text-sm font-bold text-stone-700 whitespace-nowrap group-hover:text-blue-600 transition"></span>
                            ${myPageLink}
                        </div>
                        
                        <!-- Moved Timer Here -->
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

        if (this.userType === 'teacher') {
            const settingsBtn = document.getElementById('header-settings-btn');
            if(settingsBtn) settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); this.openSettingsModal(); });
        }

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

    // --- Global Settings Modal for Teacher --- (Existing code)
    injectSettingsModal() {
        if(document.getElementById('global-settings-modal')) return;
        window.closeSystemSettings = () => { document.getElementById('global-settings-modal').classList.add('hidden'); document.getElementById('global-settings-modal').classList.remove('flex'); };
        window.saveSystemSettings = async () => {
            const newConfig = {
                year: document.getElementById('global-config-year').value,
                semester: document.getElementById('global-config-sem').value,
                showQuiz: document.getElementById('global-toggle-quiz').checked,
                showScore: document.getElementById('global-toggle-score').checked,
                showLesson: document.getElementById('global-toggle-lesson').checked
            };
            try {
                await window.db.collection('site_settings').doc('config').set(newConfig, { merge: true });
                alert("설정이 저장되었습니다. 페이지를 새로고침합니다.");
                window.location.reload();
            } catch (e) { alert("설정 저장 실패: " + e.message); }
        };
        const modalHtml = `
            <div id="global-settings-modal" class="fixed inset-0 z-[9999] hidden flex items-center justify-center">
                <div class="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm" onclick="closeSystemSettings()"></div>
                <div class="bg-white rounded-xl shadow-2xl z-10 w-full max-w-md p-6 mx-4 transform transition-all">
                    <div class="flex justify-between items-center mb-6 pb-4 border-b">
                        <h2 class="text-xl font-bold text-gray-900"><i class="fas fa-cog mr-2"></i>시스템 설정</h2>
                        <button onclick="closeSystemSettings()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="space-y-6">
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-bold text-gray-700 mb-2">학년도</label>
                                <select id="global-config-year" class="w-full border border-gray-300 rounded-lg p-3 bg-gray-50 focus:ring-2 focus:ring-blue-500 font-bold text-gray-800">
                                    <option value="2025">2025학년도</option>
                                    <option value="2026">2026학년도</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-bold text-gray-700 mb-2">학기</label>
                                <select id="global-config-sem" class="w-full border border-gray-300 rounded-lg p-3 bg-gray-50 focus:ring-2 focus:ring-blue-500 font-bold text-gray-800">
                                    <option value="1">1학기</option>
                                    <option value="2">2학기</option>
                                </select>
                            </div>
                        </div>
                        <div class="bg-yellow-50 text-yellow-800 text-xs p-3 rounded border border-yellow-200 font-bold"><i class="fas fa-exclamation-triangle mr-1"></i> 학년도/학기를 변경하면 해당 기간의 데이터베이스로 즉시 전환됩니다.</div>
                        <div>
                            <label class="block text-sm font-bold text-gray-700 mb-2">메뉴 표시 제어</label>
                            <div class="space-y-3">
                                <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg"><span class="text-sm font-medium text-gray-700">평가(Quiz)</span><input type="checkbox" id="global-toggle-quiz" class="w-5 h-5 text-blue-600 rounded"></div>
                                <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg"><span class="text-sm font-medium text-gray-700">점수(Score)</span><input type="checkbox" id="global-toggle-score" class="w-5 h-5 text-blue-600 rounded"></div>
                                <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg"><span class="text-sm font-medium text-gray-700">수업자료(Lesson)</span><input type="checkbox" id="global-toggle-lesson" class="w-5 h-5 text-blue-600 rounded"></div>
                            </div>
                        </div>
                    </div>
                    <button onclick="saveSystemSettings()" class="w-full mt-8 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition shadow-lg">설정 저장</button>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    openSettingsModal() {
        const c = window.currentConfig;
        document.getElementById('global-config-year').value = c.year || '2025';
        document.getElementById('global-config-sem').value = c.semester || '2';
        document.getElementById('global-toggle-quiz').checked = c.showQuiz !== false;
        document.getElementById('global-toggle-score').checked = c.showScore !== false;
        document.getElementById('global-toggle-lesson').checked = c.showLesson !== false;
        document.getElementById('global-settings-modal').classList.remove('hidden');
        document.getElementById('global-settings-modal').classList.add('flex');
    }

    loadFooter() {
        const existingFooter = document.querySelector('footer');
        if(existingFooter) existingFooter.remove();
        const footerHtml = `<footer class="bg-white border-t border-stone-200 py-8 mt-auto"><div class="container mx-auto text-center"><p class="text-stone-400 text-xs font-bold font-mono">Copyright © 용신중학교 역사교사 방재석. All rights reserved.</p></div></footer>`;
        document.body.insertAdjacentHTML('beforeend', footerHtml);
    }

    updateUserInfo(name) {
        const greetingEl = document.getElementById('header-greeting');
        if (greetingEl && name) {
            const suffix = (this.userType === 'teacher') ? ' 교사' : ' 학생';
            greetingEl.textContent = name + suffix;
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
        if(display) { display.textContent = "60:00"; display.classList.remove('text-red-500'); }
    }

    startTimerInterval() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        const display = document.getElementById('session-timer-display');
        this.updateTimerDisplay(display);
        this.timerInterval = setInterval(() => { this.updateTimerDisplay(display); }, 1000);
    }

    updateTimerDisplay(display) {
        if(!display) return;
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
            if(m < 5) display.classList.add('text-red-500');
            else display.classList.remove('text-red-500');
        }
    }

    logout() {
        localStorage.removeItem('sessionExpiry');
        window.auth.signOut().then(() => { window.location.href = this.rootPrefix + 'index.html'; });
    }
}

window.AuthManager = new AuthManager();
