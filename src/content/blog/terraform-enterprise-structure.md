---
title: '엔터프라이즈 Terraform 운영 구조: 혼자 쓰는 코드에서 팀이 운영하는 코드로'
description: '스택 분할, 모듈 계약, 태깅 거버넌스, OIDC 기반 GitHub Actions plan/apply 파이프라인까지 — 팀 단위 Terraform 운영에 필요한 구조를 동작하는 코드로 정리했다.'
date: 2026-06-10
category: terraform
tags: [terraform, ci-cd, github-actions, oidc, governance]
series: terraform-zero-to-prod
seriesOrder: 4
---

Terraform 코드가 망가지는 시점은 문법을 몰라서가 아니라 **구조 없이
규모가 커질 때**다. 한 디렉토리에 모든 리소스, 한 state에 모든 환경,
각자 로컬에서 apply — 이 상태로 팀원이 셋만 되어도 사고가 난다. 이 글은
그 전환점에서 필요한 구조를 결정 사항 순서대로 정리한다.

## 1. 스택 분할: state 하나의 적정 크기

전체 인프라를 state 하나에 넣으면 세 가지 문제가 생긴다.

- plan에 10분 이상 걸리기 시작한다 (리소스 수백 개의 refresh)
- 누군가 apply 중이면 전원이 잠금 대기
- 실수의 폭발 반경(blast radius)이 인프라 전체

해법은 **변경 주기와 위험도가 다른 것끼리 state를 나누는 것**이다.

```text
infra/
├── modules/                      # 재사용 모듈 (state 없음)
│   ├── network/
│   ├── security-baseline/
│   └── eks-cluster/
└── environments/
    ├── prod/
    │   ├── network/              # 스택 1: 분기에 한 번 변경
    │   ├── platform/             # 스택 2: EKS, RDS — 월 단위 변경
    │   └── app/                  # 스택 3: 서비스 리소스 — 주 단위 변경
    ├── stg/
    │   └── ...
    └── dev/
        └── ...
```

| 스택 | 변경 빈도 | 사고 시 영향 | apply 권한 |
| --- | --- | --- | --- |
| network | 낮음 | 전체 중단 | 인프라 팀 + 승인 2인 |
| platform | 중간 | 해당 환경 중단 | 인프라 팀 |
| app | 높음 | 해당 서비스 | 서비스 팀 셀프서비스 |

스택 간 참조는 `terraform_remote_state` 대신 **output을 SSM Parameter로
발행**하는 쪽을 권장한다. remote_state는 하위 스택에 상위 state 전체
읽기 권한을 줘야 하지만(비밀값 포함!), SSM 방식은 공개할 값만 선별
노출한다.

```hcl title="environments/prod/network/share-outputs.tf"
# network 스택: 공유할 값만 SSM에 발행
resource "aws_ssm_parameter" "vpc_id" {
  name  = "/infra/prod/network/vpc_id"
  type  = "String"
  value = module.network.vpc_id
}
```

```hcl title="environments/prod/platform/data.tf"
# platform 스택: 필요한 값만 읽기
data "aws_ssm_parameter" "vpc_id" {
  name = "/infra/prod/network/vpc_id"
}

locals {
  vpc_id = data.aws_ssm_parameter.vpc_id.value
}
```

## 2. 모듈 계약: 모듈은 라이브러리처럼 관리한다

모듈이 "복사해서 고쳐 쓰는 코드 조각"이 되는 순간 표준은 끝난다. 모듈을
라이브러리로 만들려면 계약이 필요하다.

**모듈 작성 규칙 (팀 컨벤션으로 문서화할 것):**

1. 모든 variable에 `description` + 가능한 한 `validation`. 모듈의
   에러 메시지가 곧 사용 설명서다.
2. 리소스 이름은 `this` — `aws_vpc.this`. 모듈 이름이 이미 맥락이다.
3. provider 블록 금지. 모듈은 provider를 상속받는다. (멀티 리전 모듈만
   `configuration_aliases` 사용)
4. 호출자가 알아야 할 모든 것은 output으로. 모듈 내부 리소스를 밖에서
   직접 참조하게 만들지 않는다.
5. `examples/` 디렉토리에 동작하는 사용 예 필수 — 이게 곧 테스트
   픽스처가 된다.

**버저닝**: 모듈을 별도 리포지토리로 분리하고 git 태그로 버전을 박는다.

```hcl
module "network" {
  source = "git::https://github.com/myorg/terraform-modules.git//network?ref=v1.4.2"
  # ...
}
```

`ref` 없는 git source는 금지다. 모듈 리포지토리의 main이 바뀌는 순간
전사 인프라의 다음 plan이 전부 바뀐다. 모노레포 단계(`../../modules/`)
에서는 PR 리뷰가 그 역할을 대신하므로, 모듈 디렉토리 변경 시 모든 환경의
plan을 돌리는 CI를 건다 (아래 6장).

## 3. 태깅 거버넌스: 코드로 강제하기

태그가 없으면 비용 배분도, 사고 시 소유자 추적도, 수명 관리도 안 된다.
문서로 "태그 답시다"는 동작하지 않고, 코드 레벨 강제만 동작한다.

1단계 — provider `default_tags`로 기본값 주입:

```hcl title="environments/prod/network/providers.tf"
provider "aws" {
  region = "ap-northeast-2"

  default_tags {
    tags = {
      Project     = "myapp"
      Environment = "prod"
      Stack       = "network"
      ManagedBy   = "terraform"
      Repository  = "github.com/myorg/infra"
    }
  }
}
```

2단계 — 모듈 입력에서 필수 태그를 검증:

```hcl title="modules/_contract/variables.tf"
variable "tags" {
  description = "필수 키: Owner, CostCenter"
  type        = map(string)

  validation {
    condition = alltrue([
      for key in ["Owner", "CostCenter"] : contains(keys(var.tags), key)
    ])
    error_message = "tags에 Owner, CostCenter 키가 반드시 포함되어야 합니다."
  }
}
```

3단계 — 조직 차원에서는 AWS Organizations **Tag Policy** + SCP로 태그
없는 리소스 생성 자체를 거부할 수 있다. Terraform 검증은 우리 코드만
막지만, SCP는 콘솔 수동 생성까지 막는다.

## 4. State와 계정 경계

원칙: **환경 = AWS 계정 = state 버킷**. dev CI 자격 증명으로 prod state를
읽을 수조차 없게 만드는 것이 목적이다.

```text
계정 구조 (AWS Organizations)
├── management          # SCP, 조직 관리만. 워크로드 금지
├── security            # CloudTrail/Config 로그 집계, 감사 도구
├── shared              # ECR, 모듈 캐시, CI 러너
├── prod                # state: s3://myorg-tfstate-prod
├── stg                 # state: s3://myorg-tfstate-stg
└── dev                 # state: s3://myorg-tfstate-dev
```

state key 컨벤션은 디렉토리 구조와 1:1로 맞춘다. 어디 state인지 코드
위치만 보고 알 수 있어야 한다.

```hcl title="environments/prod/network/backend.tf"
terraform {
  backend "s3" {
    bucket       = "myorg-tfstate-prod"   # prod 계정 소유
    key          = "network/terraform.tfstate"
    region       = "ap-northeast-2"
    encrypt      = true
    use_lockfile = true
  }
}
```

## 5. CI 자격 증명: 액세스 키 대신 OIDC

GitHub Actions에 IAM User 액세스 키를 넣는 방식은 이제 안티패턴이다.
키가 영구적이고, 유출되면 리포지토리 밖에서도 쓸 수 있다. OIDC 연동은
**해당 리포지토리의 해당 워크플로만**, 그것도 세션당 수십 분짜리 임시
자격 증명을 받는다.

역할은 두 개로 분리한다. plan은 읽기 전용, apply만 쓰기.

```hcl title="environments/prod/ci-roles/main.tf"
data "aws_caller_identity" "current" {}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# ── plan 역할: PR에서 사용, 읽기 전용 ──
data "aws_iam_policy_document" "plan_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # 이 리포지토리에서만 assume 가능
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:myorg/infra:*"]
    }
  }
}

resource "aws_iam_role" "plan" {
  name                 = "gha-terraform-plan"
  assume_role_policy   = data.aws_iam_policy_document.plan_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "plan_readonly" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# state 잠금/쓰기는 ReadOnly에 없으므로 별도 부여
resource "aws_iam_role_policy" "plan_state" {
  name = "tfstate-access"
  role = aws_iam_role.plan.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
      Resource = [
        "arn:aws:s3:::myorg-tfstate-prod",
        "arn:aws:s3:::myorg-tfstate-prod/*",
      ]
    }]
  })
}

# ── apply 역할: main 브랜치 + production environment에서만 ──
data "aws_iam_policy_document" "apply_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # environment 보호 규칙(승인자)을 통과한 잡만 이 sub를 가진다
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:myorg/infra:environment:production"]
    }
  }
}

resource "aws_iam_role" "apply" {
  name               = "gha-terraform-apply"
  assume_role_policy = data.aws_iam_policy_document.apply_trust.json
}

# apply 권한은 PowerUser + IAM 경계 또는 스택별 최소 권한으로 —
# AdministratorAccess를 주더라도 Permission Boundary를 함께 거는 것이 하한선
```

`sub` 조건이 핵심이다. plan 역할은 `repo:myorg/infra:*`(아무 브랜치),
apply 역할은 `environment:production` — GitHub의 environment 보호
규칙(필수 승인자)을 통과해야만 발급되는 토큰이다. **승인 절차가 IAM
신뢰 정책 레벨에서 강제된다.**

## 6. 파이프라인: PR에 plan, main에 apply

```yaml title=".github/workflows/terraform-prod-network.yml"
name: terraform / prod / network

on:
  pull_request:
    paths:
      - 'environments/prod/network/**'
      - 'modules/network/**'
  push:
    branches: [main]
    paths:
      - 'environments/prod/network/**'
      - 'modules/network/**'

permissions:
  id-token: write      # OIDC 토큰 발급
  contents: read
  pull-requests: write # plan 결과 코멘트

# 같은 스택의 동시 실행 금지 — state 잠금 충돌 예방
concurrency:
  group: tf-prod-network
  cancel-in-progress: false

env:
  TF_IN_AUTOMATION: 'true'
  WORKING_DIR: environments/prod/network

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: '1.10.5' # 팀 전체 버전 고정

      - name: fmt
        run: terraform fmt -check -recursive

      - name: tflint
        uses: terraform-linters/setup-tflint@v4
      - run: tflint --chdir=${{ env.WORKING_DIR }} --recursive

      - name: IaC 보안 스캔
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: config
          scan-ref: ${{ env.WORKING_DIR }}
          exit-code: '1'
          severity: HIGH,CRITICAL

  plan:
    if: github.event_name == 'pull_request'
    needs: checks
    runs-on: ubuntu-latest
    defaults:
      run:
        # job 레벨 defaults.run에서는 env 컨텍스트를 못 쓴다 — 리터럴로 지정
        working-directory: environments/prod/network
    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: '1.10.5'

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::111122223333:role/gha-terraform-plan
          aws-region: ap-northeast-2

      - run: terraform init -input=false
      - run: terraform validate

      - name: plan
        id: plan
        run: |
          terraform plan -input=false -no-color -out=tfplan
          terraform show -no-color tfplan > plan.txt

      - name: PR에 plan 결과 코멘트
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          {
            echo '### Terraform plan — prod/network'
            echo '```'
            tail -c 60000 plan.txt
            echo '```'
          } > comment.md
          gh pr comment ${{ github.event.pull_request.number }} \
            --body-file comment.md --edit-last --create-if-none

  apply:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    needs: checks
    runs-on: ubuntu-latest
    environment: production # 필수 승인자 설정 → 사람이 승인해야 진행
    defaults:
      run:
        working-directory: environments/prod/network
    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: '1.10.5'

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::111122223333:role/gha-terraform-apply
          aws-region: ap-northeast-2

      - run: terraform init -input=false

      # 머지 후 시점의 plan을 새로 떠서 그대로 적용 —
      # PR 시점 plan과 달라졌을 수 있으므로 -out 파일 기준으로만 apply
      - name: plan (apply 직전 재확인)
        run: terraform plan -input=false -out=tfplan

      - name: apply
        run: terraform apply -input=false tfplan
```

설계 포인트:

- **`-out=tfplan` 기준 apply**: "plan에서 본 것만 적용된다"는 보장.
  plan 없이 `apply -auto-approve`를 돌리면 머지 사이에 끼어든 변경이
  검토 없이 적용될 수 있다.
- **`paths` 필터**: 모노레포에서 스택별 워크플로를 분리해, network
  변경이 app 파이프라인을 트리거하지 않게 한다. `modules/network/**`도
  포함해 모듈 변경 시 사용처 plan이 같이 돈다.
- **environment 승인 + OIDC sub 조건**: 둘이 세트다. GitHub 쪽 설정만
  믿으면 워크플로 파일을 고칠 수 있는 사람이 우회 가능하지만, IAM 신뢰
  정책의 sub 조건은 AWS 쪽 통제라 리포지토리 권한으로 못 푼다.

## 7. 로컬 훅: CI까지 가기 전에 잡기

CI에서 fmt 실패로 한 사이클(수 분)을 날리는 건 낭비다. pre-commit으로
로컬에서 먼저 거른다.

```yaml title=".pre-commit-config.yaml"
repos:
  - repo: https://github.com/antonbabenko/pre-commit-terraform
    rev: v1.96.1
    hooks:
      - id: terraform_fmt
      - id: terraform_validate
      - id: terraform_tflint
      - id: terraform_trivy
        args: ['--args=--severity HIGH,CRITICAL']
```

```bash
pip install pre-commit
pre-commit install   # 이후 커밋마다 자동 실행
```

## 8. Drift 감지: 콘솔 수동 변경 잡아내기

운영하다 보면 누군가 콘솔에서 SG를 "잠깐" 고친다. 그 변경은 다음 apply
때 말없이 롤백되거나, 반대로 영영 코드 밖에 남는다. 주기적 plan으로
드러나게 만든다.

```yaml title=".github/workflows/drift-detection.yml"
name: drift-detection

on:
  schedule:
    - cron: '0 22 * * 1-5' # 평일 아침 7시 KST

permissions:
  id-token: write
  contents: read

jobs:
  drift:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        stack: [network, platform, app]
    defaults:
      run:
        working-directory: environments/prod/${{ matrix.stack }}
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: '1.10.5'
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::111122223333:role/gha-terraform-plan
          aws-region: ap-northeast-2

      - run: terraform init -input=false

      - name: plan (detailed-exitcode)
        id: plan
        # exit 0=변경 없음, 1=오류, 2=drift 존재
        run: terraform plan -input=false -refresh-only -detailed-exitcode
        continue-on-error: true

      - name: drift 발견 시 알림
        if: steps.plan.outputs.exitcode == '2'
        run: |
          curl -s -X POST "$SLACK_WEBHOOK" -H 'Content-Type: application/json' \
            -d '{"text":"⚠️ prod/${{ matrix.stack }} 스택에서 drift 감지 — plan 로그 확인 필요"}'
        env:
          SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK_URL }}
```

drift가 보이면 두 가지 중 하나다. 콘솔 변경이 정당했다면 코드에
반영하고, 아니라면 apply로 되돌린다. 어느 쪽이든 **결정이 기록에
남는다**는 것이 핵심이다.

## 9. 도입 순서: 한 번에 다 하지 않기

이 구조를 처음부터 전부 갖추려 하면 시작을 못 한다. 현실적인 순서:

1. **원격 state + 잠금** — 이것 없이는 아무것도 안전하지 않다
2. **디렉토리 분리** (environments/, modules/) — 리팩토링은 `moved`
   블록으로 무중단 진행
3. **OIDC + PR plan 코멘트** — 로컬 apply를 끊는 첫걸음
4. **apply의 CI 이관 + environment 승인** — 이 시점부터 로컬 자격
   증명에서 쓰기 권한 회수
5. **스택 분할** — state가 커져서 아프기 시작할 때
6. **drift 감지, 태그 거버넌스** — 운영 안정화 단계

3→4 사이가 가장 중요한 전환이다. "CI가 plan을 떠 주지만 apply는 각자
로컬에서"가 길어지면, plan 코멘트는 장식이 되고 사고는 로컬 apply에서
난다.

---

네트워크 스택의 실제 모듈 구현은 앞 글에서 다뤘다:
[Terraform으로 구축하는 프로덕션 VPC](/techblog/blog/terraform-vpc-complete-guide/)
