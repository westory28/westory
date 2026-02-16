/**
 * Nav Optimizer for Westory
 * Implements link prefetching on hover to improve perceived performance.
 */

document.addEventListener('DOMContentLoaded', () => {
    const prefetchLink = (url) => {
        if (!url) return;

        // check if already prefetched
        if (document.querySelector(`link[rel="prefetch"][href="${url}"]`)) {
            return;
        }

        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = url;
        document.head.appendChild(link);
    };

    const links = document.querySelectorAll('a');
    links.forEach(link => {
        link.addEventListener('mouseenter', () => {
            const href = link.getAttribute('href');
            if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                prefetchLink(href);
            }
        });
    });
});
