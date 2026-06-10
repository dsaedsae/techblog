export const SITE_TITLE = 'techblog';
export const SITE_DESCRIPTION =
  '보안 엔지니어의 기술 블로그 — AWS, Terraform, DevSecOps, AI Agent Security 실무 노트';

export const CATEGORY_IDS = [
  'aws',
  'terraform',
  'devsecops',
  'ai-agent-security',
  'scripts',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

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
  'ai-agent-security': {
    label: 'AI Agent Security',
    description: 'LLM 에이전트 위협 모델링과 방어 기법',
  },
  scripts: {
    label: 'Scripts',
    description: '실무에서 바로 쓰는 자동화 스크립트',
  },
};
