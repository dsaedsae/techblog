---
title: 'CI 파이프라인에 보안 게이트 넣기: 어디에 무엇을 둘 것인가'
description: 'GitHub Actions 파이프라인에 SAST, 시크릿 스캔, IaC 스캔 게이트를 배치하는 기준을 정리한 placeholder 글입니다.'
date: 2026-06-06
category: devsecops
tags: [devsecops, github-actions, sast]
---

> 이 글은 frontmatter 형식 예시용 placeholder입니다. 실제 내용으로 교체하세요.

## 게이트 배치의 원칙

빠르게 끝나는 검사는 PR 단계에, 오래 걸리는 검사는 머지 후 비동기로.
개발 속도를 죽이는 게이트는 결국 우회됩니다.

| 단계 | 검사 | 실패 시 |
| ---- | ---- | ------- |
| pre-commit | 시크릿 스캔 | 커밋 차단 |
| PR | SAST, IaC 스캔 | 머지 차단 |
| post-merge | DAST, 의존성 전수 검사 | 알림 |

## 예시 워크플로

```yaml title=".github/workflows/security.yml"
name: security-gates

on:
  pull_request:
    branches: [main]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Secret scan
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: IaC scan
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: config
          exit-code: '1'
```

## 마무리

게이트는 추가하는 것보다 유지하는 것이 어렵습니다. 오탐 관리 정책을
함께 설계해야 합니다.
