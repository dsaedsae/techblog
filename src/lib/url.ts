/**
 * base('/techblog')가 적용된 사이트 내부 경로를 만든다.
 * 모든 내부 링크는 반드시 이 함수를 거쳐야 GitHub Pages 프로젝트 사이트에서
 * 경로가 깨지지 않는다.
 */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}
