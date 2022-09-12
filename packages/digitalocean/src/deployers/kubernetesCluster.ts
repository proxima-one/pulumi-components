import * as digitalocean from "@pulumi/digitalocean";
import { Region } from "@pulumi/digitalocean";
import { DropletSlug } from "@pulumi/digitalocean/types/enums";
import * as pulumi from "@pulumi/pulumi";
import { KubernetesClusterNodePool } from "@pulumi/digitalocean/types/input";
import { DigitaloceanDeployer } from "./base";

export interface KubernetesClusterArgs {
  name: string;
  region: Region;
  version: string;
  autoUpgrade?: boolean;
  ha?: boolean;
  primaryNodePool: NodePool;
  otherNodePools?: NodePool[];
}

export interface NodePool {
  name: string;
  tags?: string[];
  labels?: Record<string, string>;
  size: DropletSlug;
  nodeCount?: number;
  autoScale?: {
    maxNodes?: number;
    minNodes?: number;
  };
}

export interface DeployedKubernetesCluster {
  kubeconfig: pulumi.Output<string>;
}

export class KubernetesClusterDeployer extends DigitaloceanDeployer {
  public deploy(args: KubernetesClusterArgs): DeployedKubernetesCluster {
    const cluster = new digitalocean.KubernetesCluster(args.name, {
      name: args.name,
      region: args.region,
      version: args.version,
      autoUpgrade: args.autoUpgrade ?? false,
      ha: args.ha ?? false,

      nodePool: toNodePool(args.primaryNodePool),
    }, {provider: this.provider});

    const otherNodePools = (args.otherNodePools ?? []).map(x =>
      new digitalocean.KubernetesNodePool(`np-${x.name}`, {
        clusterId: cluster.id,
        ...toNodePool(x),
      }, {provider: this.provider})
    )

    function toNodePool(args: NodePool): KubernetesClusterNodePool {
      return {
        name: args.name,
        size: args.size,
        nodeCount: args.nodeCount ?? 1,
        autoScale: !!args.autoScale,
        maxNodes: args.autoScale
          ? args.autoScale.maxNodes
          : undefined,
        minNodes: args.autoScale
          ? args.autoScale.minNodes
          : undefined,
        tags: args.tags,
        labels: args.labels,
      }
    }

    return {kubeconfig: createTokenKubeconfig(cluster, this.params.user, this.params.apiToken)};
  }
}

function createTokenKubeconfig(
  cluster: digitalocean.KubernetesCluster,
  user: pulumi.Input<string>,
  apiToken: pulumi.Input<string>,
): pulumi.Output<string> {
  return pulumi.interpolate`apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${cluster.kubeConfigs[0].clusterCaCertificate}
    server: ${cluster.endpoint}
  name: ${cluster.name}
contexts:
- context:
    cluster: ${cluster.name}
    user: ${cluster.name}-${user}
  name: ${cluster.name}
current-context: ${cluster.name}
kind: Config
users:
- name: ${cluster.name}-${user}
  user:
    token: ${apiToken}
`;
}
