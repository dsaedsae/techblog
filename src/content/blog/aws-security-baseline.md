---
title: 'AWS 신규 계정 보안 베이스라인 체크리스트'
description: '새 AWS 계정을 받았을 때 가장 먼저 적용해야 할 보안 설정을 정리한 placeholder 글입니다.'
date: 2026-06-02
category: aws
tags: [aws, iam, security-baseline]
---

> 이 글은 frontmatter 형식 예시용 placeholder입니다. 실제 내용으로 교체하세요.

## 왜 베이스라인이 필요한가

신규 계정은 기본 설정 그대로 두면 루트 사용자 노출, 퍼블릭 S3 버킷 등
기본적인 위협에 그대로 노출됩니다. 계정을 받자마자 적용할 최소한의
베이스라인을 코드로 관리하는 것이 시작점입니다.

## 체크리스트

- 루트 사용자 MFA 활성화, 액세스 키 삭제
- CloudTrail 전 리전 활성화
- S3 계정 수준 퍼블릭 액세스 차단
- GuardDuty / Security Hub 활성화

## CLI 예시

```bash
# 계정 수준 S3 퍼블릭 액세스 차단
aws s3control put-public-access-block \
  --account-id 123456789012 \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

```yaml title="securityhub-standards.yml"
# Security Hub 표준 활성화 예시 (placeholder)
standards:
  - arn: arn:aws:securityhub:::ruleset/cis-aws-foundations-benchmark/v/1.2.0
    enabled: true
  - arn: arn:aws:securityhub:ap-northeast-2::standards/aws-foundational-security-best-practices/v/1.0.0
    enabled: true
```

## 마무리

다음 글에서는 이 베이스라인을 Terraform 모듈로 만드는 과정을 다룹니다.
