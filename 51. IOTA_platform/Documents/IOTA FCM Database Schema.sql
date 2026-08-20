-- 1. 기기별 푸시 알림 토큰(FCM Token)을 저장하는 테이블
CREATE TABLE IF NOT EXISTS public.fcm_tokens (
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    fcm_token text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    PRIMARY KEY (user_id, fcm_token)
);

-- RLS (Row Level Security) 활성화
ALTER TABLE public.fcm_tokens ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 토큰만 조회, 삽입, 업데이트, 삭제 가능
CREATE POLICY "Users can manage their own fcm_tokens"
ON public.fcm_tokens
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 2. 앱 내 알림(Notification) 히스토리를 저장하는 테이블
CREATE TABLE IF NOT EXISTS public.iota_notifications (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title text NOT NULL,
    body text NOT NULL,
    type text, -- e.g., 'new_post', 'new_comment'
    reference_id uuid, -- 관련된 게시글 또는 댓글의 ID
    is_read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);

-- RLS (Row Level Security) 활성화
ALTER TABLE public.iota_notifications ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 알림만 조회, 업데이트(읽음 처리) 가능 (삽입은 Edge Function/Service Role만 가능하도록 제한)
CREATE POLICY "Users can view and update their own notifications"
ON public.iota_notifications
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications"
ON public.iota_notifications
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 알림을 보내는 트리거나 서비스 롤 정책은 추가적으로 필요할 수 있습니다.
