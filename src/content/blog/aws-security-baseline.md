---
title: 'AWS 신규 계정 보안 베이스라인: 첫 1시간에 해야 할 일'
description: '새 AWS 계정을 받았을 때 가장 먼저 적용해야 할 보안 설정을 우선순위와 CLI 명령으로 정리했다.'
date: 2026-06-02
category: aws
tags: [aws, iam, security-baseline, cloudtrail]
---

신규 계정은 기본 설정 그대로 두면 루트 사용자 노출, 퍼블릭 S3 버킷,
로깅 부재라는 세 가지 기본 위협에 그대로 노출된다. 계정을 받은 첫
1시간에 적용할 베이스라인을 우선순위 순서로 정리한다.

## 0순위: 루트 사용자 봉인

루트는 IAM 정책으로 제한할 수 없는 유일한 주체다. 따라서 "쓰지 않게"
만드는 것이 통제의 전부다.

- 하드웨어 또는 앱 기반 **MFA 활성화**
- **액세스 키 삭제** (루트의 프로그래밍 접근은 어떤 경우에도 불필요)
- 루트 이메일은 개인 메일이 아닌 팀 배포 리스트로 — 퇴사자 리스크 제거
- 일상 작업용 관리자는 별도 IAM Role/Identity Center로 생성

루트가 마지막으로 언제 쓰였는지는 자격 증명 보고서로 확인한다.

```bash
aws iam generate-credential-report
aws iam get-credential-report --query 'Content' --output text | base64 -d \
  | head -2 | cut -d, -f1,5,11 # 사용자, 비밀번호 마지막 사용, 키1 마지막 사용
```

## 1순위: CloudTrail — 무조건, 가장 먼저

사고가 났을 때 CloudTrail이 없으면 조사 자체가 불가능하다. 비용 우려로
미루는 경우가 있는데, 관리 이벤트 첫 사본은 무료다.

```bash
aws cloudtrail create-trail \
  --name org-trail \
  --s3-bucket-name my-cloudtrail-logs \
  --is-multi-region-trail \
  --enable-log-file-validation

aws cloudtrail start-logging --name org-trail
```

핵심 옵션 두 가지:

- `--is-multi-region-trail`: 공격자는 주로 안 쓰는 리전에서 움직인다
- `--enable-log-file-validation`: 로그 무결성 검증 — 로그 조작 탐지

로그 버킷은 가능하면 별도 계정에 두고, 운영 계정에서는 읽기만 가능하게
한다.

## 2순위: S3 계정 수준 퍼블릭 액세스 차단

버킷 단위가 아니라 **계정 수준**으로 차단한다. 이후 생성되는 모든
버킷에 자동 적용된다.

```bash
aws s3control put-public-access-block \
  --account-id 123456789012 \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

정적 웹 호스팅 등 의도적 퍼블릭이 필요하면 그 워크로드만 별도 계정으로
분리하는 것이 정석이다.

## 3순위: 탐지 서비스 활성화

```bash
# GuardDuty — 켜는 데 1분, 에이전트 불필요
aws guardduty create-detector --enable

# Security Hub + 기본 표준
aws securityhub enable-security-hub \
  --enable-default-standards
```

GuardDuty는 크리덴셜 유출 사용, 코인 마이닝, 비정상 API 호출을 ML로
탐지한다. Security Hub는 AWS Foundational Security Best Practices
기준으로 설정 상태를 지속 점검한다.

## 4순위: IAM 기본 정책

- 계정 비밀번호 정책 강화 (길이 14+, 재사용 금지)
- IAM User 생성 금지 원칙 — 사람은 Identity Center, 워크로드는 Role
- 불가피하게 만든 액세스 키는 [수명 감사 스크립트](/techblog/blog/scripts-iam-key-audit/)로 주기 점검

```bash
aws iam update-account-password-policy \
  --minimum-password-length 14 \
  --require-symbols --require-numbers \
  --require-uppercase-characters --require-lowercase-characters \
  --password-reuse-prevention 24
```

## 5순위: 청구 알림

보안 설정은 아니지만, 크리덴셜 유출의 가장 빠른 탐지 신호는 의외로
**비용 급증**이다. Budget 알림 하나가 GuardDuty보다 먼저 우는 경우가
실제로 있다.

```bash
aws budgets create-budget \
  --account-id 123456789012 \
  --budget '{"BudgetName":"monthly-guard","BudgetLimit":{"Amount":"50","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}' \
  --notifications-with-subscribers '[{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":80},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"security@example.com"}]}]'
```

## 체크리스트 요약

- [ ] 루트 MFA + 액세스 키 삭제
- [ ] CloudTrail 멀티 리전 + 로그 검증
- [ ] S3 계정 수준 퍼블릭 차단
- [ ] GuardDuty + Security Hub 활성화
- [ ] 비밀번호 정책 + IAM User 생성 금지 원칙
- [ ] 예산 알림

이 베이스라인을 Terraform 모듈로 코드화하면 계정이 늘어나도 동일한
기준을 보장할 수 있다. 다음 글에서 다룰 예정이다.
