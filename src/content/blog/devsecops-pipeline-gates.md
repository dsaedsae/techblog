---
title: 'CI 파이프라인 보안 게이트 설계: 도구 나열이 아니라 증적 흐름'
description: 'SAST·시크릿 스캔·이미지 스캔을 어디에 배치할지, 그리고 "어떤 이미지가 어떤 검사를 거쳐 배포됐는가"를 추적 가능하게 만드는 설계를 정리했다.'
date: 2026-06-06
category: devsecops
tags: [devsecops, github-actions, sast, gitops]
---

DevSecOps 프로젝트를 하면서 가장 크게 배운 것은, 보안 도구를 많이
붙이는 것과 보안 검증이 되는 것은 다르다는 점이다. 도구를 나열한
파이프라인은 "Trivy를 돌렸다"까지만 말할 수 있다. 정작 필요한 질문 —
**"어떤 이미지가 어떤 검사를 거쳐 어디에 배포됐고, 어떤 증적을
남겼는가"** — 에는 답하지 못한다.

## 게이트 배치의 원칙

빠른 검사는 앞에, 느린 검사는 뒤에. 개발 속도를 죽이는 게이트는 결국
우회된다.

| 단계 | 검사 | 소요 | 실패 시 |
| --- | --- | --- | --- |
| pre-commit | 시크릿 스캔 (gitleaks) | 초 단위 | 커밋 차단 |
| PR | SAST, IaC 스캔, 의존성 검사 | 분 단위 | 머지 차단 |
| 빌드 | 이미지 스캔, SBOM 생성 | 분 단위 | 푸시 차단 |
| 배포 후 | DAST, 런타임 점검 | 시간 단위 | 알림 + 티켓 |

핵심은 **차단 게이트와 알림 게이트를 구분**하는 것이다. 모든 검사를
차단으로 걸면 첫 주에 오탐으로 파이프라인이 마비되고, 둘째 주에 누군가
`--no-verify`를 찾아낸다.

## PR 단계 워크플로 예시

```yaml title=".github/workflows/security.yml"
name: security-gates

on:
  pull_request:
    branches: [main]

permissions:
  contents: read
  security-events: write

jobs:
  secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # 커밋 이력 전체 스캔

      - name: Secret scan
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  sast:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Semgrep
        run: |
          pip install semgrep
          semgrep ci --config auto

  iac:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: IaC scan
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: config
          exit-code: '1'
          severity: HIGH,CRITICAL # 차단 기준은 High 이상만
```

`severity: HIGH,CRITICAL` 같은 차단 기준 명시가 중요하다. "모든 발견
사항 차단"은 지속 불가능하고, 기준 없는 예외 처리는 게이트를 형해화한다.

## 증적 체인: 검사한 것과 배포된 것이 같은가

파이프라인이 분리되어 있으면(CI는 Jenkins, 배포는 ArgoCD) 흔히 생기는
구멍이 있다. CI에서 스캔한 이미지와 실제 클러스터에 배포된 이미지가
같다는 보장이 없는 것이다. `latest` 태그를 쓰는 순간 추적은 불가능해진다.

내가 참여한 프로젝트에서는 이렇게 고정했다.

1. **이미지 태그 = 커밋 SHA** — 빌드 산출물과 소스가 1:1로 묶임
2. CI는 빌드·스캔·푸시·**GitOps 리포지토리 값 갱신**까지만 수행
3. 배포는 ArgoCD가 GitOps 리포지토리 기준 상태를 따라 수행
4. 스캔 리포트는 `{이미지 태그}/{검사 종류}` 경로로 저장

이러면 클러스터의 모든 워크로드에 대해 "이 이미지는 이 커밋에서
빌드됐고, 이 스캔을 통과했다"를 역추적할 수 있다.

```text
GitHub ──> Jenkins ──> Harbor ──> GitOps Repo ──> ArgoCD ──> K8s
  코드      빌드+스캔    이미지      태그 갱신       동기화      배포
            └─ 리포트 저장 (커밋 SHA 기준)
```

## SAST의 한계를 전제로 설계하기

같은 프로젝트의 PoC에서 의도적으로 심은 취약점 4개 중 정적 분석이 잡은
것은 1개뿐이었다. 나머지 3개는 비즈니스 로직과 권한 검증 흐름의
문제였다 — IDOR, 인가 누락 같은 것들은 코드 패턴만으로 잡히지 않는다.

그래서 게이트 설계의 결론은:

- SAST/이미지 스캔은 **알려진 패턴의 하한선** 확보용
- 인증·인가·비즈니스 로직은 배포 후 DAST와 수동 점검의 영역
- 두 영역의 결과가 같은 증적 체계(빌드·이미지 기준)에 묶여야 함

## 오탐 관리 정책

게이트는 추가하는 것보다 유지하는 것이 어렵다. 최소한 이 세 가지는
정해두고 시작해야 한다.

- **예외 등록 절차**: 인라인 suppress 주석은 리뷰 필수 + 사유 기록
- **예외 만료일**: 무기한 예외 금지, 90일 후 재평가
- **기준선(baseline)**: 기존 코드의 발견 사항은 베이스라인으로 동결하고
  신규 코드만 차단 — 도입 첫날 빌드 전면 차단을 피하는 유일한 방법
