---
title: 'Terraform 원격 상태 관리: S3 백엔드 구성 패턴'
description: 'S3 백엔드와 상태 잠금으로 팀 단위 Terraform 상태를 안전하게 관리하는 기본 패턴을 정리한 placeholder 글입니다.'
date: 2026-06-04
category: terraform
tags: [terraform, s3, state-management]
---

> 이 글은 frontmatter 형식 예시용 placeholder입니다. 실제 내용으로 교체하세요.

## 로컬 상태의 문제

`terraform.tfstate`를 로컬에 두면 팀원 간 상태 충돌, 비밀값 평문 노출,
유실 위험이 생깁니다. 원격 백엔드는 선택이 아니라 필수입니다.

## S3 백엔드 구성

```hcl title="backend.tf"
terraform {
  backend "s3" {
    bucket       = "my-terraform-state-bucket"
    key          = "prod/network/terraform.tfstate"
    region       = "ap-northeast-2"
    encrypt      = true
    use_lockfile = true # S3 네이티브 잠금 (Terraform 1.10+)
  }
}
```

## 상태 버킷 자체를 코드로

```terraform title="state-bucket.tf"
resource "aws_s3_bucket" "tfstate" {
  bucket = "my-terraform-state-bucket"
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  versioning_configuration {
    status = "Enabled"
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

## 마무리

상태 파일에는 비밀값이 들어갈 수 있으므로 버킷 암호화와 접근 제어를
반드시 함께 구성해야 합니다.
