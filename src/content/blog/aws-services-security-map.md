---
title: '보안 엔지니어 관점의 AWS 핵심 서비스 지도'
description: 'IAM부터 GuardDuty까지 — AWS 보안 서비스들이 각각 어떤 질문에 답하는 도구인지, 어떤 순서로 켜야 하는지를 한 장의 지도로 정리했다.'
date: 2026-06-10
category: aws
tags: [aws, security, iam, guardduty, cloudtrail]
---

AWS 보안 서비스는 종류가 많아서 "뭘 켜야 하지?"보다 "이 서비스가 어떤
질문에 답하는 도구인지"를 먼저 정리하는 편이 빠르다. 이 글은 각 서비스를
**답하는 질문** 기준으로 분류한 지도다.

## 전체 지도

| 질문 | 서비스 |
| --- | --- |
| 누가 무엇을 할 수 있는가 | IAM, Organizations(SCP), IAM Identity Center |
| 트래픽이 어디로 흐를 수 있는가 | VPC, Security Group, NACL, VPC Endpoint |
| 누가 무엇을 했는가 | CloudTrail, CloudWatch Logs, VPC Flow Logs |
| 지금 위협이 발생하고 있는가 | GuardDuty, Inspector, Detective |
| 설정이 기준을 지키고 있는가 | Security Hub, Config |
| 데이터가 보호되고 있는가 | KMS, Secrets Manager, S3 Block Public Access |

## 1. 자격과 권한: IAM, SCP, Identity Center

**IAM**은 모든 것의 시작점이다. 실무에서 핵심은 세 가지다.

- **역할(Role) 우선**: 장기 자격 증명(액세스 키) 대신 임시 자격 증명을
  쓴다. EC2에는 인스턴스 프로파일, CI에는 OIDC 연동(GitHub Actions의
  `id-token: write`)을 쓰면 키 유출 자체가 불가능해진다.
- **정책 평가 순서**: 명시적 Deny > SCP 경계 > Permission Boundary >
  Identity/Resource Policy의 Allow. "Allow를 줬는데 안 되는" 상황의
  원인은 대부분 상위 경계(SCP, Boundary)에 있다.
- **Condition 활용**: `aws:SourceIp`, `aws:PrincipalOrgID`,
  `aws:SecureTransport` 같은 조건 키로 Allow의 범위를 좁힌다.

```json title="deny-non-tls.json"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": ["arn:aws:s3:::my-bucket", "arn:aws:s3:::my-bucket/*"],
      "Condition": { "Bool": { "aws:SecureTransport": "false" } }
    }
  ]
}
```

**Organizations + SCP**는 "계정 안의 누구도 못 하게" 만드는 유일한
수단이다. 멤버 계정의 루트 사용자조차 SCP를 넘을 수 없다. CloudTrail
비활성화 금지, 특정 리전 차단 같은 가드레일은 SCP로 건다.

**IAM Identity Center**(구 SSO)는 사람 계정의 표준이다. IAM User를 만들어
콘솔 로그인을 시키는 패턴은 더 이상 권장되지 않는다.

## 2. 네트워크 경계: VPC, SG, NACL, Endpoint

| 항목 | Security Group | NACL |
| --- | --- | --- |
| 적용 대상 | ENI(인스턴스) | 서브넷 |
| 상태 | Stateful — 응답 자동 허용 | Stateless — 양방향 규칙 필요 |
| 규칙 | Allow만 가능 | Allow/Deny 모두 |
| 실무 용도 | 기본 통제 수단 | 특정 IP 차단 등 보조 |

설계 원칙은 단순하다: **퍼블릭 서브넷에는 진입점(ALB, NAT)만 둔다.**
애플리케이션과 DB는 프라이빗 서브넷에 두고, SG 참조 체이닝(ALB SG →
App SG → DB SG)으로 트래픽 경로를 좁힌다.

**VPC Endpoint**는 보안 관점에서 두 가지 가치가 있다.

1. S3·DynamoDB(Gateway), 기타 서비스(Interface)에 인터넷을 거치지 않고
   접근 — NAT 비용 절감 + 노출면 축소
2. **Endpoint Policy**로 "이 VPC에서는 우리 조직 버킷에만 접근 가능"
   같은 데이터 유출 통제 지점 확보

관리 접근은 Bastion보다 **SSM Session Manager**가 우선이다. 인바운드
포트 0개, 접속 기록은 CloudTrail/S3에 남고, IAM으로 접근을 통제한다.

```bash
# SSH 키도, 22번 포트도 없이 셸 접속
aws ssm start-session --target i-0123456789abcdef0
```

## 3. 가시성: CloudTrail, CloudWatch, Flow Logs

**CloudTrail**은 협상 불가능한 1순위다. 모든 보안 사고 분석의 출발점이
"CloudTrail에 뭐가 남았는가"다.

- Organization Trail로 전 계정·전 리전 한 번에 수집
- 로그 버킷은 별도 보안 계정에 두고 MFA Delete 또는 S3 Object Lock 적용
- 관리 이벤트는 기본, S3 데이터 이벤트는 민감 버킷에 선별 적용(비용)

**CloudWatch Logs Insights**는 조사 도구다. WAF 검증 프로젝트에서 차단
로그를 분석할 때 썼던 패턴:

```sql title="waf-blocked-requests.query"
fields @timestamp, httpRequest.clientIp, httpRequest.uri, terminatingRuleId
| filter action = "BLOCK"
| stats count(*) as blocked by httpRequest.clientIp, terminatingRuleId
| sort blocked desc
| limit 20
```

**VPC Flow Logs**는 "이 인스턴스가 어디로 통신했는가"에 답한다. 침해
조사 시 C2 통신 흔적, 내부 횡적 이동 추적에 필수다. REJECT만 수집해도
이상 징후 탐지에는 충분한 경우가 많다.

## 4. 위협 탐지: GuardDuty, Inspector, Detective

세 서비스는 역할이 다르다. 혼동하기 쉬운데 이렇게 구분한다.

- **GuardDuty** — "지금 공격받고 있는가?" CloudTrail·DNS·Flow Logs를
  ML로 분석해 크리덴셜 유출 사용, 코인 마이닝, C2 통신 등을 탐지.
  켜는 데 1분, 에이전트 불필요. **모든 계정에서 무조건 켠다.**
- **Inspector** — "공격받을 구멍이 있는가?" EC2·ECR 이미지·Lambda의
  CVE와 네트워크 노출을 지속 스캔. 취약점 관리 도구.
- **Detective** — "이 알림의 전후 맥락은?" GuardDuty 탐지 결과를
  그래프로 연결해 조사를 돕는다. 규모가 커지면 도입.

GuardDuty 탐지 결과는 EventBridge로 받아 자동 대응으로 연결한다.

```yaml title="guardduty-eventbridge.yml"
# 높은 심각도 탐지를 Slack/SNS로 라우팅하는 EventBridge 규칙 패턴
detail-type:
  - GuardDuty Finding
detail:
  severity:
    - numeric: ['>=', 7]
```

## 5. 자세 관리: Security Hub, Config

**Config**는 리소스 구성의 타임머신이다. "이 SG가 언제부터 0.0.0.0/0을
열었는가"에 답한다. Config Rule로 기준 위반을 지속 평가한다.

**Security Hub**는 CSPM 콘솔이다. AWS Foundational Security Best
Practices, CIS Benchmark 같은 표준을 켜면 Config 기반으로 자동
점검되고, GuardDuty·Inspector 결과까지 한 화면에 모인다. 멀티 계정
환경에서는 위임 관리자 계정으로 중앙 집계한다.

도입 순서는 명확하다: **CloudTrail → GuardDuty → Security Hub(+Config)**.
이 셋이 탐지·가시성의 최소 기준선이다.

## 6. 데이터 보호: KMS, Secrets Manager, S3

**KMS** 실무 포인트:

- 기본 AWS 관리형 키(`aws/s3`)보다 **고객 관리형 키(CMK)** — Key
  Policy로 사용 주체를 통제할 수 있고, 키 비활성화로 데이터 접근을
  일괄 차단하는 비상 스위치가 생긴다.
- Key Policy의 `kms:ViaService`, `kms:EncryptionContext` 조건으로 키
  사용 경로를 제한한다.

**Secrets Manager vs SSM Parameter Store**:

| | Secrets Manager | Parameter Store |
| --- | --- | --- |
| 자동 로테이션 | 내장 (RDS 등) | 직접 구현 |
| 비용 | 시크릿당 과금 | Standard 무료 |
| 용도 | DB 자격 증명, API 키 | 설정값, 가벼운 시크릿 |

**S3**는 계정 수준 **Block Public Access**를 켜는 것이 시작이다. 버킷
정책으로 `aws:SecureTransport` 강제, 민감 버킷은 KMS 암호화 + 버킷 키
활성화(비용 절감)까지가 기본 세트다.

## 마무리: 신규 환경 적용 순서

1. **계정 구조**: Organizations + SCP 가드레일, Identity Center
2. **가시성**: Organization CloudTrail, 로그 전용 계정
3. **탐지**: GuardDuty 전 계정·전 리전, Security Hub 표준 활성화
4. **네트워크**: 퍼블릭/프라이빗 분리, SSM Session Manager, VPC Endpoint
5. **데이터**: 계정 수준 S3 BPA, CMK 전환, Secrets Manager

네트워크 영역(4번)의 실제 구현은
[Terraform으로 구축하는 프로덕션 VPC](/techblog/blog/terraform-vpc-complete-guide/)에서
서브넷 설계부터 SG 체인, VPC Endpoint까지 동작하는 코드로 다룬다.
