import React, { useEffect, useState } from 'react';
import { db } from '../../../lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp, collection, getDocs, orderBy, query, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';

interface ConsentItem {
    id: string;
    title: string;
    text: string;
    required: boolean;
    order: number;
}

const SettingsPrivacy: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'terms' | 'privacy' | 'consent'>('terms');
    const [termsText, setTermsText] = useState('');
    const [privacyText, setPrivacyText] = useState('');
    const [consentItems, setConsentItems] = useState<ConsentItem[]>([]);
    const [expandedConsentId, setExpandedConsentId] = useState<string | null>(null);

    useEffect(() => {
        loadTerms();
        loadPrivacy();
        loadConsentItems();
    }, []);

    // --- Terms ---
    const loadTerms = async () => {
        try {
            const docRef = doc(db, 'site_settings', 'terms');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists() && docSnap.data().text) {
                setTermsText(docSnap.data().text);
            } else {
                setTermsText(defaultTerms);
            }
        } catch (error) {
            console.error("Failed to load terms:", error);
        }
    };

    const saveTerms = async () => {
        try {
            await setDoc(doc(db, 'site_settings', 'terms'), {
                text: termsText,
                updatedAt: serverTimestamp()
            });
            alert("이용 약관이 저장되었습니다.");
        } catch (error: any) {
            alert("저장 실패: " + error.message);
        }
    };

    const defaultTerms = `<p class="ql-align-center"><strong style="font-size: large;">[이용 약관]</strong></p>
<p><br></p>
<p><strong>제1조 (목적)</strong></p>
<p>본 약관은 Westory 서비스의 이용 조건 및 절차에 관한 사항을 규정합니다.</p>
// ... (Simplified for default)`;

    // --- Privacy ---
    const loadPrivacy = async () => {
        try {
            const docRef = doc(db, 'site_settings', 'privacy');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists() && docSnap.data().text) {
                setPrivacyText(docSnap.data().text);
            } else {
                setPrivacyText(defaultPrivacy);
            }
        } catch (error) {
            console.error("Failed to load privacy:", error);
        }
    };

    const savePrivacy = async () => {
        try {
            await setDoc(doc(db, 'site_settings', 'privacy'), {
                text: privacyText,
                updatedAt: serverTimestamp()
            });
            alert("개인정보 처리 방침이 저장되었습니다.");
        } catch (error: any) {
            alert("저장 실패: " + error.message);
        }
    };

    const defaultPrivacy = `<p class="ql-align-center"><strong style="font-size: large;">[개인정보 처리 방침]</strong></p>
<p><br></p>
<p><strong>1. 수집 및 이용 목적</strong></p>
// ... (Simplified for default)`;

    // --- Consent ---
    const loadConsentItems = async () => {
        try {
            const q = query(collection(db, 'site_settings', 'consent', 'items'), orderBy('order', 'asc'));
            const querySnapshot = await getDocs(q);
            const items: ConsentItem[] = [];
            querySnapshot.forEach((doc) => {
                items.push({ id: doc.id, ...doc.data() } as ConsentItem);
            });
            setConsentItems(items);
        } catch (error) {
            console.error("Failed to load consent items:", error);
        }
    };

    const addConsentItem = async () => {
        try {
            const newOrder = consentItems.length + 1;
            const newItem = {
                title: '새 동의 항목',
                text: '',
                required: true,
                order: newOrder,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };
            const docRef = await addDoc(collection(db, 'site_settings', 'consent', 'items'), newItem);
            // Ensure parent exists
            await setDoc(doc(db, 'site_settings', 'consent'), { updatedAt: serverTimestamp() }, { merge: true });

            setConsentItems([...consentItems, { id: docRef.id, ...newItem } as any]);
            setExpandedConsentId(docRef.id);
        } catch (error: any) {
            alert("항목 추가 실패: " + error.message);
        }
    };

    const updateConsentItem = async (id: string, field: string, value: any) => {
        const updatedItems = consentItems.map(item => {
            if (item.id === id) {
                return { ...item, [field]: value };
            }
            return item;
        });
        setConsentItems(updatedItems);
    };

    const saveConsentItem = async (id: string) => {
        const item = consentItems.find(i => i.id === id);
        if (!item) return;
        if (!item.title.trim()) { alert("항목 제목을 입력해주세요."); return; }
        if (!item.text.trim()) { alert("내용을 입력해주세요."); return; }

        try {
            const itemRef = doc(db, 'site_settings', 'consent', 'items', id);
            await updateDoc(itemRef, {
                title: item.title,
                text: item.text,
                required: item.required,
                updatedAt: serverTimestamp()
            });
            alert(`'${item.title}' 항목이 저장되었습니다.`);
        } catch (error: any) {
            alert("저장 실패: " + error.message);
        }
    };

    const deleteConsentItem = async (id: string) => {
        const item = consentItems.find(i => i.id === id);
        if (!item) return;
        if (!window.confirm(`'${item.title}'을(를) 삭제하시겠습니까?`)) return;

        try {
            await deleteDoc(doc(db, 'site_settings', 'consent', 'items', id));
            setConsentItems(consentItems.filter(i => i.id !== id));
            alert("삭제되었습니다.");
        } catch (error: any) {
            alert("삭제 실패: " + error.message);
        }
    };

    return (
        <div className="flex flex-col lg:flex-row gap-6">
            {/* Sidebar for Sub-tabs */}
            <div className="w-full lg:w-64 shrink-0">
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                    <nav className="flex flex-col">
                        <button
                            onClick={() => setActiveTab('terms')}
                            className={`p-4 text-left font-semibold text-sm transition-colors flex items-center justify-between ${activeTab === 'terms' ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600' : 'text-gray-600 hover:bg-gray-50 border-l-4 border-transparent'}`}
                        >
                            <span>이용 약관</span>
                            <i className="fas fa-angle-right text-xs opacity-50"></i>
                        </button>
                        <button
                            onClick={() => setActiveTab('privacy')}
                            className={`p-4 text-left font-semibold text-sm transition-colors flex items-center justify-between ${activeTab === 'privacy' ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600' : 'text-gray-600 hover:bg-gray-50 border-l-4 border-transparent'}`}
                        >
                            <span>개인정보 처리 방침</span>
                            <i className="fas fa-angle-right text-xs opacity-50"></i>
                        </button>
                        <button
                            onClick={() => setActiveTab('consent')}
                            className={`p-4 text-left font-semibold text-sm transition-colors flex items-center justify-between ${activeTab === 'consent' ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600' : 'text-gray-600 hover:bg-gray-50 border-l-4 border-transparent'}`}
                        >
                            <span>개인정보 활용 동의서</span>
                            <i className="fas fa-angle-right text-xs opacity-50"></i>
                        </button>
                    </nav>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1">
                {activeTab === 'terms' && (
                    <div className="bg-white rounded-xl border border-gray-200 p-6 lg:p-8 shadow-sm">
                        <div className="border-b border-gray-100 pb-4 mb-6">
                            <h3 className="text-lg font-bold text-gray-900"><i className="fas fa-file-contract text-blue-500 mr-2"></i>이용 약관 관리</h3>
                            <p className="text-sm text-gray-500 mt-1">로그인 화면 하단 '이용 약관' 클릭 시 표시되는 내용을 편집합니다.</p>
                        </div>
                        <div className="space-y-4">
                            <textarea
                                value={termsText}
                                onChange={(e) => setTermsText(e.target.value)}
                                className="w-full h-96 p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm leading-relaxed"
                                placeholder="HTML 형식을 지원합니다."
                            />
                            <div className="flex justify-end pt-4">
                                <button
                                    onClick={saveTerms}
                                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl shadow-lg transition transform active:scale-95"
                                >
                                    이용 약관 저장
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'privacy' && (
                    <div className="bg-white rounded-xl border border-gray-200 p-6 lg:p-8 shadow-sm">
                        <div className="border-b border-gray-100 pb-4 mb-6">
                            <h3 className="text-lg font-bold text-gray-900"><i className="fas fa-user-shield text-green-500 mr-2"></i>개인정보 처리 방침 관리</h3>
                            <p className="text-sm text-gray-500 mt-1">로그인 화면 하단 '개인정보 처리 방침' 클릭 시 표시되는 내용을 편집합니다.</p>
                        </div>
                        <div className="space-y-4">
                            <textarea
                                value={privacyText}
                                onChange={(e) => setPrivacyText(e.target.value)}
                                className="w-full h-96 p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm leading-relaxed"
                                placeholder="HTML 형식을 지원합니다."
                            />
                            <div className="flex justify-end pt-4">
                                <button
                                    onClick={savePrivacy}
                                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl shadow-lg transition transform active:scale-95"
                                >
                                    개인정보 처리 방침 저장
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'consent' && (
                    <div className="max-w-4xl space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900"><i className="fas fa-handshake text-purple-500 mr-2"></i>개인정보 활용 동의서 관리</h3>
                                <p className="text-sm text-gray-500 mt-1">학생이 최초 로그인 시 동의해야 하는 항목들을 관리합니다.</p>
                            </div>
                            <button
                                onClick={addConsentItem}
                                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 px-5 rounded-xl shadow-lg transition transform active:scale-95 flex items-center gap-2 text-sm"
                            >
                                <i className="fas fa-plus"></i> 항목 추가
                            </button>
                        </div>

                        <div className="bg-purple-50 p-3 rounded-lg text-sm text-purple-700 border border-purple-100 mb-6">
                            <i className="fas fa-info-circle mr-1"></i> 여기에 등록된 모든 동의 항목은 학생의 최초 로그인 시 팝업으로 표시됩니다. 학생은 모든 필수 항목에 동의해야 서비스를 이용할 수 있습니다.
                        </div>

                        <div className="space-y-4">
                            {consentItems.length === 0 && (
                                <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
                                    <i className="fas fa-clipboard-list text-4xl text-gray-300 mb-3"></i>
                                    <p className="text-gray-400 font-semibold">등록된 동의 항목이 없습니다.</p>
                                    <p className="text-gray-400 text-sm mt-1">'항목 추가' 버튼을 클릭하여 동의서를 추가하세요.</p>
                                </div>
                            )}

                            {consentItems.map((item, idx) => (
                                <div key={item.id} className="bg-white border border-gray-200 rounded-xl hover:border-purple-200 hover:shadow-sm transition">
                                    <div
                                        className="flex items-center justify-between p-4 cursor-pointer"
                                        onClick={() => setExpandedConsentId(expandedConsentId === item.id ? null : item.id)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className="bg-purple-100 text-purple-600 font-bold text-xs px-2.5 py-1 rounded-full">{idx + 1}</span>
                                            <span className="font-bold text-gray-800">{item.title || '제목 없음'}</span>
                                            {item.required ? (
                                                <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-semibold">필수</span>
                                            ) : (
                                                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-semibold">선택</span>
                                            )}
                                        </div>
                                        <div>
                                            <i className={`fas fa-chevron-down text-gray-400 text-xs transition-transform ${expandedConsentId === item.id ? 'transform rotate-180' : ''}`}></i>
                                        </div>
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
                                                <label className="block text-xs font-bold text-gray-500 mb-1">동의 내용 (HTML)</label>
                                                <textarea
                                                    value={item.text}
                                                    onChange={(e) => updateConsentItem(item.id, 'text', e.target.value)}
                                                    className="w-full h-40 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none font-mono text-sm"
                                                    placeholder="동의 내용을 HTML 형식으로 입력하세요."
                                                />
                                            </div>
                                            <div className="flex justify-between items-center pt-2">
                                                <button
                                                    onClick={() => deleteConsentItem(item.id)}
                                                    className="text-red-400 text-sm hover:text-red-600 flex items-center gap-1 transition"
                                                >
                                                    <i className="fas fa-trash-alt"></i> 삭제
                                                </button>
                                                <button
                                                    onClick={() => saveConsentItem(item.id)}
                                                    className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 px-6 rounded-xl shadow-lg transition transform active:scale-95 text-sm"
                                                >
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
