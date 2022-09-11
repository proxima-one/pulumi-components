import * as pulumi from "@pulumi/pulumi";
import * as digitalocean from "@pulumi/digitalocean";

export interface NodePool {
  name: string;
  label: pulumi.Input<string>;
  size: pulumi.Input<string>;
  nodeCount?: pulumi.Input<number>;
  autoScale?: {
    maxNodes?: pulumi.Input<number>;
    minNodes?: pulumi.Input<number>;
  };
}

export interface DoClusterArgs {
  region: pulumi.Input<string>;
  version: pulumi.Input<string>;
  autoUpgrade?: pulumi.Input<boolean>;
  ha?: pulumi.Input<boolean>;
  nodePools: NodePool[];
}

export interface DoClusterOutput {
  kubeconfig: pulumi.Output<string>;
}

export class DoCluster
  extends pulumi.ComponentResource
  implements DoClusterOutput
{
  public readonly kubeconfig: pulumi.Output<string>;

  constructor(
    name: string,
    args: DoClusterArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:DoCluster", name, args, opts);
    const cluster = new digitalocean.KubernetesCluster(
      name,
      {
        region: args.region,
        version: args.version,
        autoUpgrade: args.autoUpgrade ?? false,
        ha: args.ha ?? false,

        nodePool: {
          name: args.nodePools[0].name,
          size: args.nodePools[0].size,
          nodeCount: args.nodePools[0].nodeCount ?? 1,
          autoScale: !!args.nodePools[0].autoScale,
          maxNodes: args.nodePools[0].autoScale
            ? args.nodePools[0].autoScale.minNodes
            : undefined,
          minNodes: args.nodePools[0].autoScale
            ? args.nodePools[0].autoScale.minNodes
            : undefined,
          tags: [args.nodePools[0].label],
          labels: { pool: args.nodePools[0].label, priority: "high" },
        },
      },
      { parent: this }
    );

    for (let i = 1; i < args.nodePools.length; i++) {
      const storageNodePool = new digitalocean.KubernetesNodePool(
        args.nodePools[i].name,
        {
          clusterId: cluster.id,
          name: args.nodePools[i].name,
          size: args.nodePools[i].size,
          nodeCount: args.nodePools[i].nodeCount ?? 1,
          autoScale: !!args.nodePools[i].autoScale,
          maxNodes: args.nodePools[i].autoScale
            ? args.nodePools[i].autoScale?.minNodes
            : undefined,
          minNodes: args.nodePools[i].autoScale
            ? args.nodePools[i].autoScale?.minNodes
            : undefined,
          tags: [args.nodePools[i].label],
          labels: { pool: args.nodePools[i].label, priority: "high" },
        },
        { parent: this }
      );
    }

    this.kubeconfig = cluster.kubeConfigs[0].rawConfig;
  }
}
