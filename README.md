# techblog

보안 엔지니어 포트폴리오 겸 기술 블로그. AWS, Terraform, DevSecOps, AI Agent Security 실무 노트를 다룹니다.

- **배포 주소**: https://dsaedsae.github.io/techblog/
- **스택**: Astro 5 + MDX, Shiki, Mermaid, GitHub Pages

## 로컬 개발

```bash
npm install
npm run dev      # http://localhost:4321/techblog/
npm run build    # dist/ 에 정적 빌드
npm run preview  # 빌드 결과 미리보기
```

> Node 22.11 이하에서는 Astro 6이 동작하지 않아 Astro 5를 사용합니다.
> Node를 22.12 이상으로 올리면 `astro@^6` 으로 업그레이드할 수 있습니다.

## 글 쓰기

`src/content/blog/` 아래에 `.md` 또는 `.mdx` 파일을 추가합니다.

```yaml
---
title: '글 제목'
description: '목록과 OG 태그에 쓰이는 한 줄 요약'
date: 2026-06-10
category: aws # aws | terraform | devsecops | ai-agent-security | scripts
tags: [aws, iam]
series: aws-security-ops # 시리즈 소속 시 (선택, src/consts.ts의 SERIES에 정의)
seriesOrder: 2 # 시리즈 내 회차 (series 지정 시 필수)
draft: false # true면 빌드에서 제외 (선택)
---
```

새 시리즈를 만들려면 `src/consts.ts`의 `SERIES_IDS`와 `SERIES`에 항목을 추가합니다.

- 코드 블록 파일명 표시: ` ```hcl title="main.tf" `
- Mermaid 다이어그램: ` ```mermaid ` 코드 펜스 사용 (클라이언트에서 SVG로 렌더링)

## 배포

`main` 브랜치에 push하면 `.github/workflows/deploy.yml`이 빌드 후 GitHub Pages로 배포합니다.
저장소 Settings → Pages 의 Source가 **GitHub Actions**로 설정되어 있어야 합니다
(워크플로의 `configure-pages`가 최초 1회 자동 활성화를 시도합니다).
