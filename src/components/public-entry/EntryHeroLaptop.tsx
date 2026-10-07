import React from "react";
import heroLesson from "../../assets/public-entry/hero-lesson-real.webp";
import "./entry-hero-laptop.css";

interface EntryHeroLaptopProps {
  src?: string;
  alt?: string;
  className?: string;
}

/** The lid and keyboard share one hinge; inherited --open controls only the lid. */
export default function EntryHeroLaptop({
  src = heroLesson,
  alt = "실제 위스토리 빈칸 학습지: 조선 건국, 500년 역사의 시작",
  className = "",
}: EntryHeroLaptopProps) {
  return (
    <div className={`entry-opening-laptop ${className}`.trim()}>
      <div className="entry-opening-base" aria-hidden="true">
        <div className="entry-opening-keyboard" />
        <div className="entry-opening-trackpad" />
        <span className="entry-opening-base-notch" />
      </div>
      <div className="entry-opening-lid">
        <div className="entry-opening-lid-front">
          <span className="entry-opening-camera" aria-hidden="true" />
          <div className="entry-opening-screen">
            <img
              src={src}
              alt={alt}
              width="1340"
              height="1050"
              decoding="async"
              {...{ fetchpriority: "high" }}
            />
          </div>
        </div>
        <div className="entry-opening-lid-back" aria-hidden="true">
          <span>
            We<span>story</span>
          </span>
        </div>
      </div>
      <span className="entry-opening-hinge" aria-hidden="true" />
    </div>
  );
}
