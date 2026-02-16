import React, { useEffect, useRef, useState } from 'react';

declare global {
    interface Window {
        Quill?: any;
    }
}

interface QuillEditorProps {
    value: string;
    onChange: (html: string) => void;
    placeholder?: string;
    minHeight?: number;
    toolbar?: any[];
}

const DEFAULT_TOOLBAR = [
    [{ size: ['small', false, 'large', 'huge'] }],
    ['bold', 'italic', 'underline'],
    [{ align: [] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['clean'],
];

const normalize = (html: string) => (html || '').replace(/\s+/g, ' ').trim();

const QuillEditor: React.FC<QuillEditorProps> = ({
    value,
    onChange,
    placeholder,
    minHeight = 240,
    toolbar = DEFAULT_TOOLBAR,
}) => {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const quillRef = useRef<any>(null);
    const syncingRef = useRef(false);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (!hostRef.current) return;
        let canceled = false;

        const waitForQuill = () =>
            new Promise<void>((resolve, reject) => {
                if (window.Quill) {
                    resolve();
                    return;
                }

                const startedAt = Date.now();
                const check = () => {
                    if (window.Quill) {
                        resolve();
                        return;
                    }
                    if (Date.now() - startedAt > 6000) {
                        reject(new Error('Quill CDN load timeout'));
                        return;
                    }
                    window.setTimeout(check, 50);
                };

                check();
            });

        waitForQuill()
            .then(() => {
                if (canceled || !hostRef.current || quillRef.current) return;

                const quill = new window.Quill(hostRef.current, {
                    theme: 'snow',
                    modules: { toolbar },
                    placeholder: placeholder || '',
                });

                quillRef.current = quill;
                syncingRef.current = true;
                quill.clipboard.dangerouslyPasteHTML(value || '');
                syncingRef.current = false;

                quill.on('text-change', () => {
                    if (!quillRef.current || syncingRef.current) return;
                    onChange(quillRef.current.root.innerHTML);
                });

                setReady(true);
            })
            .catch((error) => {
                console.error('Failed to initialize Quill editor', error);
                setReady(false);
            });

        return () => {
            canceled = true;
            quillRef.current = null;
        };
    }, [onChange, placeholder, toolbar]);

    useEffect(() => {
        if (!quillRef.current) return;
        const currentHtml = quillRef.current.root.innerHTML || '';
        if (normalize(currentHtml) === normalize(value || '')) return;

        syncingRef.current = true;
        quillRef.current.clipboard.dangerouslyPasteHTML(value || '');
        syncingRef.current = false;
    }, [value]);

    if (!ready && !window.Quill) {
        return (
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                style={{ minHeight }}
                placeholder={placeholder}
            />
        );
    }

    return (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div ref={hostRef} style={{ minHeight }} />
        </div>
    );
};

export default QuillEditor;
