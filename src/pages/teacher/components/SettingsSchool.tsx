import React, { useEffect, useState } from 'react';
import { db } from '../../../lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAppToast } from '../../../components/common/AppToastProvider';
import { InlineLoading } from '../../../components/common/LoadingState';

interface GradeItem {
    value: string;
    label: string;
}

interface ClassItem {
    value: string;
    label: string;
}

const SettingsSchool: React.FC = () => {
    const { showToast } = useAppToast();
    const [schoolLevel, setSchoolLevel] = useState('middle');
    const [grades, setGrades] = useState<GradeItem[]>([]);
    const [classes, setClasses] = useState<ClassItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            const docRef = doc(db, 'site_settings', 'school_config');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                setSchoolLevel(data.schoolLevel || 'middle');
                setGrades(data.grades || defaultGrades());
                setClasses(data.classes || defaultClasses());
            } else {
                setSchoolLevel('middle');
                setGrades(defaultGrades());
                setClasses(defaultClasses());
            }
        } catch (error) {
            console.error("Failed to load school config:", error);
            setSchoolLevel('middle');
            setGrades(defaultGrades());
            setClasses(defaultClasses());
        } finally {
            setLoading(false);
        }
    };

    const defaultGrades = () => [
        { value: '1', label: '1학년' },
        { value: '2', label: '2학년' },
        { value: '3', label: '3학년' }
    ];

    const defaultClasses = () => {
        const arr = [];
        for (let i = 1; i <= 15; i++) {
            arr.push({ value: String(i), label: `${i}반` });
        }
        return arr;
    };

    const handleAddGrade = () => {
        const nextVal = String(grades.length + 1);
        setGrades([...grades, { value: nextVal, label: `${nextVal}학년` }]);
    };

    const handleRemoveGrade = (index: number) => {
        if (grades.length <= 1) {
            showToast({
                tone: 'warning',
                title: '최소 1개의 학년이 필요합니다.',
            });
            return;
        }
        if (window.confirm(`'${grades[index].label}'을(를) 삭제하시겠습니까?`)) {
            const newGrades = [...grades];
            newGrades.splice(index, 1);
            setGrades(newGrades);
        }
    };

    const handleGradeLabelChange = (index: number, newLabel: string) => {
        const newGrades = [...grades];
        newGrades[index].label = newLabel;
        setGrades(newGrades);
    };

    const handleAddClass = () => {
        const nextVal = String(classes.length + 1);
        setClasses([...classes, { value: nextVal, label: `${nextVal}반` }]);
    };

    const handleRemoveClass = (index: number) => {
        if (classes.length <= 1) {
            showToast({
                tone: 'warning',
                title: '최소 1개의 학급이 필요합니다.',
            });
            return;
        }
        if (window.confirm(`'${classes[index].label}'을(를) 삭제하시겠습니까?`)) {
            const newClasses = [...classes];
            newClasses.splice(index, 1);
            setClasses(newClasses);
        }
    };

    const handleClassLabelChange = (index: number, newLabel: string) => {
        const newClasses = [...classes];
        newClasses[index].label = newLabel;
        setClasses(newClasses);
    };

    const handleSave = async () => {
        try {
            const docRef = doc(db, 'site_settings', 'school_config');
            await setDoc(docRef, {
                schoolLevel,
                grades,
                classes,
                updatedAt: serverTimestamp()
            });
            showToast({
                tone: 'success',
                title: '학교급·학년·학급 설정이 저장되었습니다.',
            });
        } catch (error: any) {
            console.error("Failed to save school config:", error);
            showToast({
                tone: 'error',
                title: '학교급 설정 저장에 실패했습니다.',
                message: error.message,
            });
        }
    };

    if (loading) return <InlineLoading message="학교 설정을 불러오는 중입니다." showWarning />;

    return (
        <div className="max-w-3xl space-y-8">
            {/* Section 1: School Level */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 lg:p-8 shadow-sm">
                <div className="border-b border-gray-100 pb-4 mb-6">
                    <h3 className="text-lg font-bold text-gray-900">
                        <i className="fas fa-school text-blue-500 mr-2"></i>학교급 설정
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">운영 중인 학교급을 선택합니다.</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div
                        onClick={() => setSchoolLevel('middle')}
                        className={`cursor-pointer border-2 rounded-xl p-5 transition-all flex items-center gap-3 hover:border-blue-300 ${schoolLevel === 'middle' ? 'border-blue-600 bg-blue-50' : 'border-gray-200'}`}
                    >
                        <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-lg">🏫</div>
                        <div>
                            <p className="font-bold text-gray-800">중학교</p>
                            <p className="text-xs text-gray-500">Middle School</p>
                        </div>
                    </div>
                    <div
                        onClick={() => setSchoolLevel('high')}
                        className={`cursor-pointer border-2 rounded-xl p-5 transition-all flex items-center gap-3 hover:border-blue-300 ${schoolLevel === 'high' ? 'border-blue-600 bg-blue-50' : 'border-gray-200'}`}
                    >
                        <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-lg">🎓</div>
                        <div>
                            <p className="font-bold text-gray-800">고등학교</p>
                            <p className="text-xs text-gray-500">High School</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Section 2: Grades */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 lg:p-8 shadow-sm">
                <div className="border-b border-gray-100 pb-4 mb-6 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900">
                            <i className="fas fa-layer-group text-green-500 mr-2"></i>학년 관리
                        </h3>
                        <p className="text-sm text-gray-500 mt-1">학년 목록과 표시 명칭을 관리합니다.</p>
                    </div>
                    <button
                        onClick={handleAddGrade}
                        className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg shadow transition transform active:scale-95 text-sm flex items-center gap-1"
                    >
                        <i className="fas fa-plus"></i> 학년 추가
                    </button>
                </div>
                <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-700 border border-blue-100 mb-4">
                    <i className="fas fa-info-circle mr-1"></i> '표시 명칭'을 수정하면 학생 가입 화면과 명단에서 해당 명칭으로 표시됩니다.
                </div>
                <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr>
                                <th className="bg-gray-50 p-3 text-sm font-bold text-gray-500 text-left border-b-2 border-gray-200 w-16 text-center">#</th>
                                <th className="bg-gray-50 p-3 text-sm font-bold text-gray-500 text-left border-b-2 border-gray-200 w-24">값</th>
                                <th className="bg-gray-50 p-3 text-sm font-bold text-gray-500 text-left border-b-2 border-gray-200">표시 명칭</th>
                                <th className="bg-gray-50 p-3 text-sm font-bold text-gray-500 text-center border-b-2 border-gray-200 w-16">삭제</th>
                            </tr>
                        </thead>
                        <tbody>
                            {grades.map((g, i) => (
                                <tr key={i} className="border-b border-gray-100">
                                    <td className="p-2 text-center text-sm font-bold text-gray-400">{i + 1}</td>
                                    <td className="p-2"><input type="text" value={g.value} readOnly className="w-full border border-gray-200 rounded p-2 text-center font-mono bg-gray-50 text-gray-500" /></td>
                                    <td className="p-2">
                                        <input
                                            type="text"
                                            value={g.label}
                                            onChange={(e) => handleGradeLabelChange(i, e.target.value)}
                                            placeholder="표시 명칭"
                                            className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none transition"
                                        />
                                    </td>
                                    <td className="p-2 text-center">
                                        <button
                                            onClick={() => handleRemoveGrade(i)}
                                            className="text-red-400 hover:text-red-600 transition p-1"
                                            title="삭제"
                                        >
                                            <i className="fas fa-trash-alt"></i>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Section 3: Classes */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 lg:p-8 shadow-sm">
                <div className="border-b border-gray-100 pb-4 mb-6 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900">
                            <i className="fas fa-users text-orange-500 mr-2"></i>학급(반) 관리
                        </h3>
                        <p className="text-sm text-gray-500 mt-1">학급 목록과 표시 명칭을 관리합니다.</p>
                    </div>
                    <button
                        onClick={handleAddClass}
                        className="bg-orange-600 hover:bg-orange-700 text-white font-bold py-2 px-4 rounded-lg shadow transition transform active:scale-95 text-sm flex items-center gap-1"
                    >
                        <i className="fas fa-plus"></i> 학급 추가
                    </button>
                </div>
                <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-700 border border-blue-100 mb-4">
                    <i className="fas fa-info-circle mr-1"></i> '표시 명칭'을 수정하면 학생 가입 화면과 명단에서 해당 명칭으로 표시됩니다.
                </div>
                <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr>
                                <th className="bg-gray-50 p-3 text-sm font-bold text-gray-500 text-left border-b-2 border-gray-200 w-16 text-center">#</th>
                                <th className="bg-gray-50 p-3 text-sm font-bold text-gray-500 text-left border-b-2 border-gray-200 w-24">값</th>
                                <th className="bg-gray-50 p-3 text-sm font-bold text-gray-500 text-left border-b-2 border-gray-200">표시 명칭</th>
                                <th className="bg-gray-50 p-3 text-sm font-bold text-gray-500 text-center border-b-2 border-gray-200 w-16">삭제</th>
                            </tr>
                        </thead>
                        <tbody>
                            {classes.map((c, i) => (
                                <tr key={i} className="border-b border-gray-100">
                                    <td className="p-2 text-center text-sm font-bold text-gray-400">{i + 1}</td>
                                    <td className="p-2"><input type="text" value={c.value} readOnly className="w-full border border-gray-200 rounded p-2 text-center font-mono bg-gray-50 text-gray-500" /></td>
                                    <td className="p-2">
                                        <input
                                            type="text"
                                            value={c.label}
                                            onChange={(e) => handleClassLabelChange(i, e.target.value)}
                                            placeholder="표시 명칭"
                                            className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none transition"
                                        />
                                    </td>
                                    <td className="p-2 text-center">
                                        <button
                                            onClick={() => handleRemoveClass(i)}
                                            className="text-red-400 hover:text-red-600 transition p-1"
                                            title="삭제"
                                        >
                                            <i className="fas fa-trash-alt"></i>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="text-right pb-8">
                <button
                    onClick={handleSave}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-10 rounded-xl shadow-lg transition transform active:scale-95 text-base"
                >
                    <i className="fas fa-save mr-2"></i>전체 저장
                </button>
            </div>
        </div>
    );
};

export default SettingsSchool;
