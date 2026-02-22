import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';

type PolicyType = 'terms' | 'privacy';

const POLICY_TITLE: Record<PolicyType, string> = {
    terms: '이용 약관',
    privacy: '개인정보 처리 방침',
};

const FALLBACK_FOOTER_TEXT = 'Copyright © Westory. All rights reserved.';

const Footer: React.FC = () => {
    const { currentUser, interfaceConfig } = useAuth();
    const [openPolicy, setOpenPolicy] = useState<PolicyType | null>(null);
    const [loading, setLoading] = useState(false);
    const [policyHtml, setPolicyHtml] = useState('');
    const [resolvedFooterText, setResolvedFooterText] = useState('');

    useEffect(() => {
        let active = true;

        const loadFooterText = async () => {
            try {
                const snap = await getDoc(doc(db, 'site_settings', 'interface_config'));
                const remoteText = snap.exists()
                    ? String((snap.data() as { footerText?: string }).footerText || '').trim()
                    : '';
                if (active) {
                    setResolvedFooterText(remoteText);
                }
            } catch (error) {
                console.error('Footer interface config load error:', error);
            }
        };

        if (currentUser) {
            void loadFooterText();
        } else {
            setResolvedFooterText('');
        }

        return () => {
            active = false;
        };
    }, [currentUser]);

    const footerText = resolvedFooterText || String(interfaceConfig?.footerText || '').trim() || FALLBACK_FOOTER_TEXT;

    const openPolicyModal = async (type: PolicyType) => {
        setOpenPolicy(type);
        setLoading(true);
        setPolicyHtml('');

        try {
            const snap = await getDoc(doc(db, 'site_settings', type));
            if (snap.exists() && snap.data().text) {
                setPolicyHtml(snap.data().text);
            } else {
                setPolicyHtml('<p class="text-center text-gray-400 py-8">등록된 내용이 없습니다.</p>');
            }
        } catch (error) {
            console.error('Footer policy load error:', error);
            setPolicyHtml('<p class="text-center text-red-400 py-8">내용을 불러오지 못했습니다.</p>');
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <footer className="bg-white border-t border-stone-200 py-4 mt-auto">
                <div className="container mx-auto text-center">
                    <div className="flex items-center justify-center gap-2 mb-2">
                        <button onClick={() => openPolicyModal('terms')} className="text-stone-400 hover:text-stone-600 text-xs font-medium transition">
                            이용 약관
                        </button>
                        <span className="text-stone-300 text-xs">|</span>
                        <button onClick={() => openPolicyModal('privacy')} className="text-stone-400 hover:text-stone-600 text-xs font-medium transition">
                            개인정보 처리 방침
                        </button>
                    </div>
                    <p className="text-stone-400 text-xs font-bold">
                        {footerText}
                    </p>
                </div>
            </footer>

            {openPolicy && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm" onClick={() => setOpenPolicy(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-5 border-b border-gray-100">
                            <h2 className="text-lg font-bold text-gray-900">{POLICY_TITLE[openPolicy]}</h2>
                            <button onClick={() => setOpenPolicy(null)} className="text-gray-400 hover:text-gray-700 text-xl transition">
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto flex-1 text-sm text-gray-700 leading-relaxed">
                            {loading ? (
                                <p className="text-center text-gray-400 py-8">
                                    <i className="fas fa-spinner fa-spin mr-2"></i>불러오는 중...
                                </p>
                            ) : (
                                <div dangerouslySetInnerHTML={{ __html: policyHtml }} />
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default Footer;
