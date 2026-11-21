const HELPER_TYPE = '--type=utility';
const SERVER_SUB_TYPE = '--utility-sub-type=node.mojom.NodeService';

export function isServerHelper(command: string): boolean {
  return command.includes(HELPER_TYPE) && command.includes(SERVER_SUB_TYPE);
}
