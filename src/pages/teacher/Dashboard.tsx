import React from 'react';
import { useAuth } from '../../contexts/AuthContext';

const TeacherDashboard: React.FC = () => {
    const { userData } = useAuth();

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-gray-800">
                선생님 대시보드
            </h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">총 학생 수</p>
                            <h3 className="text-2xl font-bold text-gray-800">- 명</h3>
                        </div>
                        <div className="p-3 bg-blue-100 rounded-lg text-blue-600">
                            <i className="fas fa-users"></i>
                        </div>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">오늘의 제출</p>
                            <h3 className="text-2xl font-bold text-gray-800">- 건</h3>
                        </div>
                        <div className="p-3 bg-green-100 rounded-lg text-green-600">
                            <i className="fas fa-check-circle"></i>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TeacherDashboard;
