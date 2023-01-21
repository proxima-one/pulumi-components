import {
  ComputeResources,
  KubernetesServiceDeployer,
  Storage,
  StorageClassRequest,
  StorageSize,
} from "@proxima-one/pulumi-k8s-base";
import * as pulumi from "@pulumi/pulumi";
import {
  MinioConnectionDetails,
  MinioTenant,
} from "@proxima-one/pulumi-proxima-node";

export class MinioDeployer extends KubernetesServiceDeployer {
  public deploy(args: MinioTenantArgs): DeployedMinioTenant {
    const tenant = new MinioTenant(
      args.name,
      {
        namespace: this.namespace,
        version: "4.5.8",
        nodeSelector: this.nodeSelectors,
        api: args.api,
        console: args.console,
        ingress: {
          certIssuer: "letsencrypt", // todo: get from KubernetesServiceDeployer
        },
        auth: {
          accessKey: args.auth.accessKey,
          secretKey: args.auth.secretKey
            ? { type: "external", password: args.auth.secretKey }
            : { type: "random", name: `${args.name}`, length: 32 },
        },
        pools: args.pools.map((x) => ({
          nodeSelector: this.nodeSelectors,
          resources: x.resources
            ? this.getResourceRequirements(x.resources)
            : undefined,
          servers: x.servers,
          volumesPerServer: x.volumesPerServer,
          storage: pulumi
            .output(this.storageClass(x.storage.class, { failIfNoMatch: true }))
            .apply((storageClass) => ({
              size: x.storage.size,
              class: storageClass!,
            })),
        })),
      },
      this.options()
    );

    const params = pulumi.output({
      connectionDetails: tenant.connectionDetails,
      publicApiEndpoint: tenant.publicApiEndpoint,
      publicConsoleEndpoint: tenant.publicConsoleEndpoint,
    });

    return {
      name: args.name,
      type: "s3",
      params: params,
    };
  }
}

export interface DeployedMinioTenant {
  name: string;
  type: "s3";
  params: pulumi.Input<{
    connectionDetails: MinioConnectionDetails;
    publicApiEndpoint?: string;
    publicConsoleEndpoint?: string;
  }>;
}

interface MinioTenantArgs {
  name: string;

  pools: {
    servers: number;
    volumesPerServer: number;
    storage: {
      size: StorageSize;
      class: StorageClassRequest;
    };
    resources?: ComputeResources;
  }[];

  auth: {
    accessKey: string;
    secretKey?: string;
  };

  console?: {
    publicHost?: string;
    path?: string;
  };

  api?: {
    publicHost?: string;
    path?: string;
  };
}
