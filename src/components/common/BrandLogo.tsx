import React from "react";
import wordmarkUrl from "../../assets/brand/westory-wordmark.webp";
import markUrl from "../../assets/brand/westory-mark.webp";
import "./brandLogo.css";

type BrandLogoProps = {
  variant?: "full" | "mark";
  className?: string;
  decorative?: boolean;
};

export default function BrandLogo({
  variant = "full",
  className = "",
  decorative = false,
}: BrandLogoProps) {
  const compact = variant === "mark";
  return (
    <img
      className={`ws-brand-logo ${className}`.trim()}
      src={compact ? markUrl : wordmarkUrl}
      width={compact ? 256 : 1024}
      height={compact ? 127 : 237}
      alt={decorative ? "" : "위스토리"}
      aria-hidden={decorative || undefined}
      decoding="async"
      draggable={false}
    />
  );
}
