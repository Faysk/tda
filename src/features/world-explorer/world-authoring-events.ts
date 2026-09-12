export const WORLD_AUTHORING_OPEN_INSPECTOR_EVENT = "tda:world-authoring-open-inspector";
export const WORLD_AUTHORING_CONNECT_FROM_NODE_EVENT = "tda:world-authoring-connect-from-node";
export const WORLD_AUTHORING_OPEN_COMMAND_PALETTE_EVENT = "tda:world-authoring-open-command-palette";

export type WorldAuthoringConnectFromNodeDetail = Readonly<{
	nodeId: string;
}>;
