import * as pulumi from "@pulumi/pulumi";

export interface ShardMetadata {
  networks: pulumi.Input<string>[];
  endpoint: pulumi.Input<string>;
}

export interface Shard {
  name: pulumi.Input<string>;
  metadata: ShardMetadata;
  configuration: ShardResources;
}

export interface ShardResources {
  consumers: ShardDeploymentConfig[];
  server?: ShardDeploymentConfig;
  storage?: ShardStorageResources;
}

export interface ShardDeploymentConfig {
  resources: ResourceRequirements;
  env?: Record<string, pulumi.Input<string>>;
  scale?: pulumi.Input<number>;
}

export interface ShardStorageResources {
  size: string;
  resources: ResourceRequirements;
}

export interface ResourceRequirements {
  cpu: string;
  memory: string;
}

export interface PulumiResourceRequirements {
  requests: ResourceMetrics;
  limits: ResourceMetrics;
}

export interface ResourceMetrics extends Record<string, string> {
  memory: string;
  cpu: string;
}

export function ParseResourceRequirements(
  req: ResourceRequirements
): PulumiResourceRequirements {
  return {
    requests: {
      cpu: req.cpu.split("/")[0],
      memory: req.memory.split("/")[0],
    },
    limits: {
      cpu: req.cpu.split("/")[1],
      memory: req.memory.split("/")[1],
    },
  };
}

export interface DeployedShard {
  name: pulumi.Input<string>;
  networks: pulumi.Input<string>[];
  internalEndpoint: pulumi.Input<string>;
  endpoint: pulumi.Input<string>;
}
