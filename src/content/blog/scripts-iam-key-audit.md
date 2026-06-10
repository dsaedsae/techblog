---
title: 'IAM 액세스 키 수명 감사 스크립트'
description: '오래된 IAM 액세스 키를 찾아내는 Python 스크립트 예시를 담은 placeholder 글입니다.'
date: 2026-06-09
category: scripts
tags: [python, aws, iam, automation]
---

> 이 글은 frontmatter 형식 예시용 placeholder입니다. 실제 내용으로 교체하세요.

## 목적

90일 이상 회전되지 않은 IAM 액세스 키를 찾아 목록으로 출력합니다.
주기적으로 실행해 키 회전 정책 준수 여부를 점검할 수 있습니다.

## 스크립트

```python title="audit_iam_keys.py"
import boto3
from datetime import datetime, timezone

MAX_KEY_AGE_DAYS = 90


def find_stale_keys() -> list[dict]:
    iam = boto3.client("iam")
    stale = []
    for user in iam.get_paginator("list_users").paginate():
        for u in user["Users"]:
            keys = iam.list_access_keys(UserName=u["UserName"])
            for key in keys["AccessKeyMetadata"]:
                age = (datetime.now(timezone.utc) - key["CreateDate"]).days
                if age > MAX_KEY_AGE_DAYS and key["Status"] == "Active":
                    stale.append({
                        "user": u["UserName"],
                        "key_id": key["AccessKeyId"],
                        "age_days": age,
                    })
    return stale


if __name__ == "__main__":
    for item in find_stale_keys():
        print(f'{item["user"]}: {item["key_id"]} ({item["age_days"]}일 경과)')
```

## 실행

```bash
python audit_iam_keys.py
```

## 마무리

출력 결과를 Slack 웹훅으로 보내거나 Lambda로 주기 실행하도록 확장할 수
있습니다.
