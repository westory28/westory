
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

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.userType = null;
        this.rootPrefix = this.calculateRootPrefix();
    }

    calculateRootPrefix() {
        const path = window.location.pathname;
        
        // Depth 2 (e.g. /student/lesson/note.html)
        if (path.includes('/student/lesson/')) return '../../';
        if (path.includes('/student/assessment/')) return '../../'; // Just in case
        if (path.includes('/student/score/')) return '../../';      // Just in case
        
        // Depth 1 (e.g. /student/dashboard.html, /teacher/dashboard.html)
        if (path.includes('/student/') || path.includes('/teacher/')) return '../';
        
        // Root (index.html)
        return './';
    }

    init(type, requireAuth = true) {
        this.userType = type;
        
        window.auth.onAuthStateChanged(async (user) => {
            if (user) {
                this.currentUser = user;
                
                // Teacher Security Check
                if (type === 'teacher' && user.email !== TEACHER_EMAIL) {
                    alert("교사 전용 페이지입니다. 학생 대시보드로 이동합니다.");
                    window.location.href = this.rootPrefix + 'student/dashboard.html';
                    return;
                }

                // Check Privacy Consent (Crucial Step)
                await this.checkPrivacyConsent(user);

                await this.loadHeader();
                this.loadFooter(); // Inject Footer
                this.updateUserInfo(user);
                
                // Initialize Session Timer for Teacher
                if (type === 'teacher') {
                    this.initSessionTimer();
                }

                document.dispatchEvent(new CustomEvent('auth-ready', { detail: user }));
            } else {
                if (requireAuth) {
                    window.location.href = this.rootPrefix + 'index.html';
                }
            }
        });
    }

    async checkPrivacyConsent(user) {
        if (user.email === TEACHER_EMAIL) return; // Skip for teacher

        try {
            const doc = await window.db.collection('users').doc(user.uid).get();
            if (doc.exists) {
                const data = doc.data();
                if (!data.privacyAgreed) {
                    this.showPrivacyModal(user.uid);
                }
            }
        } catch (e) {
            console.error("Privacy check failed", e);
        }
    }

    showPrivacyModal(uid) {
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
        
        checkbox.addEventListener('change', (e) => {
            btn.disabled = !e.target.checked;
        });

        btn.addEventListener('click', async () => {
            try {
                await window.db.collection('users').doc(uid).update({
                    privacyAgreed: true,
                    privacyAgreedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                document.getElementById('global-privacy-modal').remove();
            } catch (e) {
                alert("처리 중 오류가 발생했습니다.");
            }
        });
    }

    async loadHeader() {
        const existingHeader = document.querySelector('header');
        if (existingHeader) existingHeader.remove();

        const menuItems = MENUS[this.userType] || [];
        const resolve = (url) => this.rootPrefix + url;
        const currentPath = window.location.pathname;
        const isActive = (url) => currentPath.endsWith(url.split('/').pop()); // Improved active check
        
        // Determine if current page is Dashboard
        const isDashboard = currentPath.includes('dashboard.html');

        // Build Nav HTML only if NOT dashboard
        let navHtml = '';
        let mobileNavHtml = '';
        let mobileToggleBtn = '';

        if (!isDashboard) {
            navHtml = `
                <nav class="desktop-nav">
                    ${menuItems.map(item => `
                        <a href="${resolve(item.url)}" class="nav-link ${isActive(item.url) ? 'active' : ''}">${item.name}</a>
                    `).join('')}
                </nav>
            `;
            
            mobileNavHtml = `
                <div id="mobile-menu">
                    ${menuItems.map(item => `
                        <a href="${resolve(item.url)}" class="mobile-link ${isActive(item.url) ? 'active' : ''}">
                            <svg class="mobile-icon" viewBox="0 0 24 24"><path d="${item.icon}"></path></svg>
                            ${item.name}
                        </a>
                    `).join('')}
                </div>
            `;

            mobileToggleBtn = `
                <button id="mobile-menu-toggle" class="mobile-menu-btn"><i class="fas fa-bars"></i></button>
            `;
        }

        // Dashboard Link based on Role
        const dashboardLink = this.userType === 'teacher' ? resolve('teacher/dashboard.html') : resolve('student/dashboard.html');

        // Right Side Content
        let rightSideHtml = '';
        if (this.userType === 'teacher') {
            rightSideHtml = `
                <div class="flex items-center gap-3">
                    <span id="header-settings-btn" class="text-gray-400 hover:text-blue-600 cursor-pointer transition p-1" title="설정">
                        <i class="fas fa-cog fa-lg"></i>
                    </span>
                    <div class="hidden md:flex items-center bg-gray-100 rounded-full px-3 py-1">
                        <span class="text-xs font-bold text-gray-500 mr-2"><i class="fas fa-clock"></i></span>
                        <span id="session-timer-display" class="text-xs font-mono font-bold text-red-500 w-10 text-center">60:00</span>
                        <button id="btn-extend-session" class="ml-2 text-[10px] bg-white border border-gray-300 rounded px-1 hover:bg-gray-50 text-blue-600">연장</button>
                    </div>
                    <span id="header-greeting" class="text-sm font-bold text-blue-600 hidden md:inline"></span>
                    <button id="logout-btn" class="text-gray-500 hover:text-gray-800 text-sm font-bold whitespace-nowrap">로그아웃</button>
                    ${mobileToggleBtn}
                </div>
            `;
        } else {
            // Student
            rightSideHtml = `
                <div class="flex items-center gap-4">
                    <span id="header-greeting" class="text-sm font-bold text-gray-600 hidden md:inline"></span>
                    <button id="logout-btn" class="text-gray-500 hover:text-gray-800 text-sm font-bold whitespace-nowrap">로그아웃</button>
                    ${mobileToggleBtn}
                </div>
            `;
        }

        const headerHtml = `
            <header>
                <div class="header-container">
                    <a href="${dashboardLink}" class="logo-text">
                        <span class="logo-we">We</span><span class="logo-story">story</span>
                    </a>
                    ${navHtml}
                    ${rightSideHtml}
                </div>
                ${mobileNavHtml}
            </header>
        `;

        document.body.insertAdjacentHTML('afterbegin', headerHtml);
        
        // Bind Events
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
        
        if (this.userType === 'teacher') {
            const extendBtn = document.getElementById('btn-extend-session');
            if(extendBtn) extendBtn.addEventListener('click', () => this.extendSession());
            
            const settingsBtn = document.getElementById('header-settings-btn');
            if(settingsBtn) settingsBtn.addEventListener('click', () => {
                document.dispatchEvent(new Event('open-settings'));
            });
        }

        // Mobile Menu Events
        const mobileBtn = document.getElementById('mobile-menu-toggle');
        const mobileMenu = document.getElementById('mobile-menu');
        if (mobileBtn && mobileMenu) {
            mobileBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                mobileMenu.classList.toggle('open');
            });
            document.addEventListener('click', (e) => {
                if (mobileMenu.classList.contains('open') && !mobileMenu.contains(e.target) && !mobileBtn.contains(e.target)) {
                    mobileMenu.classList.remove('open');
                }
            });
        }
    }

    loadFooter() {
        const existingFooter = document.querySelector('footer');
        if(existingFooter) existingFooter.remove();

        const footerHtml = `
            <footer class="bg-white border-t border-stone-200 py-8 mt-auto">
                <div class="container mx-auto text-center">
                    <p class="text-stone-400 text-xs font-bold font-mono">Copyright © 용신중학교 역사교사 방재석. All rights reserved.</p>
                </div>
            </footer>
        `;
        document.body.insertAdjacentHTML('beforeend', footerHtml);
    }

    updateUserInfo(user) {
        const greetingEl = document.getElementById('header-greeting');
        if (greetingEl) {
            const name = user.displayName || (this.userType === 'teacher' ? '선생님' : '학생');
            greetingEl.textContent = `${name} ${this.userType === 'teacher' ? '' : '님'}`;
        }
    }

    // Session Timer Logic (60 min)
    initSessionTimer() {
        let expiry = localStorage.getItem('sessionExpiry');
        if (!expiry) {
            this.extendSession();
        } else {
            this.startTimerInterval();
        }
    }

    extendSession() {
        const now = Date.now();
        const expiry = now + (60 * 60 * 1000); // 60 mins
        localStorage.setItem('sessionExpiry', expiry);
        this.startTimerInterval();
        alert("세션이 60분 연장되었습니다.");
    }

    startTimerInterval() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        
        const display = document.getElementById('session-timer-display');
        
        this.timerInterval = setInterval(() => {
            const expiry = parseInt(localStorage.getItem('sessionExpiry') || '0');
            const now = Date.now();
            const diff = expiry - now;

            if (diff <= 0) {
                clearInterval(this.timerInterval);
                alert("세션이 만료되었습니다.");
                this.logout();
            } else {
                if(display) {
                    const m = Math.floor(diff / 60000);
                    const s = Math.floor((diff % 60000) / 1000);
                    display.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
                }
            }
        }, 1000);
    }

    logout() {
        localStorage.removeItem('sessionExpiry');
        window.auth.signOut().then(() => {
            window.location.href = this.rootPrefix + 'index.html';
        });
    }
}

window.AuthManager = new AuthManager();
