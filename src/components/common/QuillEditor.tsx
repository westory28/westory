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
    const onChangeRef = useRef(onChange);
    const toolbarRef = useRef(toolbar);
    const placeholderRef = useRef(placeholder || '');
    const [ready, setReady] = useState(false);

    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
        toolbarRef.current = toolbar;
    }, [toolbar]);

    useEffect(() => {
        placeholderRef.current = placeholder || '';
    }, [placeholder]);

    useEffect(() => {
        if (!hostRef.current) return;
        let canceled = false;
        let changeHandler: (() => void) | null = null;

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
                    modules: { toolbar: toolbarRef.current },
                    placeholder: placeholderRef.current,
                });

                quillRef.current = quill;
                syncingRef.current = true;
                quill.clipboard.dangerouslyPasteHTML(value || '');
                syncingRef.current = false;

                changeHandler = () => {
                    if (!quillRef.current || syncingRef.current) return;
                    onChangeRef.current(quillRef.current.root.innerHTML);
                };
                quill.on('text-change', changeHandler);
                setReady(true);
            })
            .catch((error) => {
                console.error('Failed to initialize Quill editor', error);
                setReady(false);
            });

        return () => {
            canceled = true;
            if (quillRef.current && changeHandler) {
                quillRef.current.off('text-change', changeHandler);
            }
            quillRef.current = null;
            if (hostRef.current) {
                hostRef.current.innerHTML = '';
            }
        };
    }, []);

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
        <div className="westory-quill bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div ref={hostRef} style={{ minHeight }} />
            <style>{`
                .westory-quill .ql-editor {
                    counter-reset: list-0 list-1 list-2 list-3 list-4 list-5 list-6 list-7 list-8 list-9;
                }
                .westory-quill .ql-editor li[data-list='bullet'] > .ql-ui:before {
                    content: '\\2022';
                }
                .westory-quill .ql-editor li[data-list='ordered'] {
                    counter-increment: list-0;
                    counter-reset: list-1 list-2 list-3 list-4 list-5 list-6 list-7 list-8 list-9;
                }
                .westory-quill .ql-editor li[data-list='ordered'] > .ql-ui:before {
                    content: counter(list-0, decimal) '. ';
                    font-variant-numeric: tabular-nums;
                }
                .westory-quill .ql-editor li.ql-indent-1[data-list='ordered'] {
                    counter-increment: list-1;
                    counter-reset: list-2 list-3 list-4 list-5 list-6 list-7 list-8 list-9;
                }
                .westory-quill .ql-editor li.ql-indent-1[data-list='ordered'] > .ql-ui:before {
                    content: counter(list-1, lower-alpha) '. ';
                }
                .westory-quill .ql-editor li.ql-indent-2[data-list='ordered'] {
                    counter-increment: list-2;
                    counter-reset: list-3 list-4 list-5 list-6 list-7 list-8 list-9;
                }
                .westory-quill .ql-editor li.ql-indent-2[data-list='ordered'] > .ql-ui:before {
                    content: counter(list-2, lower-roman) '. ';
                }
            `}</style>
        </div>
    );
};

export default QuillEditor;
