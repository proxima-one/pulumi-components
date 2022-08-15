import * as pulumi from "@pulumi/pulumi";

export type ShardResource = ShardV1;

export interface ShardV1 {
  apiKind: "shard/v1";

  type: "ft-balances" | "ft-raw";
  network: string;
  stream: string;
  dbName: string;
  dbUri: string;
}

export interface GenericShardDefinition {
  image: string;
  env?: Record<string, string>;
}

export function resourceToDefinition(
  resource: ShardResource
): GenericShardDefinition {
  switch (resource.apiKind) {
    case "shard/v1": {
      const env: Record<string, string> = {};
    }
    default:
      throw new Error(`invalid apiKind ${resource.apiKind}`);
  }
}
