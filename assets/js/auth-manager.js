
// Menu Configurations (Paths are relative to Project Root)
const MENUS = {
    student: [
        { id: "menu-home", name: "대시보드", url: "student/dashboard.html", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
        { id: "menu-quiz", name: "형성평가", url: "student/quiz/list.html", icon: "M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z" },
        { id: "menu-exam", name: "시험대비", url: "student/exam/mark.html", icon: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" },
        { id: "menu-lesson", name: "수업활동", url: "student/lesson/note.html", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" },
        { id: "menu-history", name: "학습기록", url: "student/history.html", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" }
    ],
    teacher: [
        { name: "대시보드", url: "teacher/dashboard.html", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
        { name: "퀴즈 관리", url: "teacher/manage_quiz.html", icon: "M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z" },
        { name: "시험/성적", url: "teacher/manage_exam.html", icon: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" },
        { name: "수업 관리", url: "teacher/manage_lesson.html", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" },
        { name: "학생 관리", url: "teacher/student-list.html", icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" }
    ]
};

const TEACHER_EMAIL = "westoria28@gmail.com";

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.userType = null;
        this.rootPrefix = this.calculateRootPrefix();
    }

    // Calculate how many levels deep we are (e.g., student/lesson/note.html -> ../../)
    calculateRootPrefix() {
        const path = window.location.pathname;
        // Count slashes to estimate depth relative to project root
        // Assuming hosted at root /. Adjust logic if hosted in a subdir.
        // Simple logic: count segments after the domain.
        // Example: /student/dashboard.html -> 2 segments -> needs ../
        // Example: /student/lesson/note.html -> 3 segments -> needs ../../
        
        // This is a heuristic. For a robust solution in a static setup without build tools,
        // we might need manual adjustment or <base> tag.
        // Here we assume standard structure:
        // Root (index.html) -> ./
        // Depth 1 (student/dashboard.html) -> ../
        // Depth 2 (student/quiz/list.html) -> ../../
        
        const segments = path.split('/').filter(p => p && !p.includes('.html') && p !== 'westory'); // Filter out empty and file ext
        // Note: Logic might need tweaking based on actual hosting environment (e.g. GitHub Pages repo name)
        
        // Let's rely on manual injection for simplicity if this gets too complex, 
        // OR simply use relative paths from the current file's perspective in the arguments?
        // Better: let's try to detect based on known folder names.
        
        if (path.includes('/student/lesson/') || path.includes('/student/quiz/') || path.includes('/student/exam/')) return '../../';
        if (path.includes('/student/') || path.includes('/teacher/') || path.includes('/assets/')) return '../';
        return './';
    }

    init(type, requireAuth = true) {
        this.userType = type;
        
        window.auth.onAuthStateChanged(async (user) => {
            if (user) {
                this.currentUser = user;
                if (type === 'teacher' && user.email !== TEACHER_EMAIL) {
                    alert("교사 전용 페이지입니다.");
                    window.location.href = this.rootPrefix + 'student/dashboard.html';
                    return;
                }
                
                await this.loadHeader();
                this.updateUserInfo(user);
                document.dispatchEvent(new CustomEvent('auth-ready', { detail: user }));
            } else {
                if (requireAuth) {
                    window.location.href = this.rootPrefix + 'index.html';
                }
            }
        });
    }

    async loadHeader() {
        const existingHeader = document.querySelector('header');
        if (existingHeader) existingHeader.remove();

        const menuItems = MENUS[this.userType] || [];
        const currentPath = window.location.pathname;

        // Helper to resolve path relative to current page
        const resolve = (url) => this.rootPrefix + url;

        // Helper to check active state
        const isActive = (url) => currentPath.includes(url.split('/').pop());

        const desktopNavHtml = menuItems.map(item => `
            <a href="${resolve(item.url)}" class="nav-link ${isActive(item.url) ? 'active' : ''}" id="nav-${item.id || ''}">
                ${item.name}
            </a>
        `).join('');

        const mobileNavHtml = menuItems.map(item => `
            <a href="${resolve(item.url)}" class="mobile-link ${isActive(item.url) ? 'active' : ''}" id="mobile-nav-${item.id || ''}">
                <svg class="mobile-icon" viewBox="0 0 24 24"><path d="${item.icon}"></path></svg>
                ${item.name}
            </a>
        `).join('');

        let settingsBtnHtml = '';
        if (this.userType === 'teacher') {
            settingsBtnHtml = `
                <button id="header-settings-btn" class="text-gray-500 hover:text-blue-600 transition p-2" title="설정">
                    <i class="fas fa-cog fa-lg"></i>
                </button>
            `;
        }

        const headerHtml = `
            <header>
                <div class="header-container">
                    <a href="${this.rootPrefix}index.html" class="logo-text">
                        <span class="logo-we">We</span><span class="logo-story">story</span>
                    </a>
                    <nav class="desktop-nav">${desktopNavHtml}</nav>
                    <div class="header-right">
                        ${settingsBtnHtml}
                        <span id="header-greeting" class="user-greeting"></span>
                        <button id="logout-btn" class="btn-logout">로그아웃</button>
                        <button id="mobile-menu-toggle" class="mobile-menu-btn"><i class="fas fa-bars"></i></button>
                    </div>
                </div>
                <div id="mobile-menu">${mobileNavHtml}</div>
            </header>
        `;

        document.body.insertAdjacentHTML('afterbegin', headerHtml);

        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
        
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

    updateUserInfo(user) {
        const greetingEl = document.getElementById('header-greeting');
        if (greetingEl) {
            const name = user.displayName || (this.userType === 'teacher' ? '선생님' : '학생');
            greetingEl.textContent = `${name} ${this.userType === 'teacher' ? '선생님' : '학생'}`;
        }
    }

    logout() {
        window.auth.signOut().then(() => {
            window.location.href = this.rootPrefix + 'index.html';
        });
    }
}

window.AuthManager = new AuthManager();
