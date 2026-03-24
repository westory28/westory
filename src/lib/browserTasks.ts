type IdleCallback = (deadline: IdleDeadline) => void;

type IdleWindow = Window & {
    requestIdleCallback?: (callback: IdleCallback, options?: { timeout?: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
};

export const runWhenIdle = (task: () => void, timeout = 400) => {
    if (typeof window === 'undefined') {
        task();
        return () => undefined;
    }

    const idleWindow = window as IdleWindow;
    if (typeof idleWindow.requestIdleCallback === 'function') {
        const handle = idleWindow.requestIdleCallback(() => {
            task();
        }, { timeout });
        return () => idleWindow.cancelIdleCallback?.(handle);
    }

    const handle = window.setTimeout(task, Math.min(timeout, 250));
    return () => window.clearTimeout(handle);
};

export const runAfterNextPaint = (task: () => void) => {
    if (typeof window === 'undefined') {
        task();
        return () => undefined;
    }

    let secondFrame: number | null = null;
    const firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(task);
    });

    return () => {
        window.cancelAnimationFrame(firstFrame);
        if (secondFrame !== null) {
            window.cancelAnimationFrame(secondFrame);
        }
    };
};
