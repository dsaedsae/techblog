export const SITE_TITLE = 'techblog';
export const SITE_DESCRIPTION =
  '보안 엔지니어의 기술 블로그 — AWS, Terraform, DevSecOps, AI Agent Security 실무 노트';

export const CATEGORY_IDS = [
  'aws',
  'terraform',
  'devsecops',
  'offensive-security',
  'ai-agent-security',
  'scripts',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export const SERIES_IDS = [
  'terraform-zero-to-prod',
  'aws-security-ops',
  'securing-ai-agents',
] as const;

export type SeriesId = (typeof SERIES_IDS)[number];

export const SERIES: Record<SeriesId, { title: string; description: string }> = {
  'terraform-zero-to-prod': {
    title: 'Terraform, 문법에서 프로덕션까지',
    description:
      '매번 검색하는 문법 정리에서 시작해 원격 상태, 동작하는 VPC 모듈 구축, 팀 단위 운영 구조까지 — Terraform을 실무에 올리는 전 과정을 순서대로 다룬다.',
  },
  'aws-security-ops': {
    title: 'AWS 보안 운영의 기본기',
    description:
      '보안 서비스 지도로 전체 그림을 잡고, 신규 계정 베이스라인을 세우고, 운영 자동화로 유지한다 — AWS 보안의 최소 기준선을 만드는 시리즈.',
  },
  'securing-ai-agents': {
    title: '자율 AI 에이전트 보안',
    description:
      '프롬프트 인젝션을 전제로 에이전트의 도구 권한을 설계하고, IAM·Cedar·Cilium·Tetragon 4계층으로 인젝션 킬체인을 실제로 차단하기까지.',
  },
};

export const CATEGORIES: Record<CategoryId, { label: string; description: string }> = {
  aws: {
    label: 'AWS',
    description: 'AWS 보안 아키텍처, IAM, 계정 운영 노하우',
  },
  terraform: {
    label: 'Terraform',
    description: 'IaC 설계 패턴, 모듈 구성, 상태 관리',
  },
  devsecops: {
    label: 'DevSecOps',
    description: 'CI/CD 보안, 파이프라인 자동화, 시큐어 코딩',
  },
  'offensive-security': {
    label: 'Offensive Security',
    description: '공격자 시점의 침투 시뮬레이션, 웹/API 취약점 분석, CTF',
  },
  'ai-agent-security': {
    label: 'AI Agent Security',
    description: 'LLM 에이전트 위협 모델링과 방어 기법',
  },
  scripts: {
    label: 'Scripts',
    description: '실무에서 바로 쓰는 자동화 스크립트',
  },
};
