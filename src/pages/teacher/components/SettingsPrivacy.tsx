import React, { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import { createManagedNotifications } from "../../../lib/notifications";
import QuillEditor from "../../../components/common/QuillEditor";

interface ConsentItem {
  id: string;
  title: string;
  text: string;
  required: boolean;
  order: number;
}

const defaultTerms = `<p><strong>[이용 약관]</strong></p><p><br></p><p>제1조(목적)</p><p>본 약관은 Westory 서비스의 이용 조건과 운영 원칙을 규정합니다.</p>`;
const defaultPrivacy = [
  "<h2><strong>Westory(위스토리) 개인정보 처리방침</strong></h2>",
  "<p><br></p>",
  "<p>Westory(이하 “서비스”)는 학교 수업, 학습 관리, 평가 결과 확인 및 피드백 제공을 지원하기 위한 교육용 웹 서비스입니다. 서비스는 개인정보 보호법 등 관계 법령을 준수하며, 학생과 교사의 개인정보를 필요한 범위에서만 처리합니다.</p>",
  "<p><br></p>",
  "<p><strong>제1조 개인정보의 처리 목적</strong></p>",
  "<p>서비스는 다음 목적을 위해 개인정보를 처리합니다.</p>",
  "<p>1. 학생 계정 관리: 학생 식별, 로그인, 학급·번호 기반 학습 관리</p>",
  "<p>2. 학습 서비스 제공: 수업자료 제공, 퀴즈·과제 수행 기록 관리, 피드백 제공</p>",
  "<p>3. 평가 관리 지원: 수행평가 및 정기시험 등 평가 결과 확인, 답안지 확인 요청, 이의제기 및 정정 절차 지원, 확인 기록 관리</p>",
  "<p>4. 평가 점수 확인 및 전자 확인: 학생 본인의 수행평가 및 정기시험 결과 열람 여부, 확인 일시, 확인 대상 평가·문항·항목, 전자서명 또는 확인 버튼 기록 보관</p>",
  "<p>5. 교사 업무 지원: 학급 운영, 평가 결과 관리, 학생별 학습 현황 확인</p>",
  "<p>6. 서비스 운영 및 보안: 접속 기록 관리, 오류 확인, 부정 이용 방지, 서비스 이용 통계 작성</p>",
  "<p>처리한 개인정보는 위 목적 외의 용도로 이용하지 않으며, 목적이 변경되는 경우 관계 법령에 따라 필요한 조치를 하겠습니다.</p>",
  "<p><br></p>",
  "<p><strong>제2조 처리하는 개인정보 항목 및 수집 방법</strong></p>",
  "<p>서비스는 다음의 개인정보를 처리할 수 있습니다.</p>",
  "<p>1. 학생 필수 항목</p>",
  "<p>- 교사가 부여한 닉네임, 가명 아이디 또는 학생 식별용 계정</p>",
  "<p>- 비밀번호 또는 인증 정보</p>",
  "<p>- 학급, 번호, 학년, 수업 또는 과목 정보</p>",
  "<p>- 학습 기록, 퀴즈·과제 수행 기록, 제출 내역, 피드백</p>",
  "<p>2. 평가 및 확인 기록</p>",
  "<p>- 수행평가명, 정기시험명, 과목, 평가 영역, 문항, 점수, 배점, 채점 결과, 교사 피드백</p>",
  "<p>- 정기시험 서답형 답안, 정오답 여부, 논술형 점수, 세부 채점 결과 및 피드백</p>",
  "<p>- 점수 열람 여부, 확인 일시, 확인한 평가 항목, 확인 전 안내 문구 동의 여부·일시·버전</p>",
  "<p>- 전자서명 이미지, 서명자 이름, 확인 버튼 기록, 확인 상태, 서명 반려 또는 재확인 안내 기록</p>",
  "<p>- 답안지 확인 요청 대상, 요청 사유, 처리 상태, 검토 메모</p>",
  "<p>- 이의제기 대상, 내용, 처리 결과, 정정 이력</p>",
  "<p>3. 교사 및 관리자 항목</p>",
  "<p>- 이름, 이메일, 로그인 계정, 담당 학급·과목, 서비스 관리 기록</p>",
  "<p>4. 자동 수집 항목</p>",
  "<p>- 접속 일시, 접속 로그, 기기 및 브라우저 정보, IP 주소 일부 또는 보안 로그</p>",
  "<p>- 서비스 이용 기록, 오류 기록, Firebase Analytics 등 통계 목적의 이용 정보</p>",
  "<p>서비스는 주민등록번호, 주소, 건강정보, 생체인식정보, 위치정보, 결제정보 등 수업·평가 운영에 필요하지 않은 정보는 원칙적으로 수집하지 않습니다. 전자서명은 점수 확인 사실을 남기기 위한 기록으로만 사용하며, 생체인식정보로 분석하거나 본인 식별 기술에 활용하지 않습니다.</p>",
  "<p><br></p>",
  "<p><strong>제3조 개인정보 처리의 법적 근거</strong></p>",
  "<p>서비스는 다음 근거에 따라 개인정보를 처리합니다.</p>",
  "<p>1. 학교 수업, 평가, 학업성적 관리 등 교육활동 수행에 필요한 경우</p>",
  "<p>2. 정보주체 또는 법정대리인의 동의를 받은 경우</p>",
  "<p>3. 서비스 이용 약정의 이행과 계정 운영에 필요한 경우</p>",
  "<p>4. 관계 법령, 학교 학업성적관리규정, 감사 또는 분쟁 대응을 위해 필요한 경우</p>",
  "<p><br></p>",
  "<p><strong>제4조 평가 점수 확인, 답안지 확인 요청 및 전자 확인 기록</strong></p>",
  "<p>① 수행평가 및 정기시험 점수와 피드백은 원칙적으로 해당 학생 본인과 권한이 있는 교사만 확인할 수 있습니다.</p>",
  "<p>② 정기시험의 경우 학생 본인의 서답형 정오답, 논술형 점수와 피드백, 답안지 확인 요청 및 처리 상태를 확인할 수 있습니다.</p>",
  "<p>③ 전자서명, 확인 버튼, 확인 전 안내 동의 기록은 해당 평가 결과를 확인했거나 확인 절차 안내를 읽었다는 사실을 남기기 위한 용도로만 사용합니다.</p>",
  "<p>④ 전자 확인 기록은 성적에 대한 동의, 이의제기 포기, 불복권 제한을 의미하지 않습니다.</p>",
  "<p>⑤ 학생은 학교와 교사가 정한 기간 및 절차에 따라 평가 결과에 대해 이의제기, 답안지 확인 또는 정정을 요청할 수 있습니다.</p>",
  "<p>⑥ 온라인 확인이 어려운 학생에게는 교사가 학교 운영 상황에 맞게 별도의 확인 방법을 안내할 수 있습니다.</p>",
  "<p><br></p>",
  "<p><strong>제5조 만 14세 미만 아동의 개인정보 보호</strong></p>",
  "<p>① 서비스는 만 14세 미만 학생이 이해할 수 있도록 개인정보 처리 내용을 쉽고 명확하게 안내하기 위해 노력합니다.</p>",
  "<p>② 법령상 동의가 필요한 개인정보 처리의 경우 법정대리인의 동의를 받거나 학교의 정당한 교육활동 절차에 따라 처리합니다.</p>",
  "<p>③ 법정대리인은 학생의 개인정보 열람, 정정, 삭제, 처리정지 등을 요청할 수 있습니다.</p>",
  "<p><br></p>",
  "<p><strong>제6조 개인정보의 처리 및 보유 기간</strong></p>",
  "<p>서비스는 개인정보를 처리 목적 달성에 필요한 기간 동안만 보유합니다.</p>",
  "<p>1. 학생 계정 정보: 해당 학년도 수업 종료 또는 계정 삭제 시까지</p>",
  "<p>2. 학습 기록: 해당 학년도 종료 후 교사의 학급 정리 시까지</p>",
  "<p>3. 수행평가 및 정기시험 점수, 답안지 확인 요청, 전자 확인 및 이의제기 기록: 성적 확인, 이의제기, 정정 및 학업성적 처리 절차가 종료될 때까지</p>",
  "<p>4. 성적 관련 분쟁·감사 대응에 필요한 기록: 학교 학업성적관리규정 또는 관계 법령에서 정한 기간까지</p>",
  "<p>5. 접속 및 보안 로그: 보안 점검과 부정 이용 방지를 위해 필요한 기간 동안 보관 후 파기</p>",
  "<p>보유 기간이 지난 개인정보는 지체 없이 파기합니다. 단, 법령 또는 학교 규정에 따라 보존이 필요한 경우에는 해당 기간 동안 별도로 보관할 수 있습니다.</p>",
  "<p><br></p>",
  "<p><strong>제7조 개인정보의 제3자 제공</strong></p>",
  "<p>서비스는 원칙적으로 개인정보를 제3자에게 제공하지 않습니다. 다만 다음의 경우에는 필요한 범위에서 제공할 수 있습니다.</p>",
  "<p>1. 정보주체 또는 법정대리인의 동의를 받은 경우</p>",
  "<p>2. 법령에 특별한 규정이 있는 경우</p>",
  "<p>3. 학교 학업성적관리, 감사, 민원 또는 분쟁 대응을 위해 학교 또는 교육청에 제출이 필요한 경우</p>",
  "<p>4. 수사기관 등 관계 기관이 적법한 절차에 따라 요청한 경우</p>",
  "<p><br></p>",
  "<p><strong>제8조 개인정보 처리업무의 위탁 및 국외 이전</strong></p>",
  "<p>서비스는 원활한 운영을 위해 다음과 같이 개인정보 처리업무를 위탁할 수 있습니다.</p>",
  "<p>- 수탁자: Google LLC</p>",
  "<p>- 사용 서비스: Firebase Authentication, Cloud Firestore, Firebase Storage, Firebase Hosting, Firebase Analytics 등</p>",
  "<p>- 위탁 업무: 사용자 인증, 데이터 저장, 파일 저장, 웹 호스팅, 접속 로그 및 통계 처리</p>",
  "<p>- 처리 항목: 계정 정보, 학습 기록, 평가 확인 기록, 접속 기록 등 서비스 운영에 필요한 정보</p>",
  "<p>- 이전 국가: 미국 및 Google Cloud/Firebase 데이터센터 소재 국가</p>",
  "<p>- 이전 시기 및 방법: 서비스 이용 시 네트워크를 통한 전송</p>",
  "<p>- 보유 및 이용 기간: 서비스 이용 기간 또는 위탁 계약 종료 시까지</p>",
  "<p>위탁 업무의 내용이나 수탁자가 변경되는 경우 개인정보 처리방침을 통해 공개하겠습니다.</p>",
  "<p><br></p>",
  "<p><strong>제9조 개인정보의 파기 절차 및 방법</strong></p>",
  "<p>① 처리 목적이 달성되거나 보유 기간이 지난 개인정보는 내부 확인 후 지체 없이 파기합니다.</p>",
  "<p>② 전자적 파일은 복구하기 어려운 방법으로 삭제합니다.</p>",
  "<p>③ 종이 문서가 있는 경우 분쇄하거나 소각합니다.</p>",
  "<p>④ 백업 데이터는 정해진 보관 주기에 따라 삭제하며, 복구 목적 외에는 사용하지 않습니다.</p>",
  "<p><br></p>",
  "<p><strong>제10조 개인정보의 안전성 확보 조치</strong></p>",
  "<p>서비스는 개인정보 보호를 위해 다음 조치를 적용합니다.</p>",
  "<p>1. 비밀번호 원문 미저장 및 암호화 또는 인증 제공자의 안전한 인증 방식 사용</p>",
  "<p>2. HTTPS 암호화 통신 적용</p>",
  "<p>3. 교사와 학생의 접근 권한 분리</p>",
  "<p>4. 학생별 본인 정보만 열람되도록 권한 관리</p>",
  "<p>5. 평가 결과, 답안 확인 요청, 이의제기 기록과 서명 기록의 무단 열람·수정 방지</p>",
  "<p>6. 관리자 접근 권한 최소화</p>",
  "<p>7. 접속 기록 및 주요 변경 이력 관리</p>",
  "<p>8. 학생 점수, 답안 정보와 서명 정보가 공개 화면, 통계 이벤트, 광고 목적 데이터로 노출되지 않도록 관리</p>",
  "<p><br></p>",
  "<p><strong>제11조 정보주체와 법정대리인의 권리 행사</strong></p>",
  "<p>① 학생 및 법정대리인은 개인정보 열람, 정정, 삭제, 처리정지를 요청할 수 있습니다.</p>",
  "<p>② 요청은 개인정보 보호책임자에게 이메일 또는 연락처로 할 수 있습니다.</p>",
  "<p>③ 서비스는 본인 또는 정당한 법정대리인 여부를 확인한 뒤 지체 없이 조치합니다.</p>",
  "<p>④ 다만 성적 처리, 학업성적관리, 감사, 분쟁 대응 등 법령이나 학교 규정에 따라 보관이 필요한 정보는 삭제 또는 처리정지가 제한될 수 있습니다.</p>",
  "<p><br></p>",
  "<p><strong>제12조 자동 수집 장치 및 이용 통계</strong></p>",
  "<p>서비스는 로그인 유지, 보안, 오류 확인, 이용 통계 작성을 위해 쿠키, 로컬 저장소, Firebase Analytics 등을 사용할 수 있습니다.</p>",
  "<p>서비스는 맞춤형 광고를 목적으로 학생의 행태정보를 수집하거나 제공하지 않습니다. 또한 성적, 답안, 피드백, 전자서명 원본 등 평가 관련 세부정보를 광고 또는 마케팅 목적으로 사용하지 않습니다.</p>",
  "<p><br></p>",
  "<p><strong>제13조 개인정보 보호책임자</strong></p>",
  "<p>서비스 이용 중 개인정보 관련 문의, 열람·정정·삭제 요청, 고충 처리는 아래 책임자에게 연락해 주시기 바랍니다.</p>",
  "<p>- 성명: 방재석</p>",
  "<p>- 직위: 교사, Westory 운영자</p>",
  "<p>- 이메일: westoria28@gmail.com</p>",
  "<p>- 연락처: 070-4022-2975</p>",
  "<p><br></p>",
  "<p><strong>제14조 권익침해 구제 방법</strong></p>",
  "<p>개인정보 침해에 대한 상담이나 신고가 필요한 경우 다음 기관에 문의할 수 있습니다.</p>",
  "<p>- 개인정보침해신고센터: 국번 없이 118, privacy.kisa.or.kr</p>",
  "<p>- 개인정보분쟁조정위원회: 1833-6972, www.kopico.go.kr</p>",
  "<p>- 개인정보보호위원회: www.pipc.go.kr</p>",
  "<p><br></p>",
  "<p><strong>제15조 개인정보 처리방침의 변경</strong></p>",
  "<p>이 개인정보 처리방침은 서비스 화면 또는 웹사이트를 통해 공개합니다. 처리방침이 변경되는 경우 변경 내용과 시행일을 알리겠습니다.</p>",
  "<p><br></p>",
  "<p>이 개인정보 처리방침은 2026년 7월 7일부터 적용됩니다.</p>",
].join("");

const SettingsPrivacy: React.FC = () => {
  const { showToast } = useAppToast();
  const { config } = useAuth();
  const [activeTab, setActiveTab] = useState<"terms" | "privacy" | "consent">(
    "terms",
  );
  const [termsText, setTermsText] = useState("");
  const [privacyText, setPrivacyText] = useState("");
  const [privacySaving, setPrivacySaving] = useState(false);
  const [notifyPrivacyChange, setNotifyPrivacyChange] = useState(false);
  const [consentItems, setConsentItems] = useState<ConsentItem[]>([]);
  const [expandedConsentId, setExpandedConsentId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    void loadTerms();
    void loadPrivacy();
    void loadConsentItems();
  }, []);

  const loadTerms = async () => {
    try {
      const snap = await getDoc(doc(db, "site_settings", "terms"));
      if (snap.exists() && snap.data().text) {
        setTermsText(snap.data().text);
      } else {
        setTermsText(defaultTerms);
      }
    } catch (error) {
      console.error("Failed to load terms:", error);
    }
  };

  const saveTerms = async () => {
    try {
      await setDoc(doc(db, "site_settings", "terms"), {
        text: termsText,
        updatedAt: serverTimestamp(),
      });
      showToast({
        tone: "success",
        title: "이용 약관을 저장했습니다.",
      });
    } catch (error: any) {
      showToast({
        tone: "error",
        title: "이용 약관 저장에 실패했습니다.",
        message: error.message,
      });
    }
  };

  const loadPrivacy = async () => {
    try {
      const snap = await getDoc(doc(db, "site_settings", "privacy"));
      if (snap.exists() && snap.data().text) {
        setPrivacyText(snap.data().text);
      } else {
        setPrivacyText(defaultPrivacy);
      }
    } catch (error) {
      console.error("Failed to load privacy:", error);
    }
  };

  const savePrivacy = async () => {
    if (privacySaving) return;
    setPrivacySaving(true);
    try {
      await setDoc(doc(db, "site_settings", "privacy"), {
        text: privacyText,
        updatedAt: serverTimestamp(),
      });

      if (notifyPrivacyChange) {
        try {
          const result = await createManagedNotifications(config, {
            recipientMode: "all_students",
            type: "privacy_policy_updated",
            title: "개인정보 처리 방침이 변경되었습니다",
            body: "Westory 개인정보 처리 방침이 업데이트되었습니다. 내용을 확인해 주세요.",
            targetUrl: "/student/dashboard",
            entityType: "privacy_policy",
            entityId: "site_settings/privacy",
            priority: "high",
            dedupeKey: `privacy_policy_updated:${Date.now()}`,
          });

          setNotifyPrivacyChange(false);
          showToast({
            tone: result.createdCount > 0 ? "success" : "warning",
            title:
              result.createdCount > 0
                ? "개인정보 처리 방침을 저장하고 학생 알림을 보냈습니다."
                : "개인정보 처리 방침을 저장했습니다.",
            message:
              result.createdCount > 0
                ? "학생 알림함에 변경 안내가 표시됩니다."
                : "알림 설정이 꺼져 있어 학생 알림은 생성되지 않았습니다.",
          });
        } catch (notificationError: any) {
          showToast({
            tone: "warning",
            title: "개인정보 처리 방침은 저장했습니다.",
            message:
              notificationError?.message ||
              "학생 알림 생성에 실패했습니다. 알림 설정과 Functions 배포 상태를 확인해 주세요.",
          });
        }
        return;
      }

      showToast({
        tone: "success",
        title: "개인정보 처리 방침을 저장했습니다.",
      });
    } catch (error: any) {
      showToast({
        tone: "error",
        title: "개인정보 처리 방침 저장에 실패했습니다.",
        message: error.message,
      });
    } finally {
      setPrivacySaving(false);
    }
  };

  const loadConsentItems = async () => {
    try {
      const q = query(
        collection(db, "site_settings", "consent", "items"),
        orderBy("order", "asc"),
      );
      const snap = await getDocs(q);
      const items: ConsentItem[] = [];
      snap.forEach((d) =>
        items.push({ id: d.id, ...(d.data() as Omit<ConsentItem, "id">) }),
      );
      setConsentItems(items);
    } catch (error) {
      console.error("Failed to load consent items:", error);
    }
  };

  const addConsentItem = async () => {
    try {
      const newOrder = consentItems.length + 1;
      const payload = {
        title: "새 동의 항목",
        text: "<p>동의 내용을 입력하세요.</p>",
        required: true,
        order: newOrder,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const docRef = await addDoc(
        collection(db, "site_settings", "consent", "items"),
        payload,
      );
      await setDoc(
        doc(db, "site_settings", "consent"),
        { updatedAt: serverTimestamp() },
        { merge: true },
      );
      setConsentItems((prev) => [
        ...prev,
        { id: docRef.id, ...payload } as ConsentItem,
      ]);
      setExpandedConsentId(docRef.id);
    } catch (error: any) {
      showToast({
        tone: "error",
        title: "동의 항목 추가에 실패했습니다.",
        message: error.message,
      });
    }
  };

  const updateConsentItem = (
    id: string,
    field: keyof ConsentItem,
    value: any,
  ) => {
    setConsentItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
  };

  const saveConsentItem = async (id: string) => {
    const item = consentItems.find((x) => x.id === id);
    if (!item) return;
    if (!item.title.trim()) {
      showToast({
        tone: "warning",
        title: "항목 제목을 입력해 주세요.",
      });
      return;
    }
    if (!item.text.trim()) {
      showToast({
        tone: "warning",
        title: "동의 내용을 입력해 주세요.",
      });
      return;
    }

    try {
      await updateDoc(doc(db, "site_settings", "consent", "items", id), {
        title: item.title,
        text: item.text,
        required: item.required,
        updatedAt: serverTimestamp(),
      });
      showToast({
        tone: "success",
        title: `'${item.title}' 항목을 저장했습니다.`,
      });
    } catch (error: any) {
      showToast({
        tone: "error",
        title: "동의 항목 저장에 실패했습니다.",
        message: error.message,
      });
    }
  };

  const deleteConsentItem = async (id: string) => {
    const item = consentItems.find((x) => x.id === id);
    if (!item) return;
    if (!window.confirm(`'${item.title}' 항목을 삭제하시겠습니까?`)) return;

    try {
      await deleteDoc(doc(db, "site_settings", "consent", "items", id));
      setConsentItems((prev) => prev.filter((x) => x.id !== id));
      if (expandedConsentId === id) setExpandedConsentId(null);
      showToast({
        tone: "success",
        title: "동의 항목을 삭제했습니다.",
      });
    } catch (error: any) {
      showToast({
        tone: "error",
        title: "동의 항목 삭제에 실패했습니다.",
        message: error.message,
      });
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="border-b border-gray-100 p-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveTab("terms")}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition ${activeTab === "terms" ? "bg-blue-600 text-white shadow" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            이용 약관
          </button>
          <button
            onClick={() => setActiveTab("privacy")}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition ${activeTab === "privacy" ? "bg-blue-600 text-white shadow" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            개인정보 처리 방침
          </button>
          <button
            onClick={() => setActiveTab("consent")}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition ${activeTab === "consent" ? "bg-blue-600 text-white shadow" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            개인정보 동의 관리
          </button>
        </div>
      </div>

      <div className="p-6 lg:p-8">
        {activeTab === "terms" && (
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                <i className="fas fa-file-contract text-blue-500 mr-2"></i>이용
                약관 관리
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                로그인 화면 하단의 이용 약관에 표시됩니다.
              </p>
            </div>
            <QuillEditor
              value={termsText}
              onChange={setTermsText}
              minHeight={360}
              maxHeight={520}
              placeholder="이용 약관 내용을 작성하세요."
              toolbar={[
                [{ header: [1, 2, 3, false] }],
                ["bold", "italic", "underline", "strike"],
                [{ color: [] }, { background: [] }],
                [{ list: "ordered" }, { list: "bullet" }],
                ["link"],
                ["clean"],
              ]}
            />
            <div className="text-right">
              <button
                onClick={() => void saveTerms()}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl shadow-lg transition"
              >
                이용 약관 저장
              </button>
            </div>
          </div>
        )}

        {activeTab === "privacy" && (
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                <i className="fas fa-user-shield text-green-500 mr-2"></i>
                개인정보 처리 방침 관리
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                로그인 화면 하단의 개인정보 처리 방침에 표시됩니다.
              </p>
            </div>
            <QuillEditor
              value={privacyText}
              onChange={setPrivacyText}
              minHeight={360}
              maxHeight={520}
              placeholder="개인정보 처리 방침 내용을 작성하세요."
              toolbar={[
                [{ header: [1, 2, 3, false] }],
                ["bold", "italic", "underline", "strike"],
                [{ color: [] }, { background: [] }],
                [{ list: "ordered" }, { list: "bullet" }],
                ["link"],
                ["clean"],
              ]}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
              <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-700">
                <input
                  type="checkbox"
                  checked={notifyPrivacyChange}
                  disabled={privacySaving}
                  onChange={(e) => setNotifyPrivacyChange(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                저장 후 학생에게 알림 보내기
              </label>
              <button
                onClick={() => void savePrivacy()}
                disabled={privacySaving}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold py-3 px-8 rounded-xl shadow-lg transition"
              >
                {privacySaving ? "저장 중..." : "개인정보 처리 방침 저장"}
              </button>
            </div>
          </div>
        )}

        {activeTab === "consent" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  <i className="fas fa-handshake text-purple-500 mr-2"></i>
                  개인정보 동의 항목 관리
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  학생 최초 로그인 시 노출되는 동의 항목입니다.
                </p>
              </div>
              <button
                onClick={() => void addConsentItem()}
                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 px-5 rounded-xl shadow-lg transition text-sm"
              >
                <i className="fas fa-plus mr-1"></i>항목 추가
              </button>
            </div>

            <div className="bg-purple-50 p-3 rounded-lg text-sm text-purple-700 border border-purple-100">
              <i className="fas fa-info-circle mr-1"></i>필수 항목은 학생이
              동의해야 서비스를 이용할 수 있습니다.
            </div>

            <div className="space-y-4">
              {consentItems.length === 0 && (
                <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
                  <i className="fas fa-clipboard-list text-4xl text-gray-300 mb-3"></i>
                  <p className="text-gray-400 font-semibold">
                    등록된 동의 항목이 없습니다.
                  </p>
                </div>
              )}

              {consentItems.map((item, idx) => (
                <div
                  key={item.id}
                  className="bg-white border border-gray-200 rounded-xl hover:border-purple-200 hover:shadow-sm transition"
                >
                  <div
                    className="flex items-center justify-between p-4 cursor-pointer"
                    onClick={() =>
                      setExpandedConsentId(
                        expandedConsentId === item.id ? null : item.id,
                      )
                    }
                  >
                    <div className="flex items-center gap-3">
                      <span className="bg-purple-100 text-purple-600 font-bold text-xs px-2.5 py-1 rounded-full">
                        {idx + 1}
                      </span>
                      <span className="font-bold text-gray-800">
                        {item.title || "제목 없음"}
                      </span>
                      {item.required ? (
                        <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-semibold">
                          필수
                        </span>
                      ) : (
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-semibold">
                          선택
                        </span>
                      )}
                    </div>
                    <i
                      className={`fas fa-chevron-down text-gray-400 text-xs transition-transform ${expandedConsentId === item.id ? "transform rotate-180" : ""}`}
                    ></i>
                  </div>

                  {expandedConsentId === item.id && (
                    <div className="p-4 border-t border-gray-100 bg-gray-50 space-y-4 rounded-b-xl">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 mb-1">
                            항목 제목
                          </label>
                          <input
                            type="text"
                            value={item.title}
                            onChange={(e) =>
                              updateConsentItem(
                                item.id,
                                "title",
                                e.target.value,
                              )
                            }
                            className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                          />
                        </div>
                        <div className="flex items-end gap-4">
                          <label className="flex items-center gap-2 cursor-pointer mb-2">
                            <input
                              type="checkbox"
                              checked={item.required}
                              onChange={(e) =>
                                updateConsentItem(
                                  item.id,
                                  "required",
                                  e.target.checked,
                                )
                              }
                              className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                            />
                            <span className="text-sm font-semibold text-gray-600">
                              필수 동의
                            </span>
                          </label>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">
                          동의 내용
                        </label>
                        <QuillEditor
                          value={item.text}
                          onChange={(html) =>
                            updateConsentItem(item.id, "text", html)
                          }
                          minHeight={220}
                          maxHeight={360}
                          placeholder="동의 내용을 작성하세요."
                          toolbar={[
                            [{ header: [1, 2, false] }],
                            ["bold", "italic", "underline"],
                            [{ list: "ordered" }, { list: "bullet" }],
                            ["link"],
                            ["clean"],
                          ]}
                        />
                      </div>

                      <div className="flex justify-between items-center pt-2">
                        <button
                          onClick={() => void deleteConsentItem(item.id)}
                          className="text-red-400 text-sm hover:text-red-600 flex items-center gap-1 transition"
                        >
                          <i className="fas fa-trash-alt"></i>삭제
                        </button>
                        <button
                          onClick={() => void saveConsentItem(item.id)}
                          className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 px-6 rounded-xl shadow-lg transition text-sm"
                        >
                          저장
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsPrivacy;
