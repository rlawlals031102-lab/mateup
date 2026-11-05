// 실시간 채팅 알림 (Supabase Realtime Broadcast).
//
// Vercel 서버 함수는 연결을 오래 붙잡고 있을 수 없어서, 실시간 연결은 Supabase Realtime이 맡는다.
//   - 메시지가 저장되면 서버가 그 매칭의 채널로 "새 메시지 있음" 신호만 보낸다. (내용은 보내지 않음)
//   - 채팅 화면은 그 채널을 듣고 있다가 신호가 오면 로그인된 API로 새 메시지를 가져온다.
//   - 채널 이름은 서버 비밀값으로 만든 HMAC이라 매칭 당사자 말고는 알 수 없다.
//     신호에 내용이 없으므로 채널 이름이 새도 대화 내용은 드러나지 않는다.
//
// 환경 변수: SUPABASE_URL, SUPABASE_ANON_KEY (Supabase 대시보드 → Project Settings → API)
//   설정이 없으면 null → 채팅은 예전처럼 3초마다 새 메시지를 확인한다.

import crypto from 'node:crypto';

export function createRealtime({ url, anonKey, secret } = {}) {
  if (!url || !anonKey || !secret) return null;
  const base = url.replace(/\/+$/, '');
  const topicFor = (matchId) => `chat-${crypto.createHmac('sha256', secret).update(`match:${matchId}`).digest('hex').slice(0, 32)}`;

  return {
    client: { url: base, anonKey }, // 화면에 알려 줄 공개 정보 (anon 키는 원래 공개용)
    topicFor,
    // 실패해도 메시지 저장에는 영향 없음 (화면은 15초마다 다시 확인한다)
    async publish(matchId) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      try {
        const res = await fetch(`${base}/realtime/v1/api/broadcast`, {
          method: 'POST',
          headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ topic: topicFor(matchId), event: 'new', payload: {} }] }),
          signal: ctrl.signal,
        });
        if (!res.ok) console.warn('실시간 알림 실패', res.status);
      } catch (err) {
        console.warn('실시간 알림 실패', err.message);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
