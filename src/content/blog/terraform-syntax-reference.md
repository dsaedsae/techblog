---
title: 'Terraform 핵심 문법 총정리: 실무에서 매번 찾아보는 것들'
description: '변수·표현식·count vs for_each·dynamic 블록·lifecycle·함수·moved 블록까지, Terraform 코드를 쓸 때 매번 검색하게 되는 문법을 한 페이지에 정리했다.'
date: 2026-06-10
category: terraform
tags: [terraform, hcl, iac, reference]
---

Terraform을 쓰다 보면 같은 문법을 반복해서 검색하게 된다. 이 글은 그
검색을 줄이기 위한 레퍼런스다. Terraform 1.5+ 기준이며, 예시는 모두
실제로 동작하는 형태로 작성했다.

## 기본 블록 구조

HCL은 `블록 타입 "라벨" { ... }` 구조다. 모든 Terraform 코드는 이 패턴의
조합이다.

```hcl title="main.tf"
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0" # 5.x 범위 내에서만 업데이트
    }
  }
}

provider "aws" {
  region = "ap-northeast-2"

  default_tags {
    tags = {
      Project   = "techblog"
      ManagedBy = "terraform"
    }
  }
}

# resource "리소스타입" "로컬이름"
resource "aws_s3_bucket" "logs" {
  bucket = "my-service-logs"
}

# data 소스: 이미 존재하는 리소스 조회
data "aws_caller_identity" "current" {}
```

버전 제약 연산자는 세 가지만 기억하면 된다.

| 연산자 | 의미 | 예시 |
| --- | --- | --- |
| `= 5.1.0` | 정확히 이 버전 | 재현성이 최우선일 때 |
| `~> 5.1` | 5.1 이상 6.0 미만 | 마이너 업데이트 허용 |
| `>= 1.5.0` | 이상 | required_version에 주로 사용 |

## 변수: 타입, 검증, 민감값

```hcl title="variables.tf"
variable "environment" {
  description = "배포 환경"
  type        = string

  validation {
    condition     = contains(["dev", "stg", "prod"], var.environment)
    error_message = "environment는 dev, stg, prod 중 하나여야 합니다."
  }
}

variable "allowed_cidrs" {
  description = "접근 허용 CIDR 목록"
  type        = list(string)
  default     = []
}

variable "db_password" {
  description = "RDS 마스터 비밀번호"
  type        = string
  sensitive   = true # plan 출력에서 마스킹. 단, state에는 평문 저장됨에 주의
}

variable "subnets" {
  description = "서브넷 구성"
  type = map(object({
    cidr = string
    az   = string
  }))
}
```

`sensitive = true`는 출력 마스킹일 뿐 **state 파일에는 평문으로
저장된다**. 비밀값은 가능하면 Terraform 밖(Secrets Manager, SSM
Parameter Store)에서 주입하는 구조로 설계하는 편이 안전하다.

변수 주입 우선순위(아래로 갈수록 우선):

1. 환경 변수 `TF_VAR_environment=prod`
2. `terraform.tfvars` / `*.auto.tfvars`
3. CLI `-var` / `-var-file`

## locals와 output

```hcl title="locals.tf"
locals {
  name_prefix = "${var.project}-${var.environment}"

  common_tags = {
    Environment = var.environment
    Owner       = "security-team"
  }

  # 조건에 따라 값 결정
  instance_type = var.environment == "prod" ? "m7i.large" : "t3.small"
}

output "alb_dns_name" {
  description = "ALB 접속 주소"
  value       = aws_lb.main.dns_name
}

output "db_endpoint" {
  value     = aws_db_instance.main.endpoint
  sensitive = true # output에도 sensitive 지정 가능
}
```

## count vs for_each

가장 자주 틀리는 부분. **count는 리스트 순서에, for_each는 키에
바인딩된다.** count로 만든 리소스는 중간 요소를 제거하면 그 뒤의 모든
리소스가 재생성된다.

```hcl
# ❌ count: ["a", "b", "c"]에서 "b"를 빼면 "c"가 파괴 후 재생성됨
resource "aws_iam_user" "bad" {
  count = length(var.user_names)
  name  = var.user_names[count.index]
}

# ✅ for_each: 키 단위로 추적되어 "b"만 제거됨
resource "aws_iam_user" "good" {
  for_each = toset(var.user_names)
  name     = each.value
}

# map을 순회하면 key/value 모두 사용 가능
resource "aws_subnet" "this" {
  for_each = var.subnets # map(object({ cidr, az }))

  vpc_id            = aws_vpc.main.id
  cidr_block        = each.value.cidr
  availability_zone = each.value.az

  tags = { Name = "subnet-${each.key}" }
}
```

count는 "리소스를 만들지 말지" 토글할 때만 쓰는 것이 깔끔하다.

```hcl
resource "aws_cloudtrail" "main" {
  count = var.enable_cloudtrail ? 1 : 0
  # ...
}
```

## 표현식: for, splat, 조건

```hcl
locals {
  # for 표현식 — 리스트 변환
  upper_names = [for n in var.names : upper(n)]

  # 필터링
  prod_buckets = [for b in var.buckets : b if b.environment == "prod"]

  # 리스트 → 맵 변환
  users_by_name = { for u in var.users : u.name => u }

  # splat — 리소스 목록에서 속성만 추출
  subnet_ids = aws_subnet.this[*].id          # count 기반
  subnet_arns = values(aws_subnet.this)[*].arn # for_each 기반은 values() 필요
}
```

## dynamic 블록

중첩 블록(ingress, statement 등)을 반복 생성할 때 사용한다. 남용하면
가독성이 급격히 떨어지므로 "반복되는 중첩 블록"에만 제한적으로 쓴다.

```hcl title="security-group.tf"
resource "aws_security_group" "web" {
  name   = "${local.name_prefix}-web"
  vpc_id = aws_vpc.main.id

  dynamic "ingress" {
    for_each = var.ingress_rules # list(object({ port, cidrs, desc }))

    content {
      description = ingress.value.desc
      from_port   = ingress.value.port
      to_port     = ingress.value.port
      protocol    = "tcp"
      cidr_blocks = ingress.value.cidrs
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
```

## lifecycle과 depends_on

```hcl
resource "aws_iam_role" "ci" {
  name = "ci-deploy-role"

  lifecycle {
    prevent_destroy = true # destroy 시도 시 에러 — 핵심 리소스 보호

    # 외부 시스템이 관리하는 속성은 drift 무시
    ignore_changes = [tags["LastScanned"]]
  }
}

resource "aws_lb" "main" {
  # ...
  lifecycle {
    create_before_destroy = true # 교체 시 새 리소스 생성 후 기존 제거
  }
}

resource "aws_instance" "app" {
  # ...
  # 암묵적 참조가 없는데 순서가 필요할 때만 명시
  depends_on = [aws_iam_role_policy.app_permissions]
}
```

`depends_on`은 참조(`aws_x.y.id`)로 의존성이 잡히지 않는 경우의 최후
수단이다. 남발하면 plan이 보수적으로 변해 불필요한 대기가 생긴다.

## 자주 쓰는 함수

| 함수 | 용도 | 예시 |
| --- | --- | --- |
| `try()` | 실패 시 폴백 | `try(var.config.port, 8080)` |
| `coalesce()` | 첫 non-null 값 | `coalesce(var.name, local.default)` |
| `merge()` | 맵 병합 | `merge(local.common_tags, { Name = "x" })` |
| `lookup()` | 맵 조회 + 기본값 | `lookup(var.amis, var.region, null)` |
| `flatten()` | 중첩 리스트 평탄화 | 서브넷×AZ 조합 생성 시 |
| `jsonencode()` | HCL → JSON | IAM 정책 문서 작성 |
| `templatefile()` | 템플릿 렌더링 | user_data 스크립트 |
| `cidrsubnet()` | CIDR 분할 | `cidrsubnet("10.0.0.0/16", 8, 1)` → 10.0.1.0/24 |

IAM 정책은 heredoc 문자열보다 `jsonencode()`가 안전하다. 문법 오류를
plan 단계에서 잡아준다.

```hcl
resource "aws_iam_policy" "readonly" {
  name = "s3-readonly"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:ListBucket"]
      Resource = [aws_s3_bucket.logs.arn, "${aws_s3_bucket.logs.arn}/*"]
    }]
  })
}
```

## 모듈

```hcl title="environments/prod/main.tf"
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0" # 레지스트리 모듈은 반드시 버전 고정

  name = "prod-vpc"
  cidr = "10.0.0.0/16"
}

module "security_baseline" {
  source = "../../modules/security-baseline" # 로컬 모듈

  environment = "prod"
  vpc_id      = module.vpc.vpc_id # 모듈 output 참조
}
```

## 리팩토링: moved와 import

리소스 이름을 바꾸거나 모듈로 옮길 때 `moved` 블록을 쓰면 destroy 없이
state만 이동한다. (Terraform 1.1+)

```hcl
moved {
  from = aws_s3_bucket.logs
  to   = module.logging.aws_s3_bucket.logs
}
```

이미 존재하는 리소스를 코드로 가져올 때는 `import` 블록이 CLI 명령보다
낫다. plan에서 결과를 미리 볼 수 있다. (Terraform 1.5+)

```hcl
import {
  to = aws_s3_bucket.legacy
  id = "legacy-bucket-name"
}
```

## 실무 체크리스트

- [ ] provider, 모듈 버전 고정 (`~>` 이상)
- [ ] 원격 state + 잠금 구성 (S3 `use_lockfile` 등)
- [ ] 반복 리소스는 for_each, on/off 토글만 count
- [ ] 비밀값은 state에 남는다는 전제로 설계
- [ ] `terraform fmt -check`와 `terraform validate`를 CI에 포함
- [ ] plan 결과를 리뷰 없이 apply하지 않기 (특히 `-auto-approve` 금지)

---

문법 다음 단계는 실전 구축이다.

- 이 문법들을 조합해 실제 VPC를 구축하는 과정:
  [Terraform으로 구축하는 프로덕션 VPC](/techblog/blog/terraform-vpc-complete-guide/)
- 팀 단위 운영 구조(스택 분할, 모듈 계약, CI/CD):
  [엔터프라이즈 Terraform 운영 구조](/techblog/blog/terraform-enterprise-structure/)
