import React, { useEffect, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import QuillEditor from '../../../components/common/QuillEditor';

interface ConsentItem {
    id: string;
    title: string;
    text: string;
    required: boolean;
    order: number;
}

const defaultTerms = `<p><strong>[이용 약관]</strong></p><p><br></p><p>제1조(목적)</p><p>본 약관은 Westory 서비스의 이용 조건과 운영 원칙을 규정합니다.</p>`;
const defaultPrivacy = `<p><strong>[개인정보 처리 방침]</strong></p><p><br></p><p>1. 수집 및 이용 목적</p><p>서비스 제공과 학습 기록 관리에 필요한 최소한의 정보를 수집합니다.</p>`;

const SettingsPrivacy: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'terms' | 'privacy' | 'consent'>('terms');
    const [termsText, setTermsText] = useState('');
    const [privacyText, setPrivacyText] = useState('');
    const [consentItems, setConsentItems] = useState<ConsentItem[]>([]);
    const [expandedConsentId, setExpandedConsentId] = useState<string | null>(null);

    useEffect(() => {
        void loadTerms();
        void loadPrivacy();
        void loadConsentItems();
    }, []);

    const loadTerms = async () => {
        try {
            const snap = await getDoc(doc(db, 'site_settings', 'terms'));
            if (snap.exists() && snap.data().text) {
                setTermsText(snap.data().text);
            } else {
                setTermsText(defaultTerms);
            }
        } catch (error) {
            console.error('Failed to load terms:', error);
        }
    };

    const saveTerms = async () => {
        try {
            await setDoc(doc(db, 'site_settings', 'terms'), {
                text: termsText,
                updatedAt: serverTimestamp(),
            });
            alert('이용 약관을 저장했습니다.');
        } catch (error: any) {
            alert(`저장 실패: ${error.message}`);
        }
    };

    const loadPrivacy = async () => {
        try {
            const snap = await getDoc(doc(db, 'site_settings', 'privacy'));
            if (snap.exists() && snap.data().text) {
                setPrivacyText(snap.data().text);
            } else {
                setPrivacyText(defaultPrivacy);
            }
        } catch (error) {
            console.error('Failed to load privacy:', error);
        }
    };

    const savePrivacy = async () => {
        try {
            await setDoc(doc(db, 'site_settings', 'privacy'), {
                text: privacyText,
                updatedAt: serverTimestamp(),
            });
            alert('개인정보 처리 방침을 저장했습니다.');
        } catch (error: any) {
            alert(`저장 실패: ${error.message}`);
        }
    };

    const loadConsentItems = async () => {
        try {
            const q = query(collection(db, 'site_settings', 'consent', 'items'), orderBy('order', 'asc'));
            const snap = await getDocs(q);
            const items: ConsentItem[] = [];
            snap.forEach((d) => items.push({ id: d.id, ...(d.data() as Omit<ConsentItem, 'id'>) }));
            setConsentItems(items);
        } catch (error) {
            console.error('Failed to load consent items:', error);
        }
    };

    const addConsentItem = async () => {
        try {
            const newOrder = consentItems.length + 1;
            const payload = {
                title: '새 동의 항목',
                text: '<p>동의 내용을 입력하세요.</p>',
                required: true,
                order: newOrder,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            };
            const docRef = await addDoc(collection(db, 'site_settings', 'consent', 'items'), payload);
            await setDoc(doc(db, 'site_settings', 'consent'), { updatedAt: serverTimestamp() }, { merge: true });
            setConsentItems((prev) => [...prev, { id: docRef.id, ...payload } as ConsentItem]);
            setExpandedConsentId(docRef.id);
        } catch (error: any) {
            alert(`항목 추가 실패: ${error.message}`);
        }
    };

    const updateConsentItem = (id: string, field: keyof ConsentItem, value: any) => {
        setConsentItems((prev) =>
            prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
        );
    };

    const saveConsentItem = async (id: string) => {
        const item = consentItems.find((x) => x.id === id);
        if (!item) return;
        if (!item.title.trim()) {
            alert('항목 제목을 입력해 주세요.');
            return;
        }
        if (!item.text.trim()) {
            alert('동의 내용을 입력해 주세요.');
            return;
        }

        try {
            await updateDoc(doc(db, 'site_settings', 'consent', 'items', id), {
                title: item.title,
                text: item.text,
                required: item.required,
                updatedAt: serverTimestamp(),
            });
            alert(`'${item.title}' 항목을 저장했습니다.`);
        } catch (error: any) {
            alert(`저장 실패: ${error.message}`);
        }
    };

    const deleteConsentItem = async (id: string) => {
        const item = consentItems.find((x) => x.id === id);
        if (!item) return;
        if (!window.confirm(`'${item.title}' 항목을 삭제하시겠습니까?`)) return;

        try {
            await deleteDoc(doc(db, 'site_settings', 'consent', 'items', id));
            setConsentItems((prev) => prev.filter((x) => x.id !== id));
            if (expandedConsentId === id) setExpandedConsentId(null);
            alert('항목을 삭제했습니다.');
        } catch (error: any) {
            alert(`삭제 실패: ${error.message}`);
        }
    };

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="border-b border-gray-100 p-3">
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => setActiveTab('terms')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition ${activeTab === 'terms' ? 'bg-blue-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                        이용 약관
                    </button>
                    <button
                        onClick={() => setActiveTab('privacy')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition ${activeTab === 'privacy' ? 'bg-blue-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                        개인정보 처리 방침
                    </button>
                    <button
                        onClick={() => setActiveTab('consent')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition ${activeTab === 'consent' ? 'bg-blue-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                        개인정보 동의 관리
                    </button>
                </div>
            </div>

            <div className="p-6 lg:p-8">
                {activeTab === 'terms' && (
                    <div className="space-y-4">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900"><i className="fas fa-file-contract text-blue-500 mr-2"></i>이용 약관 관리</h3>
                            <p className="text-sm text-gray-500 mt-1">로그인 화면 하단의 이용 약관에 표시됩니다.</p>
                        </div>
                        <QuillEditor
                            value={termsText}
                            onChange={setTermsText}
                            minHeight={360}
                            placeholder="이용 약관 내용을 작성하세요."
                            toolbar={[
                                [{ header: [1, 2, 3, false] }],
                                ['bold', 'italic', 'underline', 'strike'],
                                [{ color: [] }, { background: [] }],
                                [{ list: 'ordered' }, { list: 'bullet' }],
                                ['link'],
                                ['clean'],
                            ]}
                        />
                        <div className="text-right">
                            <button onClick={() => void saveTerms()} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl shadow-lg transition">
                                이용 약관 저장
                            </button>
                        </div>
                    </div>
                )}

                {activeTab === 'privacy' && (
                    <div className="space-y-4">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900"><i className="fas fa-user-shield text-green-500 mr-2"></i>개인정보 처리 방침 관리</h3>
                            <p className="text-sm text-gray-500 mt-1">로그인 화면 하단의 개인정보 처리 방침에 표시됩니다.</p>
                        </div>
                        <QuillEditor
                            value={privacyText}
                            onChange={setPrivacyText}
                            minHeight={360}
                            placeholder="개인정보 처리 방침 내용을 작성하세요."
                            toolbar={[
                                [{ header: [1, 2, 3, false] }],
                                ['bold', 'italic', 'underline', 'strike'],
                                [{ color: [] }, { background: [] }],
                                [{ list: 'ordered' }, { list: 'bullet' }],
                                ['link'],
                                ['clean'],
                            ]}
                        />
                        <div className="text-right">
                            <button onClick={() => void savePrivacy()} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl shadow-lg transition">
                                개인정보 처리 방침 저장
                            </button>
                        </div>
                    </div>
                )}

                {activeTab === 'consent' && (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900"><i className="fas fa-handshake text-purple-500 mr-2"></i>개인정보 동의 항목 관리</h3>
                                <p className="text-sm text-gray-500 mt-1">학생 최초 로그인 시 노출되는 동의 항목입니다.</p>
                            </div>
                            <button
                                onClick={() => void addConsentItem()}
                                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 px-5 rounded-xl shadow-lg transition text-sm"
                            >
                                <i className="fas fa-plus mr-1"></i>항목 추가
                            </button>
                        </div>

                        <div className="bg-purple-50 p-3 rounded-lg text-sm text-purple-700 border border-purple-100">
                            <i className="fas fa-info-circle mr-1"></i>필수 항목은 학생이 동의해야 서비스를 이용할 수 있습니다.
                        </div>

                        <div className="space-y-4">
                            {consentItems.length === 0 && (
                                <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
                                    <i className="fas fa-clipboard-list text-4xl text-gray-300 mb-3"></i>
                                    <p className="text-gray-400 font-semibold">등록된 동의 항목이 없습니다.</p>
                                </div>
                            )}

                            {consentItems.map((item, idx) => (
                                <div key={item.id} className="bg-white border border-gray-200 rounded-xl hover:border-purple-200 hover:shadow-sm transition">
                                    <div className="flex items-center justify-between p-4 cursor-pointer" onClick={() => setExpandedConsentId(expandedConsentId === item.id ? null : item.id)}>
                                        <div className="flex items-center gap-3">
                                            <span className="bg-purple-100 text-purple-600 font-bold text-xs px-2.5 py-1 rounded-full">{idx + 1}</span>
                                            <span className="font-bold text-gray-800">{item.title || '제목 없음'}</span>
                                            {item.required ? (
                                                <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-semibold">필수</span>
                                            ) : (
                                                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-semibold">선택</span>
                                            )}
                                        </div>
                                        <i className={`fas fa-chevron-down text-gray-400 text-xs transition-transform ${expandedConsentId === item.id ? 'transform rotate-180' : ''}`}></i>
                                    </div>

                                    {expandedConsentId === item.id && (
                                        <div className="p-4 border-t border-gray-100 bg-gray-50 space-y-4 rounded-b-xl">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-500 mb-1">항목 제목</label>
                                                    <input
                                                        type="text"
                                                        value={item.title}
                                                        onChange={(e) => updateConsentItem(item.id, 'title', e.target.value)}
                                                        className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                                                    />
                                                </div>
                                                <div className="flex items-end gap-4">
                                                    <label className="flex items-center gap-2 cursor-pointer mb-2">
                                                        <input
                                                            type="checkbox"
                                                            checked={item.required}
                                                            onChange={(e) => updateConsentItem(item.id, 'required', e.target.checked)}
                                                            className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                                                        />
                                                        <span className="text-sm font-semibold text-gray-600">필수 동의</span>
                                                    </label>
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-xs font-bold text-gray-500 mb-1">동의 내용</label>
                                                <QuillEditor
                                                    value={item.text}
                                                    onChange={(html) => updateConsentItem(item.id, 'text', html)}
                                                    minHeight={220}
                                                    placeholder="동의 내용을 작성하세요."
                                                    toolbar={[
                                                        [{ header: [1, 2, false] }],
                                                        ['bold', 'italic', 'underline'],
                                                        [{ list: 'ordered' }, { list: 'bullet' }],
                                                        ['link'],
                                                        ['clean'],
                                                    ]}
                                                />
                                            </div>

                                            <div className="flex justify-between items-center pt-2">
                                                <button onClick={() => void deleteConsentItem(item.id)} className="text-red-400 text-sm hover:text-red-600 flex items-center gap-1 transition">
                                                    <i className="fas fa-trash-alt"></i>삭제
                                                </button>
                                                <button onClick={() => void saveConsentItem(item.id)} className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 px-6 rounded-xl shadow-lg transition text-sm">
                                                    저장
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SettingsPrivacy;
