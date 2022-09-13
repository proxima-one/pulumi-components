import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";
import { GcpDeployer } from "./base";
import { strict as assert } from "assert";

export interface KubernetesClusterArgs {
  name: string;
  version: string;
  autoUpgrade?: boolean;
  ha?: boolean;
  nodePools: NodePool[];
}

export interface NodePool {
  machineType: string;
  diskSizeGb?: pulumi.Input<number>;
  name: string;
  labels?: Record<string, string>;

  nodeCount?: number;
  autoScale?: {
    maxNodes?: number;
    minNodes?: number;
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
        location: `${gcp.config.zone}`,
        removeDefaultNodePool: true,
        minMasterVersion: args.version,
        initialNodeCount: 1,
      },
      { provider: this.provider }
    );

    const otherNodePools = args.nodePools.map(
      (x) =>
        new gcp.container.NodePool(
          `np-${x.name}`,
          {
            ...toNodePool(x),
          },
          { provider: this.provider }
        )
    );

    const toNodePool = (args: NodePool): gcp.container.NodePoolArgs => {
      return {
        name: args.name,
        location: this.params.zone,
        cluster: cluster.name,
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
    };

    return {
      kubeconfig: this.createKubeconfig(cluster),
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
