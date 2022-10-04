import * as pulumi from "@pulumi/pulumi";
import {
  MongoDB,
  MongoDBAuth,
  MongoDbConnectionDetails,
  MongoDbStorage,
} from "@proxima-one/pulumi-proxima-node";
import {
  ComputeResources,
  KubernetesServiceDeployer,
} from "@proxima-one/pulumi-k8s-base";

export class MongoDeployer extends KubernetesServiceDeployer {
  public deploy(app: MongoApp): DeployedMongoApp {
    const name = app.name ?? this.name;
    const mongodb = new MongoDB(
      name,
      {
        nodeSelector: this.nodeSelectors,
        resources: pulumi
          .output(app.resources)
          .apply((x) => this.getResourceRequirements(x ?? defaultResources)),
        namespace: this.namespace,
        auth: app.auth,
        storage: app.storage,
        mongoExpress: app.webUI
          ? {
              endpoint: pulumi
                .output(app.publicHost)
                .apply((host) => `${name}.${host}`),
            }
          : undefined,
      },
      this.options()
    );

    return {
      connectionDetails: mongodb.connectionDetails,
    };
  }
}

const defaultResources = {
  cpu: "50m/100m",
  memory: "100Mi/500Mi",
};

export interface MongoApp {
  name?: string;
  storage: pulumi.Input<MongoDbStorage>;
  version: "4.4";
  auth: MongoDBAuth;
  resources?: pulumi.Input<ComputeResources>;
  replicaSet?: pulumi.Input<number>;
  webUI?: boolean;
  publicHost?: pulumi.Input<string>;
}

export interface DeployedMongoApp {
  connectionDetails: pulumi.Output<MongoDbConnectionDetails>;
}
