import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Phone, MessageSquare, Loader2, Star, Play, CheckSquare } from 'lucide-react';
import { getMyContacts, getMessages, sendMessage, startJob, completeJob } from '../utils/api.js';
import ReviewModal from './ReviewModal.jsx';

const CATEGORY_EMOJI = {
  '밭갈이': '🚜', '로터리': '🔄', '두둑': '⛰️',
  '방제': '💊', '수확 일손': '🌾', '예초': '✂️',
};

const JOB_STATUS_LABEL = {
  open:        { label: '모집중',   cls: 'bg-green-50  text-green-700' },
  matched:     { label: '매칭완료', cls: 'bg-blue-50   text-blue-700'  },
  in_progress: { label: '진행중',   cls: 'bg-amber-50  text-amber-700' },
  completed:   { label: '완료',     cls: 'bg-gray-100  text-gray-600'  },
  closed:      { label: '마감',     cls: 'bg-red-50    text-red-600'   },
};

/** 폴링 채팅 패널 */
function ChatPanel({ jobId, userId, onClose }) {
  const [msgs,    setMsgs]    = useState([]);
  const [input,   setInput]   = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try { const r = await getMessages(jobId); setMsgs(r.messages || []); } catch (_) {}
  }, [jobId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function handleSend() {
    if (!input.trim() || sending) return;
    setSending(true);
    try { await sendMessage(jobId, input.trim()); setInput(''); await load(); }
    catch (_) {} finally { setSending(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex flex-col justify-end">
      <div className="bg-white rounded-t-3xl flex flex-col" style={{ maxHeight: '70vh' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <p className="font-bold text-gray-800">메시지</p>
          <button onClick={onClose} className="text-gray-400 text-2xl font-light">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {msgs.length === 0 && (
            <p className="text-center text-gray-400 text-sm py-6">첫 메시지를 보내보세요</p>
          )}
          {msgs.map(m => {
            const isMine = m.senderId === userId;
            return (
              <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${
                  isMine ? 'bg-farm-green text-white rounded-br-sm' : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                }`}>{m.text}</div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-gray-100">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="메시지 입력..."
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm
                       focus:outline-none focus:border-farm-green"
          />
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="px-4 py-2.5 bg-farm-green text-white rounded-xl text-sm font-bold disabled:opacity-50"
          >전송</button>
        </div>
      </div>
    </div>
  );
}

/**
 * MyConnectionsPage — 내 연결 이력 (상태 + 리뷰 포함)
 */
export default function MyConnectionsPage({ userId, onBack }) {
  const [contacts,        setContacts]        = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [chatJobId,       setChatJobId]       = useState(null);
  const [reviewJob,       setReviewJob]       = useState(null);
  const [toast,           setToast]           = useState('');
  const [acting,          setActing]          = useState(null);          // PHASE 30
  const [reviewIncentive, setReviewIncentive] = useState(false);         // PHASE 31: 인센티브 배너

  function reload() {
    return getMyContacts()
      .then(r => { setContacts(r.contacts || []); return r.contacts || []; })
      .catch(() => []);
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2500); }

  // PHASE 30: 작업 시작
  async function handleStart(jobId) {
    setActing(jobId);
    try {
      await startJob(jobId, userId);
      showToast('✅ 작업이 시작됐어요!');
      await reload();
    } catch (e) {
      showToast('오류: ' + e.message);
    } finally {
      setActing(null);
    }
  }

  // PHASE 30-31: 작업 완료 → 인센티브와 함께 후기 모달 자동 오픈
  async function handleComplete(jobId) {
    setActing(jobId);
    try {
      await completeJob(jobId, userId);
      const updated = await reload();

      // 완료된 contact 찾아서 후기 모달 자동 오픈
      const c = updated.find(c => c.jobId === jobId);
      if (c) {
        setReviewIncentive(true); // 인센티브 배너 표시
        setReviewJob({
          id:           c.jobId,
          category:     c.category,
          locationText: c.locationText,
          date:         c.date,
          targetId:     c.myRole === 'farmer' ? c.workerId : (c.requesterId || c.farmerId),
          myRole:       c.myRole,
        });
      } else {
        showToast('🎉 작업 완료! 후기를 남겨보세요.');
      }
    } catch (e) {
      showToast('오류: ' + e.message);
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="min-h-screen bg-farm-bg pb-8">
      <header className="bg-white px-4 pt-safe pt-4 pb-4 border-b border-gray-100 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1 text-gray-600">
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-lg font-bold text-gray-800">내 연결</h1>
          <span className="ml-auto text-sm text-gray-400">{contacts.length}건</span>
        </div>
      </header>

      {/* 토스트 */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white
                        rounded-full px-5 py-2.5 text-sm font-bold shadow-lg">
          {toast}
        </div>
      )}

      <div className="px-4 py-4 space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 size={28} className="animate-spin mr-2" /><span>불러오는 중...</span>
          </div>
        )}

        {!loading && contacts.length === 0 && (
          <div className="card text-center py-14">
            <p className="text-4xl mb-3">🤝</p>
            <p className="font-semibold text-gray-500">아직 연결된 작업이 없어요</p>
            <p className="text-sm text-gray-400 mt-1">작업이 매칭되면 여기에 나타나요</p>
          </div>
        )}

        {contacts.map(c => {
          const statusInfo = JOB_STATUS_LABEL[c.jobStatus] || JOB_STATUS_LABEL.matched;
          const isDone    = c.jobStatus === 'completed';
          // PHASE 31: 작업자도 후기 가능 (완료 상태)
          const canReview = isDone;

          return (
            <div key={c.id} className="card space-y-3">
              {/* 카테고리 + 상태 */}
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-800">
                  {CATEGORY_EMOJI[c.category] || '🌿'} {c.category}
                </span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusInfo.cls}`}>
                    {statusInfo.label}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    c.myRole === 'farmer'
                      ? 'bg-blue-50 text-blue-600'
                      : 'bg-amber-50 text-amber-700'
                  }`}>
                    {c.myRole === 'farmer' ? '내가 맡긴' : '내가 한'}
                  </span>
                </div>
              </div>

              <p className="text-sm text-gray-500">{c.locationText} · {c.date}</p>

              {/* 상대방 정보 + 액션 버튼 */}
              <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                <div>
                  <p className="text-xs text-gray-400">
                    {c.myRole === 'farmer' ? '작업자' : '농민'}
                  </p>
                  <p className="font-semibold text-gray-800">{c.partnerName || '—'}</p>
                </div>
                <div className="flex gap-2 flex-wrap justify-end">
                  {/* PHASE 30: 작업 시작 — matched + 농민만 */}
                  {c.jobStatus === 'matched' && c.myRole === 'farmer' && (
                    <button
                      onClick={() => handleStart(c.jobId)}
                      disabled={acting === c.jobId}
                      className="flex items-center gap-1 px-3 py-2 bg-blue-500 text-white
                                 rounded-xl text-sm font-bold disabled:opacity-50"
                    >
                      {acting === c.jobId
                        ? <Loader2 size={13} className="animate-spin" />
                        : <Play size={13} />} 작업 시작
                    </button>
                  )}
                  {/* PHASE 30: 작업 완료 — in_progress + 농민만 */}
                  {c.jobStatus === 'in_progress' && c.myRole === 'farmer' && (
                    <button
                      onClick={() => handleComplete(c.jobId)}
                      disabled={acting === c.jobId}
                      className="flex items-center gap-1 px-3 py-2 bg-farm-green text-white
                                 rounded-xl text-sm font-bold disabled:opacity-50"
                    >
                      {acting === c.jobId
                        ? <Loader2 size={13} className="animate-spin" />
                        : <CheckSquare size={13} />} 작업 완료
                    </button>
                  )}
                  {/* 전화 */}
                  {c.partnerPhone && (
                    <a
                      href={`tel:${c.partnerPhone}`}
                      className="flex items-center gap-1 px-3 py-2 bg-farm-green text-white
                                 rounded-xl text-sm font-bold"
                    >
                      <Phone size={13} /> 전화
                    </a>
                  )}
                  {/* 메시지 */}
                  <button
                    onClick={() => setChatJobId(c.jobId)}
                    className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-700
                               rounded-xl text-sm font-bold"
                  >
                    <MessageSquare size={13} /> 메시지
                  </button>
                  {/* PHASE 31: 후기 (완료 — 농민 + 작업자 모두) */}
                  {canReview && (
                    <button
                      onClick={() => setReviewJob({
                        id:           c.jobId,
                        category:     c.category,
                        locationText: c.locationText,
                        date:         c.date,
                        targetId:     c.myRole === 'farmer' ? c.workerId : (c.requesterId || c.farmerId),
                        myRole:       c.myRole,
                      })}
                      className="flex items-center gap-1 px-3 py-2 bg-amber-400 text-white
                                 rounded-xl text-sm font-bold"
                    >
                      <Star size={13} /> 후기
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 채팅 패널 */}
      {chatJobId && (
        <ChatPanel jobId={chatJobId} userId={userId} onClose={() => setChatJobId(null)} />
      )}

      {/* 리뷰 모달 — 완료 직후 자동 오픈 시 인센티브 배너 포함 */}
      {reviewJob && (
        <ReviewModal
          job={reviewJob}
          reviewerRole={reviewJob.myRole || 'worker'}
          reviewerId={userId}
          targetId={reviewJob.targetId}
          showIncentive={reviewIncentive}
          onClose={() => { setReviewJob(null); setReviewIncentive(false); }}
          onSubmit={() => {
            setReviewIncentive(false);
            showToast('⭐ 후기가 등록됐어요! 다음 매칭에서 우선 추천됩니다.');
            reload();
          }}
        />
      )}
    </div>
  );
}
