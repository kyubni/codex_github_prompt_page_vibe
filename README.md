# 프롬프트 라이브러리

GitHub Pages에서 동작하는 정적 프롬프트 라이브러리입니다. Supabase를 설정하면 로그인한 사용자별로 프롬프트 그룹을 백엔드에 저장합니다.

## Supabase 설정

1. Supabase 프로젝트를 만들고 SQL Editor에서 `supabase-schema.sql` 내용을 실행합니다.
2. Authentication 설정에서 Email provider를 켭니다.
3. Authentication URL Configuration에 GitHub Pages URL을 Site URL과 Redirect URL로 등록합니다.
4. Project Settings > API에서 Project URL과 publishable/anon public key를 복사합니다.
5. 로컬에서 바로 열어 테스트하려면 `supabase-config.js`에 값을 넣습니다.

```js
window.PROMPT_LIBRARY_SUPABASE = {
  url: "https://YOUR_PROJECT.supabase.co",
  publishableKey: "YOUR_PUBLIC_KEY",
};
```

## GitHub Pages 배포

GitHub Actions로 배포하려면 저장소 Settings > Secrets and variables > Actions에 아래 secrets를 추가합니다.

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

그다음 Settings > Pages에서 Source를 GitHub Actions로 설정하고 `main` 브랜치에 push하면 `.github/workflows/pages.yml`이 `supabase-config.js`를 secrets 값으로 생성해 배포합니다.

수동 배포를 쓰려면 저장소 루트에 있는 `index.html`, `styles.css`, `app.js`, `supabase-config.js`를 GitHub Pages source로 배포하면 됩니다.

Supabase 키는 브라우저에 공개되는 키입니다. 보안은 `supabase-schema.sql`의 Row Level Security 정책으로 처리합니다.
