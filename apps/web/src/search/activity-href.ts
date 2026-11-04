export const ACTIVITY_PATH = '/app/activity';

export function activityHref(query: string, currentSearch: string): string {
  const params = new URLSearchParams();
  const scenario = new URLSearchParams(currentSearch).get('scenario');
  if (scenario !== null) params.set('scenario', scenario);
  if (query.trim() !== '') params.set('q', query.trim());
  const search = params.toString();
  return search === '' ? ACTIVITY_PATH : `${ACTIVITY_PATH}?${search}`;
}
