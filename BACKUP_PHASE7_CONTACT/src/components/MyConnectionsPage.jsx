import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Phone, MessageSquare, Loader2, Star } from 'lucide-react';
import { getMyContacts, getMessages, sendMessage } from '../utils/api.js';
import ReviewModal from './ReviewModal.jsx';

const CATEGORY_EMOJI = {
  '밭갈이': '🚜', '로터리': '🔄', '두둑': '⛰️',
  '방제': '💊', '수확 일손': '🌾', '예초': '✂️',
};

const JOB_STATUS_LABEL = {
  open:        { label: '모집중',   cls: 'bg-green-50  text-green-700' },
  matched:     { label: '매칭완료', cls: 'bg-blue-50   text-blue-700'  },
  in_progress: { label: '진행중',   cls: 'bg-amber-50  text-amber-700' },
  done:        { label: '완료',     cls: 'bg-gray-100  text-gray-600'  },
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
  const [contacts,  setContacts]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [chatJobId, setChatJobId] = useState(null);
  const [reviewJob, setReviewJob] = useState(null);
  const [toast,     setToast]     = useState('');

  useEffect(() => {
    getMyContacts()
      .then(r => setContacts(r.contacts || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2500); }

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
          const isDone = c.jobStatus === 'done';

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
                  {/* 리뷰 작성 (완료 + 농민 역할만) */}
                  {isDone && c.myRole === 'farmer' && (
                    <button
                      onClick={() => setReviewJob({ id: c.jobId, category: c.category, locationText: c.locationText, date: c.date })}
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

      {/* 리뷰 모달 */}
      {reviewJob && (
        <ReviewModal
          job={reviewJob}
          onClose={() => setReviewJob(null)}
          onSubmit={() => {
            showToast('후기가 등록되었어요!');
            getMyContacts().then(r => setContacts(r.contacts || []));
          }}
        />
      )}
    </div>
  );
}
