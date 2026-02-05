// Menu Configurations
const MENUS = {
    student: [
        { id: "menu-quiz", name: "역사 퀴즈", url: "./quiz.html", icon: "M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z" },
        { id: "menu-history", name: "학습 기록", url: "./history.html", icon: "M12 3L1 9l11 6 9-4.91V17h2V9M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z" },
        { id: "menu-score", name: "나의 성적표", url: "./score.html", icon: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-6 1.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5.67-1.5 1.5-1.5z" },
        { id: "menu-mark", name: "시험 채점", url: "./mark-exam.html", icon: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" }
    ],
    teacher: [
        { name: "역사 퀴즈 대시보드", url: "./quiz-admin.html", icon: "M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z" },
        { name: "학생 관리", url: "./student-list.html", icon: "M12 3L1 9l11 6 9-4.91V17h2V9M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z" },
        { name: "성적 산출 관리", url: "./score-admin.html", icon: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-6 1.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5.67-1.5 1.5-1.5z" },
        { name: "시험 채점 관리", url: "./mark-exam-admin.html", icon: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" }
    ]
};

const TEACHER_EMAIL = "westoria28@gmail.com";

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.userType = null; // 'student' or 'teacher'
    }

    /**
     * Initialize Auth Check and Header Injection
     * @param {string} type - 'student' or 'teacher'
     * @param {boolean} requireAuth - If true, redirects to index if not logged in
     */
    init(type, requireAuth = true) {
        this.userType = type;
        
        window.auth.onAuthStateChanged(async (user) => {
            if (user) {
                this.currentUser = user;
                
                // Strict Email Check for Teacher
                if (type === 'teacher' && user.email !== TEACHER_EMAIL) {
                    alert("교사 전용 페이지입니다. 학생 페이지로 이동합니다.");
                    window.location.href = '../student/dashboard.html';
                    return;
                }

                // Strict Check for Student accessing Teacher pages is handled above implicitly
                // but checking if Teacher accesses Student pages (optional, allowed but logged)
                
                await this.loadHeader();
                this.updateUserInfo(user);
                
                // Fire custom event for page-specific logic
                document.dispatchEvent(new CustomEvent('auth-ready', { detail: user }));
            } else {
                if (requireAuth) {
                    // Redirect to root index.html
                    window.location.href = '../index.html';
                }
            }
        });
    }

    async loadHeader() {
        // Remove existing header if present to avoid duplication
        const existingHeader = document.querySelector('header');
        if (existingHeader) existingHeader.remove();

        const menuItems = MENUS[this.userType] || [];
        const currentPath = window.location.pathname;
        const isActive = (url) => currentPath.includes(url.replace('./', ''));

        // Build Desktop Nav HTML
        const desktopNavHtml = menuItems.map(item => `
            <a href="${item.url}" class="nav-link ${isActive(item.url) ? 'active' : ''}" id="nav-${item.id || ''}">
                ${item.name}
            </a>
        `).join('');

        // Build Mobile Menu HTML
        const mobileNavHtml = menuItems.map(item => `
            <a href="${item.url}" class="mobile-link ${isActive(item.url) ? 'active' : ''}" id="mobile-nav-${item.id || ''}">
                <svg class="mobile-icon" viewBox="0 0 24 24"><path d="${item.icon}"></path></svg>
                ${item.name}
            </a>
        `).join('');

        // Special: Add Settings Button for Teacher
        let settingsBtnHtml = '';
        if (this.userType === 'teacher') {
            settingsBtnHtml = `
                <button id="header-settings-btn" class="text-gray-500 hover:text-blue-600 transition p-2" title="메뉴 관리">
                    <i class="fas fa-cog fa-lg"></i>
                </button>
            `;
        }

        const headerHtml = `
            <header>
                <div class="header-container">
                    <a href="../index.html" class="logo-text">
                        <span class="logo-we">We</span><span class="logo-story">story</span>
                    </a>

                    <nav class="desktop-nav">
                        ${desktopNavHtml}
                    </nav>

                    <div class="header-right">
                        ${settingsBtnHtml}
                        <span id="header-greeting" class="user-greeting"></span>
                        <button id="logout-btn" class="btn-logout">로그아웃</button>
                        <button id="mobile-menu-toggle" class="mobile-menu-btn">
                            <i class="fas fa-bars"></i>
                        </button>
                    </div>
                </div>

                <div id="mobile-menu">
                    ${mobileNavHtml}
                </div>
            </header>
        `;

        document.body.insertAdjacentHTML('afterbegin', headerHtml);

        // Attach Event Listeners
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
        
        const mobileBtn = document.getElementById('mobile-menu-toggle');
        const mobileMenu = document.getElementById('mobile-menu');
        
        if (mobileBtn && mobileMenu) {
            mobileBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                mobileMenu.classList.toggle('open');
            });
            document.addEventListener('click', (e) => {
                if (mobileMenu.classList.contains('open') && 
                    !mobileMenu.contains(e.target) && 
                    !mobileBtn.contains(e.target)) {
                    mobileMenu.classList.remove('open');
                }
            });
        }
    }

    updateUserInfo(user) {
        const greetingEl = document.getElementById('header-greeting');
        if (greetingEl) {
            const name = user.displayName || (this.userType === 'teacher' ? '선생님' : '학생');
            greetingEl.textContent = `${name} ${this.userType === 'teacher' ? '선생님' : '학생'}`;
        }
    }

    logout() {
        window.auth.signOut().then(() => {
            window.location.href = '../index.html';
        });
    }
}

// Instantiate globally
window.AuthManager = new AuthManager();