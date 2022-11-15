import * as pulumi from "@pulumi/pulumi";
import * as proxima from "@proxima-one/pulumi-proxima-node";
import {
  ComputeResources,
  KubernetesServiceDeployer,
  StorageClassRequest,
  StorageSize,
} from "@proxima-one/pulumi-k8s-base";

// todo: migrate to WebServiceDeployer
export class StateManagerDeployer extends KubernetesServiceDeployer {
  public deploy(args: StateManagerArgs): DeployedStateManager {
    const image = args.image ?? "quay.io/proxima.one/services:state-manager-0.2.4-1685630";

    const stateManager = new proxima.StateManager(
      args.name,
      {
        namespace: this.namespace,
        imageName: image,
        imagePullSecrets: pulumi
          .output(this.imagePullSecrets({ image }))
          .apply((x) => x.map((y) => y.name)),
        nodeSelector: this.nodeSelectors,
        storage: this.storageClass(args.storage.class, {
          failIfNoMatch: true,
        }).apply((storageClass) => ({
          class: storageClass!,
          size: args.storage.size,
        })),
        resources: args.resource
          ? this.getResourceRequirements(args.resource)
          : undefined,
      },
      this.options()
    );

    return {
      name: args.name,
      type: "state-manager",
      params: stateManager.connectionDetails.apply((connectionDetails) => ({
        connectionDetails: connectionDetails,
      })),
    };
  }
}

export interface DeployedStateManager {
  name: string;
  type: "state-manager";
  params: pulumi.Input<{
    connectionDetails: proxima.StateManagerConnectionDetails;
  }>;
}

interface StateManagerArgs {
  name: string;
  image?: string;
  resource?: ComputeResources;
  storage: {
    size: StorageSize;
    class: StorageClassRequest;
  };
}
