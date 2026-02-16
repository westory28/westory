import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          react_app: path.resolve(__dirname, 'index_react.html'),
          // Student Pages
          student_dashboard: path.resolve(__dirname, 'student/dashboard.html'),
          student_calendar: path.resolve(__dirname, 'student/calendar.html'),
          student_history: path.resolve(__dirname, 'student/history.html'),
          student_mark_exam: path.resolve(__dirname, 'student/mark-exam.html'),
          student_mypage: path.resolve(__dirname, 'student/mypage.html'),
          student_quiz_runner: path.resolve(__dirname, 'student/quiz-runner.html'),
          student_quiz: path.resolve(__dirname, 'student/quiz.html'),
          student_score: path.resolve(__dirname, 'student/score.html'),
          student_lesson_note: path.resolve(__dirname, 'student/lesson/note.html'),
          // Teacher Pages
          teacher_dashboard: path.resolve(__dirname, 'teacher/dashboard.html'),
          teacher_manage_exam: path.resolve(__dirname, 'teacher/manage_exam.html'),
          teacher_manage_lesson: path.resolve(__dirname, 'teacher/manage_lesson.html'),
          teacher_manage_quiz: path.resolve(__dirname, 'teacher/manage_quiz.html'),
          teacher_manage_schedule: path.resolve(__dirname, 'teacher/manage_schedule.html'),
          teacher_settings: path.resolve(__dirname, 'teacher/settings.html'),
          teacher_settings_interface: path.resolve(__dirname, 'teacher/settings_interface.html'),
          teacher_settings_privacy: path.resolve(__dirname, 'teacher/settings_privacy.html'),
          teacher_settings_school: path.resolve(__dirname, 'teacher/settings_school.html'),
          teacher_student_list: path.resolve(__dirname, 'teacher/student-list.html'),
        },
      },
    }
  };
});
