---
title: 'IAM 액세스 키 수명 감사 스크립트: 90일 넘은 키 찾아내기'
description: '회전되지 않은 IAM 액세스 키를 찾아 보고서로 출력하는 Python 스크립트. 미사용 키 탐지와 Slack 알림 확장까지.'
date: 2026-06-09
category: scripts
tags: [python, aws, iam, automation]
---

장기 자격 증명(액세스 키)은 만들지 않는 것이 최선이지만, 현실에는 항상
레거시가 있다. 차선은 존재하는 키를 추적하는 것이다. 이 스크립트는 두
가지를 찾는다.

- 생성 후 **90일 이상 회전되지 않은** 활성 키
- 마지막 사용일이 **30일 이상 지난**(또는 한 번도 안 쓴) 유휴 키

회전 대상과 삭제 대상은 다르게 다뤄야 하므로 구분해서 출력한다.

## 스크립트

```python title="audit_iam_keys.py"
"""IAM 액세스 키 수명 감사.

필요 권한: iam:ListUsers, iam:ListAccessKeys, iam:GetAccessKeyLastUsed
"""
import boto3
from datetime import datetime, timezone

MAX_KEY_AGE_DAYS = 90
MAX_IDLE_DAYS = 30


def audit_keys() -> tuple[list[dict], list[dict]]:
    iam = boto3.client("iam")
    now = datetime.now(timezone.utc)
    stale, idle = [], []

    for page in iam.get_paginator("list_users").paginate():
        for user in page["Users"]:
            username = user["UserName"]
            keys = iam.list_access_keys(UserName=username)

            for key in keys["AccessKeyMetadata"]:
                if key["Status"] != "Active":
                    continue

                key_id = key["AccessKeyId"]
                age = (now - key["CreateDate"]).days

                last_used_info = iam.get_access_key_last_used(AccessKeyId=key_id)
                last_used = last_used_info["AccessKeyLastUsed"].get("LastUsedDate")
                idle_days = (now - last_used).days if last_used else None

                record = {
                    "user": username,
                    "key_id": key_id,
                    "age_days": age,
                    "idle_days": idle_days,  # None이면 사용 이력 없음
                }

                if age > MAX_KEY_AGE_DAYS:
                    stale.append(record)
                if idle_days is None or idle_days > MAX_IDLE_DAYS:
                    idle.append(record)

    return stale, idle


def print_report(stale: list[dict], idle: list[dict]) -> None:
    print(f"\n[회전 대상] {MAX_KEY_AGE_DAYS}일 초과 활성 키: {len(stale)}건")
    for r in sorted(stale, key=lambda x: -x["age_days"]):
        print(f"  {r['user']:<24} {r['key_id']} ({r['age_days']}일 경과)")

    print(f"\n[삭제 검토] {MAX_IDLE_DAYS}일 이상 미사용 키: {len(idle)}건")
    for r in idle:
        used = "사용 이력 없음" if r["idle_days"] is None else f"{r['idle_days']}일 미사용"
        print(f"  {r['user']:<24} {r['key_id']} ({used})")


if __name__ == "__main__":
    stale_keys, idle_keys = audit_keys()
    print_report(stale_keys, idle_keys)
    # 발견 건이 있으면 비정상 종료 — CI 게이트로 활용 가능
    raise SystemExit(1 if stale_keys or idle_keys else 0)
```

## 실행

```bash
# 읽기 전용 권한이면 충분하다
python audit_iam_keys.py

# 특정 프로파일로
AWS_PROFILE=security-audit python audit_iam_keys.py
```

exit code를 반환하므로 CI 스케줄 잡으로 돌리면 발견 시 잡 실패로 바로
드러난다.

## Slack 알림 확장

운영에서는 사람이 매일 스크립트를 돌리지 않는다. 웹훅 한 줄이면 주간
리포트가 된다.

```python title="notify.py"
import json
import os
import urllib.request


def notify_slack(stale: list[dict], idle: list[dict]) -> None:
    webhook = os.environ["SLACK_WEBHOOK_URL"]
    lines = [f"*IAM 키 감사 결과* — 회전 대상 {len(stale)}건, 미사용 {len(idle)}건"]
    lines += [f"• `{r['user']}` {r['key_id']} ({r['age_days']}일)" for r in stale[:10]]

    req = urllib.request.Request(
        webhook,
        data=json.dumps({"text": "\n".join(lines)}).encode(),
        headers={"Content-Type": "application/json"},
    )
    urllib.request.urlopen(req)
```

## 운영 팁

- **Lambda + EventBridge 주간 실행**이 가장 간단한 상시화다. 스크립트
  그대로 핸들러에 옮기면 된다.
- 탐지 후 프로세스를 정해야 도구가 의미를 가진다: 통보 → 7일 유예 →
  비활성화(`iam update-access-key --status Inactive`) → 30일 후 삭제.
  비활성화 단계를 거치면 "그 키 아직 쓰는데요"를 무중단으로 발견할 수 있다.
- 근본 해결은 키를 없애는 것이다. EC2는 인스턴스 프로파일, CI는 OIDC
  연동으로 옮기고, 이 스크립트의 출력이 0이 되는 날을 목표로 한다.
