import React from 'react';
import { useAuth } from '../../contexts/AuthContext';

const Footer: React.FC = () => {
    const { interfaceConfig } = useAuth();

    const showPolicy = (type: string) => {
        // TODO: Implement Policy Modal logic
        alert(`${type} - Not implemented yet`);
    };

    return (
        <footer className="bg-white border-t border-stone-200 py-4 mt-auto">
            <div className="container mx-auto text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                    <button onClick={() => showPolicy('terms')} className="text-stone-400 hover:text-stone-600 text-xs font-medium transition">이용 약관</button>
                    <span className="text-stone-300 text-xs">|</span>
                    <button onClick={() => showPolicy('privacy')} className="text-stone-400 hover:text-stone-600 text-xs font-medium transition">개인정보 처리 방침</button>
                </div>
                <p className="text-stone-400 text-xs font-bold font-mono">
                    {interfaceConfig?.footerText || 'Copyright © 용신중학교 역사교사 방재석. All rights reserved.'}
                </p>
            </div>
        </footer>
    );
};

export default Footer;
