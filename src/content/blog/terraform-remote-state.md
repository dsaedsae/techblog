---
title: 'Terraform 원격 상태 관리: S3 백엔드 구성의 모든 것'
description: 'S3 백엔드와 네이티브 잠금, 상태 마이그레이션, 환경 분리 전략까지 — 팀 단위 Terraform 상태 관리의 기본기를 정리했다.'
date: 2026-06-04
category: terraform
tags: [terraform, s3, state-management]
series: terraform-zero-to-prod
seriesOrder: 2
---

`terraform.tfstate`를 로컬에 두면 세 가지 문제가 생긴다. 팀원 간 상태
충돌, state에 포함된 비밀값의 평문 노출, 그리고 노트북과 함께 사라지는
인프라 이력. 원격 백엔드는 선택이 아니라 전제 조건이다.

## S3 백엔드 기본 구성

Terraform 1.10부터는 DynamoDB 테이블 없이 **S3 네이티브 잠금**
(`use_lockfile`)을 쓸 수 있다. 신규 구성이라면 이쪽이 표준이다.

```hcl title="backend.tf"
terraform {
  backend "s3" {
    bucket       = "my-terraform-state-bucket"
    key          = "prod/network/terraform.tfstate"
    region       = "ap-northeast-2"
    encrypt      = true
    use_lockfile = true # S3 조건부 쓰기 기반 잠금 (Terraform 1.10+)
  }
}
```

1.10 미만이거나 기존 구성을 유지한다면 DynamoDB 잠금을 쓴다.

```hcl
backend "s3" {
  # ...
  dynamodb_table = "terraform-locks" # LockID(String) 파티션 키 필요
}
```

## 상태 버킷 자체를 코드로

상태 버킷은 "닭이 먼저냐 달걀이 먼저냐" 문제가 있다. 별도 부트스트랩
디렉토리에서 로컬 state로 만들고, 이후 백엔드를 그 버킷으로 옮기는
패턴이 일반적이다.

```terraform title="bootstrap/state-bucket.tf"
resource "aws_s3_bucket" "tfstate" {
  bucket = "my-terraform-state-bucket"

  lifecycle {
    prevent_destroy = true # 상태 버킷 실수 삭제 방지
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  versioning_configuration {
    status = "Enabled" # 상태 손상 시 이전 버전으로 복구
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

버저닝은 필수다. `terraform apply` 도중 프로세스가 죽어 state가
손상되면 이전 버전 복구가 유일한 출구다.

## 보안 관점: state는 비밀값 저장소다

state 파일에는 RDS 비밀번호, 생성된 키, 인증서 프라이빗 키가 **평문**으로
들어간다. `sensitive = true`는 출력 마스킹일 뿐이다.

- 상태 버킷 접근을 IAM으로 최소화 — CI 역할과 인프라 팀만
- KMS CMK 암호화로 키 사용 이력까지 CloudTrail에 남기기
- 가능하면 비밀값이 state에 들어가지 않는 설계: RDS
  `manage_master_user_password`(Secrets Manager 위임), `ephemeral`
  리소스(Terraform 1.10+) 활용

## 기존 로컬 상태 마이그레이션

```bash
# backend.tf 추가 후
terraform init -migrate-state

# 백엔드 설정만 바꿨고 상태 복사가 필요 없다면
terraform init -reconfigure
```

`-migrate-state`는 기존 상태를 새 백엔드로 복사할지 물어본다. CI에서
실수로 빈 상태로 init하는 사고를 막으려면 백엔드 설정 변경은 반드시
로컬에서 마이그레이션을 완료한 뒤 커밋한다.

## 환경 분리: 디렉토리 vs 워크스페이스

| | 디렉토리 분리 | Workspace |
| --- | --- | --- |
| state 격리 | 완전 (key 자체가 다름) | 같은 백엔드 내 prefix |
| 환경별 코드 차이 | 자유로움 | 같은 코드 강제 |
| 실수 가능성 | 낮음 | `workspace select` 깜빡하면 prod에 apply |
| 권장 상황 | **prod/stg 분리 (기본값)** | 동일 구성의 임시 환경 |

환경 간 권한 경계까지 고려하면 디렉토리 분리 + 환경별 AWS 계정 분리가
정석이다. prod state 버킷에는 dev CI 역할이 아예 접근할 수 없어야 한다.

```text
environments/
├── prod/   # backend key: prod/terraform.tfstate
├── stg/    # backend key: stg/terraform.tfstate
└── dev/
modules/
└── ...     # 공통 모듈
```

## 자주 쓰는 state 명령

```bash
terraform state list                      # 관리 중인 리소스 목록
terraform state show aws_s3_bucket.logs  # 특정 리소스 상세
terraform state rm aws_s3_bucket.legacy  # 코드/상태 연결 해제 (리소스는 유지)
terraform plan -refresh-only              # drift 확인 (실제 변경 없음)
```

`state rm`과 `import`는 짝으로 기억해 두면 리소스를 파괴하지 않고
모듈 간 이동이나 리팩토링을 할 수 있다. Terraform 1.5+라면 CLI 대신
`moved`/`import` 블록을 쓰는 편이 plan에서 검증 가능해 더 안전하다.
