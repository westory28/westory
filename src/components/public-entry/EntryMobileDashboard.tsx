import { useId } from "react";
import { MENUS } from "../../constants/menus";
import "./entry-mobile-dashboard.css";

const week = [
  { day: "일", date: "27" },
  { day: "월", date: "28" },
  { day: "화", date: "29" },
  { day: "수", date: "30" },
  { day: "목", date: "1", selected: true },
  { day: "금", date: "2" },
  { day: "토", date: "3" },
];
const shortcuts = [
  { label: "수업 자료", menu: "학습" },
  { label: "문제 풀이", menu: "평가" },
];

/** A fictional, non-interactive rendering of the student portal, with no account reads. */
export default function EntryMobileDashboard({
  className = "",
}: {
  className?: string;
}) {
  const screenId = `entry-mobile-screen-${useId().replace(/:/g, "")}`;

  return (
    <div className={`entry-mobile-dashboard ${className}`}>
      <svg
        className="entry-mobile-dashboard-art"
        viewBox="0 0 384 804"
        role="img"
        aria-label="주간 일정과 수업 자료, 문제 풀이 메뉴가 보이는 학생 대시보드 가상 화면"
        focusable="false"
      >
        <defs>
          <clipPath id={screenId}>
            <rect x="12" y="12" width="360" height="780" rx="42" />
          </clipPath>
        </defs>

        <rect
          className="emd-frame"
          x="2"
          y="2"
          width="380"
          height="800"
          rx="54"
        />
        <g clipPath={`url(#${screenId})`}>
          <rect
            className="emd-background"
            x="12"
            y="12"
            width="360"
            height="780"
          />
          <path className="emd-surface" d="M12 12h360v106H12z" />

          <text className="emd-status" x="38" y="46">
            9:41
          </text>
          <g className="emd-status-icons" fill="none" strokeWidth="2">
            <path d="M292 43v-4m5 4v-7m5 7V33" />
            <path d="M310 36q7-6 14 0m-11 3q4-3 8 0m-4 3h.01" />
            <rect x="332" y="33" width="18" height="10" rx="2" />
            <path d="M353 36v4" />
            <path d="M335 36h12v4h-12z" fill="currentColor" stroke="none" />
          </g>

          <text className="emd-wordmark" x="30" y="97">
            <tspan>We</tspan>
            <tspan className="emd-accent">story</tspan>
          </text>
          <g
            className="emd-menu-icon"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M324 78h20m-20 7h20m-20 7h20" />
          </g>
          <path className="emd-rule" d="M12 117h360" />

          <rect
            className="emd-card"
            x="28"
            y="134"
            width="328"
            height="100"
            rx="12"
          />
          <text className="emd-label" x="44" y="161">
            알림 마당
          </text>
          <text className="emd-title" x="44" y="189">
            이번 주 학습
          </text>
          <text className="emd-body" x="44" y="213">
            조선의 성립과 발전
          </text>
          <g
            className="emd-book"
            transform="translate(308 173)"
            fill="none"
            strokeWidth="1.6"
          >
            <path d={MENUS.student[0].icon} />
          </g>

          <rect
            className="emd-card"
            x="28"
            y="250"
            width="328"
            height="262"
            rx="12"
          />
          <text className="emd-title" x="44" y="279">
            이번 주 학사 일정
          </text>
          <text className="emd-label" x="44" y="305">
            9월 27일 – 10월 3일
          </text>
          <rect
            className="emd-blue-soft"
            x="266"
            y="289"
            width="74"
            height="24"
            rx="8"
          />
          <text className="emd-attendance" x="303" y="305" textAnchor="middle">
            출석 완료
          </text>

          {week.map((item, index) => (
            <g key={item.day} transform={`translate(${60 + index * 44} 0)`}>
              {item.selected && (
                <rect
                  className="emd-blue"
                  x="-18"
                  y="326"
                  width="36"
                  height="70"
                  rx="12"
                />
              )}
              <text
                className={item.selected ? "emd-day emd-white" : "emd-day"}
                y="346"
                textAnchor="middle"
              >
                {item.day}
              </text>
              <text
                className={item.selected ? "emd-date emd-white" : "emd-date"}
                y="374"
                textAnchor="middle"
              >
                {item.date}
              </text>
              {index > 0 && index < 6 && (
                <circle
                  className={item.selected ? "emd-white" : "emd-blue"}
                  cy="386"
                  r="2"
                />
              )}
            </g>
          ))}
          <path className="emd-rule" d="M44 410h296" />
          <rect
            className="emd-blue-soft"
            x="40"
            y="422"
            width="304"
            height="34"
            rx="8"
          />
          <text className="emd-event-date" x="50" y="444">
            10/1
          </text>
          <text className="emd-event" x="96" y="444">
            조선의 성립과 발전
          </text>
          <text className="emd-label" x="332" y="444" textAnchor="end">
            3교시
          </text>
          <text className="emd-event-date" x="50" y="488">
            10/2
          </text>
          <text className="emd-event" x="96" y="488">
            생각모아 활동
          </text>
          <text className="emd-label" x="332" y="488" textAnchor="end">
            2교시
          </text>

          <text className="emd-title" x="28" y="547">
            학습 메뉴
          </text>
          {shortcuts.map((item, index) => (
            <g key={item.menu} transform={`translate(${28 + index * 172} 562)`}>
              <rect className="emd-card" width="156" height="100" rx="12" />
              <g
                className="emd-book"
                transform="translate(16 14)"
                fill="none"
                strokeWidth="1.6"
              >
                <path
                  d={
                    MENUS.student.find((menu) => menu.name === item.menu)?.icon
                  }
                />
              </g>
              <text className="emd-shortcut" x="16" y="74">
                {item.label}
              </text>
              <path
                className="emd-chevron"
                d="m130 64 5 5-5 5"
                fill="none"
                strokeWidth="1.6"
              />
            </g>
          ))}
          <rect
            className="emd-card"
            x="28"
            y="678"
            width="328"
            height="56"
            rx="12"
          />
          <g
            className="emd-book"
            transform="translate(44 692)"
            fill="none"
            strokeWidth="1.6"
          >
            <path
              d={MENUS.student.find((menu) => menu.name === "점수")?.icon}
            />
          </g>
          <text className="emd-shortcut" x="80" y="712">
            나의 성적표
          </text>
          <path
            className="emd-chevron"
            d="m330 700 5 5-5 5"
            fill="none"
            strokeWidth="1.6"
          />
          <text className="emd-label" x="192" y="761" textAnchor="middle">
            가상 화면
          </text>
          <rect
            className="emd-home-indicator"
            x="132"
            y="779"
            width="120"
            height="4"
            rx="2"
          />
        </g>

        <rect
          className="emd-notch"
          x="132"
          y="24"
          width="120"
          height="28"
          rx="14"
        />
        <circle className="emd-camera" cx="237" cy="38" r="4" />
      </svg>
    </div>
  );
}
