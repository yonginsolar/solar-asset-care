import Link from 'next/link';
import { ServiceContact } from '@/components/service-help';

export default function HelpPage() {
  return (
    <main className="min-h-svh bg-slate-50 px-4 py-10 text-slate-900">
      <article className="mx-auto max-w-3xl space-y-7 rounded-3xl border bg-white p-6 sm:p-10">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center font-bold text-teal-800"
        >
          SolarScope 홈
        </Link>
        <h1 className="text-2xl font-bold">이용 안내·문의</h1>
        <section className="space-y-3 text-sm leading-7">
          <h2 className="text-lg font-bold">점검은 어떻게 의뢰하나요?</h2>
          <p>
            회원가입과 로그인 후 ‘내 발전소’에서 발전소를 등록하고, ‘점검
            의뢰’에서 발전소와 점검 목적을 선택해 요청하세요. 경제성 분석에
            필요한 발전량·비용 자료는 나중에 추가할 수 있습니다.
          </p>
        </section>
        <section className="space-y-3 text-sm leading-7">
          <h2 className="text-lg font-bold">사진은 어디에 보내나요?</h2>
          <p>
            사진 등록은 담당 관리자·전문가가 진행합니다. 보유한 사진이 있다면
            점검 번호와 함께 담당자에게 원본 파일의 전달 방법을 확인해 주세요.
            가능하면 메신저로 변환한 사진 대신 촬영 장비에서 받은 원본을 준비해
            주세요.
          </p>
        </section>
        <section className="space-y-3 text-sm leading-7">
          <h2 className="text-lg font-bold">접수한 뒤에는 무엇을 하나요?</h2>
          <p>
            ‘점검 의뢰’의 ‘점검 열기’에서 진행 단계와 일정을 확인하세요. 사진
            확인과 전문가 검토가 끝나 보고서가 발행되면 ‘진단 보고서’에서 결과를
            볼 수 있습니다.
          </p>
        </section>
        <section className="space-y-3 text-sm leading-7">
          <h2 className="text-lg font-bold">로그인·초대에 문제가 있나요?</h2>
          <p>
            비밀번호를 잊었다면 로그인 화면의 ‘비밀번호를 잊으셨나요?’를
            이용하세요. 관리자·전문가 초대 링크가 만료되었다면 초대한 관리자에게
            재발송을 요청해 주세요.
          </p>
        </section>
        <section className="space-y-3 rounded-xl bg-teal-50 p-5 text-sm leading-7">
          <h2 className="text-lg font-bold">문의하기</h2>
          <ServiceContact />
          <p>
            점검 관련 문의에는 발전소 이름과 점검 번호를 알려 주세요. 비밀번호나
            로그인 링크는 보내지 마세요.
          </p>
        </section>
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center rounded-xl bg-teal-800 px-5 text-sm font-semibold text-white"
        >
          내 작업공간으로 이동
        </Link>
      </article>
    </main>
  );
}
