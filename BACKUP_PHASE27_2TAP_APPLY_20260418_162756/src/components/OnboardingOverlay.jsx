import React, { useState } from 'react';

const STEPS = [
  {
    emoji:   '👆',
    title:   '"일손 구하기" 누르세요',
    desc:    '오른쪽 아래 초록 버튼 하나면 시작돼요.',
    hint:    'Step 1 / 3',
  },
  {
    emoji:   '⚡',
    title:   '간단히 등록하면 끝',
    desc:    '작업 종류, 지역, 날짜만 고르면 10초 만에 올라가요.',
    hint:    'Step 2 / 3',
  },
  {
    emoji:   '📞',
    title:   '사람 선택 후 바로 연락',
    desc:    '지원자 중 마음에 드는 분 선택하면 전화번호가 바로 공개돼요.',
    hint:    'Step 3 / 3',
  },
];

/**
 * OnboardingOverlay — 최초 1회 안내 (localStorage 'farm-onboarded' 체크)
 */
export default function OnboardingOverlay({ onDone }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast  = step === STEPS.length - 1;

  function next() {
    if (isLast) {
      localStorage.setItem('farm-onboarded', 'true');
      onDone?.();
    } else {
      setStep(s => s + 1);
    }
  }

  function skip() {
    localStorage.setItem('farm-onboarded', 'true');
    onDone?.();
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 flex items-end">
      <div className="w-full max-w-lg mx-auto bg-white rounded-t-3xl px-6 pt-8 pb-10">

        {/* 스텝 인디케이터 */}
        <div className="flex justify-center gap-1.5 mb-6">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-8 bg-farm-green' : 'w-2 bg-gray-200'
              }`}
            />
          ))}
        </div>

        {/* 콘텐츠 */}
        <div className="text-center space-y-3 mb-8">
          <p className="text-6xl">{current.emoji}</p>
          <p className="text-xs text-gray-400 font-semibold">{current.hint}</p>
          <h2 className="text-xl font-black text-gray-800">{current.title}</h2>
          <p className="text-gray-500 text-sm leading-relaxed">{current.desc}</p>
        </div>

        {/* 버튼 */}
        <button
          onClick={next}
          className="w-full py-4 bg-farm-green text-white font-bold text-base rounded-2xl"
        >
          {isLast ? '시작하기 🌾' : '다음 →'}
        </button>

        {!isLast && (
          <button
            onClick={skip}
            className="w-full mt-3 py-2 text-gray-400 text-sm font-semibold"
          >
            건너뛰기
          </button>
        )}
      </div>
    </div>
  );
}
