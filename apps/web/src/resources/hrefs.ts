import { settingsHref } from '../settings/settings-href.js';

export const PROVIDERS_HREF = '/app/resources/providers';
export const MODEL_ROUTING_HREF = '/app/resources/model-routing';
export const MACHINES_HREF = '/app/resources/machines';
export const MCP_HREF = '/app/resources/mcp-servers';
export const SECRETS_HREF = '/app/resources/secrets';
export const SKILLS_HREF = '/app/resources/skills';
export const ROUTING_SETTINGS_HREF = '/app/resources/routing-settings';
export const USAGE_PATH = '/app/usage';
export const RUN_PATH_PREFIX = '/app/runs/';
export const RUN_PATH = '/app/runs/:runId?';
export const COORDINATOR_ROUTE_ANCHOR = 'route-coordinator';
export const COORDINATOR_ROUTING_HREF = `${settingsHref('routing')}#${COORDINATOR_ROUTE_ANCHOR}`;
