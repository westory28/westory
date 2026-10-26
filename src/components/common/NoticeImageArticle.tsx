import React, { useId, useMemo, useState } from "react";

export const hasNoticeImageArticleMarkup = (bodyHtml: string) =>
  /<article\b[^>]*\bclass\s*=\s*(["'])[^"']*\bwe-notice-images\b[^"']*\1/i.test(
    bodyHtml,
  );

interface NoticeImage {
  src: string;
  srcSet?: string;
  sizes?: string;
  alt: string;
  width?: number;
  height?: number;
}

// A detached div can still fetch its images. A template keeps both src and
// srcset inert until the reader explicitly expands the detail panels.
const readNoticeImages = (bodyHtml: string) => {
  const template = document.createElement("template");
  template.innerHTML = bodyHtml;
  const article = template.content.querySelector("article.we-notice-images");
  const readImage = (image: HTMLImageElement): NoticeImage => ({
    src: image.getAttribute("src") || "",
    srcSet: image.getAttribute("srcset") || undefined,
    sizes: image.getAttribute("sizes") || undefined,
    alt: image.getAttribute("alt") || "",
    width: Number(image.getAttribute("width")) || undefined,
    height: Number(image.getAttribute("height")) || undefined,
  });
  const cover = article?.querySelector<HTMLImageElement>(
    ".we-notice-images__cover img",
  );
  return {
    theme: article?.classList.contains("we-notice-images--exam")
      ? "exam"
      : article?.classList.contains("we-notice-images--reopen")
        ? "reopen"
        : "performance",
    cover: cover ? readImage(cover) : null,
    details: Array.from(
      article?.querySelectorAll<HTMLImageElement>(
        ".we-notice-images__details img",
      ) || [],
      readImage,
    ).filter((image) => image.src),
  };
};

const NoticeImageArticle: React.FC<{ bodyHtml: string; title: string }> = ({
  bodyHtml,
  title,
}) => {
  const { theme, cover, details } = useMemo(
    () => readNoticeImages(bodyHtml),
    [bodyHtml],
  );
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const renderImage = (image: NoticeImage, index: number, isCover = false) => (
    <figure
      key={`${index}:${image.src}`}
      className={isCover ? "we-notice-images__cover" : undefined}
    >
      <a
        href={image.src}
        target="_blank"
        rel="noopener noreferrer"
        title={`${isCover ? "대표" : `${index + 1}번째 안내`} 이미지 원본 보기 (새 탭)`}
      >
        <img
          src={image.src}
          srcSet={image.srcSet}
          sizes={image.sizes}
          alt={image.alt || title}
          width={image.width}
          height={image.height}
          loading={isCover || index === 0 ? "eager" : "lazy"}
          decoding="async"
        />
      </a>
    </figure>
  );

  return (
    <article
      className={`westory-event-article we-notice-images we-notice-images--${theme}`}
      aria-label={title}
    >
      <div
        className={`we-notice-images__preview${cover?.src && details.length > 0 && !expanded ? " we-notice-images__preview--collapsed" : ""}`}
      >
        {cover?.src && renderImage(cover, 0, true)}
        {details.length > 0 && (
          <div className="we-notice-images__actions">
            <button
              type="button"
              className="we-notice-images__toggle"
              aria-expanded={expanded}
              aria-controls={detailId}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "접기" : "더보기"}
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="m6 9 6 6 6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        )}
      </div>
      {details.length > 0 && (
        <section id={detailId} className="we-notice-images__details">
          {expanded && details.map((image, index) => renderImage(image, index))}
        </section>
      )}
    </article>
  );
};

export default NoticeImageArticle;
