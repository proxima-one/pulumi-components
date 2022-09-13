import { strict as assert } from "assert";
import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";
import { GcpDeployer } from "./base";

export interface KubernetesClusterArgs {
  name: string;
  version: string;
  nodePools: NodePool[];
}

export interface NodePool {
  machineType: string;
  diskSizeGb?: pulumi.Input<number>;
  name: string;
  labels?: Record<string, string>;
  nodeCount?: number;
  autoScale?: {
    maxNodes: number;
    minNodes: number;
  };
}

export interface DeployedKubernetesCluster {
  kubeconfig: pulumi.Output<string>;
}

export class KubernetesClusterDeployer extends GcpDeployer {
  public deploy(args: KubernetesClusterArgs): DeployedKubernetesCluster {
    assert(
      args.nodePools.length >= 1,
      "at least one node pool must be specified"
    );

    const cluster = new gcp.container.Cluster(
      args.name,
      {
        name: args.name,
        location: this.params.zone,
        removeDefaultNodePool: true,
        minMasterVersion: args.version,
        initialNodeCount: 1,
      },
      { provider: this.provider }
    );

    const nodePools = args.nodePools.map(
      (x) =>
        new gcp.container.NodePool(
          `np-${x.name}`,
          {
            ...this.toNodePool(x, cluster.name),
          },
          { provider: this.provider }
        )
    );

    const nodePoolsAwaiter = pulumi.all(nodePools.map((x) => x.maxPodsPerNode));

    return {
      kubeconfig: nodePoolsAwaiter.apply((x) => this.createKubeconfig(cluster)),
    };
  }

  private toNodePool(
    args: NodePool,
    cluster: pulumi.Input<string>
  ): gcp.container.NodePoolArgs {
    assert(
      (args.nodeCount && args.nodeCount > 0) ||
        (args.autoScale && args.autoScale?.minNodes > 0),
      "no nodes sepcified in pool"
    );

    return {
      name: args.name,
      location: this.params.zone,
      cluster: cluster,
      nodeCount: args.nodeCount,
      autoscaling: args.autoScale
        ? {
            maxNodeCount: args.autoScale.maxNodes,
            minNodeCount: args.autoScale.minNodes,
          }
        : undefined,
      nodeConfig: {
        machineType: args.machineType,
        diskSizeGb: args.diskSizeGb,
        labels: args.labels,
        oauthScopes: [
          "https://www.googleapis.com/auth/cloud-platform",
          "https://www.googleapis.com/auth/compute",
          "https://www.googleapis.com/auth/devstorage.read_only",
          "https://www.googleapis.com/auth/logging.write",
          "https://www.googleapis.com/auth/monitoring",
        ],
      },
    };
  }

  private createKubeconfig(cluster: gcp.container.Cluster) {
    return pulumi
      .all([cluster.name, cluster.endpoint, cluster.masterAuth])
      .apply(([name, endpoint, masterAuth]) => {
        const context = `${this.params.project}_${this.params.zone}_${name}`;
        return `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${masterAuth.clusterCaCertificate}
    server: https://${endpoint}
  name: ${context}
contexts:
- context:
    cluster: ${context}
    user: ${context}
  name: ${context}
current-context: ${context}
kind: Config
preferences: {}
users:
- name: ${context}
  user:
    auth-provider:
      config:
        cmd-args: config config-helper --format=json
        cmd-path: gcloud
        expiry-key: '{.credential.token_expiry}'
        token-key: '{.credential.access_token}'
      name: gcp
`;
      });
  }
}
